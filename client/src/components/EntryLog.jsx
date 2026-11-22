import { useEffect, useRef, useState } from 'react';
import { eid, f2 } from '../format.js';
import Chevron from './Chevron.jsx';
import { MOBILE_QUERY, useMediaQuery } from '../useMediaQuery.js';

// The Entry Log card (Figma node 33:4). Oldest entry first (by date, then id), same order as the Excel Journal and the CSV.
const MIN_ROWS = 10; // the list area fits ten rows; shorter lists are padded with blank striped rows

export default function EntryLog({ entries, templates, editingId, onEdit, onDelete }) {
  const bodyRef = useRef(null);
  const rowRefs = useRef(new Map()); // entry id -> row element
  const knownIds = useRef(null); // ids seen on the previous render; null until the first load
  const [flashId, setFlashId] = useState(null);
  const [tip, setTip] = useState(null); // { text, x, y }
  const compact = useMediaQuery(MOBILE_QUERY); // phones: the card can be collapsed
  const [open, setOpen] = useState(true);
  const collapsed = compact && !open;

  // First load: show the end of the list. Later: scroll to the entry that was just added (it may sit
  // in the middle because the list is ordered by date) and flash it for a moment.
  useEffect(() => {
    const body = bodyRef.current;
    const ids = new Set(entries.map((e) => e.id));
    if (body) {
      if (knownIds.current === null) {
        body.scrollTop = body.scrollHeight;
      } else {
        const added = entries.filter((e) => !knownIds.current.has(e.id)).map((e) => e.id);
        if (added.length) {
          const id = Math.max(...added);
          const row = rowRefs.current.get(id);
          if (row) body.scrollTop = row.offsetTop - body.clientHeight / 2 + row.offsetHeight / 2;
          setFlashId(id);
          setTimeout(() => setFlashId((current) => (current === id ? null : current)), 2500);
        }
      }
    }
    knownIds.current = ids;
  }, [entries]);

  const templateName = (code) => templates.find((t) => t.code === code)?.name || code;

  // One tooltip per row: template, description, then every line.
  const rowTip = (e) => {
    const detail = e.lines
      .map((l) => `${l.debit ? 'Dr' : 'Cr'} ${l.account_id}   ${f2(l.debit || l.credit)}`)
      .join('\n');
    return [`${e.txn_type} · ${templateName(e.txn_type)}`, e.description, '', detail]
      .filter((part, i) => part !== undefined && (part !== '' || i === 2) && part !== null)
      .join('\n');
  };
  const showTip = (event, e) => setTip({ text: rowTip(e), x: event.clientX, y: event.clientY });
  const moveTip = (event) => setTip((t) => (t ? { ...t, x: event.clientX, y: event.clientY } : t));

  const fillers = Math.max(0, MIN_ROWS - entries.length);

  return (
    <section className={`panel entry-log${collapsed ? ' entry-log--collapsed' : ''}`} aria-label="Entry Log">
      <h2 className="panel__title entry-log__title">
        {compact ? (
          <button
            type="button"
            className="fold-toggle"
            aria-expanded={open}
            aria-controls="entry-log-body"
            onClick={() => setOpen((o) => !o)}
          >
            <span>Entry Log</span>
            {collapsed && entries.length > 0 && <span className="fold-toggle__count">{entries.length}</span>}
            <Chevron open={open} />
          </button>
        ) : (
          'Entry Log'
        )}
      </h2>
      <div className="collapsible" id="entry-log-body" data-collapsed={collapsed}>
        <div className="collapsible__inner">
          <div className="log-head">
            <span className="log-col log-col--num">#</span>
            <span className="log-col log-col--date">Date</span>
            <span className="log-col log-col--type">Type</span>
            <span className="log-col log-col--lines">Lines</span>
            <span className="log-col log-col--amount">Amount</span>
            <span className="log-col log-col--actions" />
          </div>
          <div className="log-body" ref={bodyRef} onScroll={() => setTip(null)}>
            {entries.map((e) => (
              <div
                className={`log-row${e.id === editingId ? ' log-row--editing' : ''}${e.id === flashId ? ' log-row--new' : ''}`}
                key={e.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(e.id, el);
                  else rowRefs.current.delete(e.id);
                }}
                onMouseEnter={(ev) => showTip(ev, e)}
                onMouseMove={moveTip}
                onMouseLeave={() => setTip(null)}
              >
                <span className="log-col log-col--num">{eid(e.id)}</span>
                <span className="log-col log-col--date">{e.date}</span>
                <span className="log-col log-col--type">{e.txn_type}</span>
                <span className="log-col log-col--lines">{e.lines.length} lines</span>
                <span className="log-col log-col--amount">{f2(e.total)}</span>
                <span className="log-col log-col--actions">
                  <button type="button" className="row-btn" onClick={() => onEdit(e)}>
                    Edit
                  </button>
                  <button type="button" className="row-btn" onClick={() => onDelete(e)}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
            {Array.from({ length: fillers }, (_, i) => {
              const isMessage = entries.length === 0 && i === 0;
              return (
                <div className={`log-row ${isMessage ? 'log-row--empty' : 'log-row--blank'}`} key={`blank-${i}`}>
                  {isMessage && <span className="log-empty">No entries yet. Post your first one in the New entry card.</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {tip && (
        <div
          className="log-tip"
          style={{ left: Math.min(tip.x + 14, window.innerWidth - 300), top: tip.y + 18 }}
        >
          {tip.text}
        </div>
      )}
    </section>
  );
}
