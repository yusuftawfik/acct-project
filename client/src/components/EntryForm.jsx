import { useEffect, useMemo, useState } from 'react';
import removeIcon from '../assets/icons/remove.svg';
import plusIcon from '../assets/icons/plus.svg';
import { api } from '../api.js';
import { ConfirmDialog } from './Dialogs.jsx';
import { f2, eid, toCents, fyEnd } from '../format.js';

// The "New entry" card (Figma node 23:4). Behaviour follows legacy/static/index.html.

const AMOUNT_RE = /^\d*\.?\d{0,2}$/; // digits with at most two decimals
let nextKey = 1;
const newLine = (over = {}) => ({ key: nextKey++, account_id: '', debit: '', credit: '', side: null, ...over });

// Which accounts a template suggests. "1010 + 2010" gives two lines; a single account gives one; "15xx asset" or
// "1200/1210/1220" gives one blank line where the user chooses the account. side marks Dr/Cr for the Amount shortcut.
function templateLines(t) {
  if (!t || t.code === 'Custom') return [newLine(), newLine()];
  const ids = (text) => (text.includes('+') ? text.match(/\d{4}/g) : /^\d{4}$/.test(text) ? [text] : [null]);
  return [
    ...ids(t.debit).map((id) => newLine({ account_id: id ?? '', side: 'dr' })),
    ...ids(t.credit).map((id) => newLine({ account_id: id ?? '', side: 'cr' })),
  ];
}

function hintFor(t) {
  if (!t) return '';
  if (t.code === 'Custom') return 'Custom: choose any accounts, as many lines as you need.';
  return (
    `${t.name}: suggested Dr ${t.debit} / Cr ${t.credit}` +
    (/[/x]/.test(t.debit + t.credit) ? '. Choose the specific account where a line is blank.' : '')
  );
}

// Amount box fills a simple entry: exactly one debit line and one credit line.
function withAmount(lines, amount) {
  const dr = lines.filter((l) => l.side === 'dr');
  const cr = lines.filter((l) => l.side === 'cr');
  if (dr.length !== 1 || cr.length !== 1) return lines;
  return lines.map((l) => (l.side === 'dr' ? { ...l, debit: amount } : l.side === 'cr' ? { ...l, credit: amount } : l));
}

// Long or multi-line server messages: show the first line, keep the full text for the tooltip.
function shortNote(text, kind) {
  const parts = text.split('\n');
  return { text: parts.length > 1 ? `${parts[0]} (+${parts.length - 1} more)` : text, full: text, kind };
}

export default function EntryForm({
  accounts,
  templates,
  fyStart,
  defaultMonth,
  editing,
  entryCount,
  onSaved,
  onCancelEdit,
  onClearAll,
  onRunSample,
}) {
  const [date, setDate] = useState('');
  const [type, setType] = useState('');
  const [faculty, setFaculty] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState(() => [newLine(), newLine()]);
  const [editingId, setEditingId] = useState(null);
  const [note, setNote] = useState({ text: '', full: '', kind: '' });
  const [busy, setBusy] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState(null); // 'clear' | 'sample' while its confirmation dialog is open

  // An entry chosen in the Entry Log (Edit button) is loaded into the form.
  useEffect(() => {
    if (!editing) {
      // The entry being edited was deleted or the edit was cancelled elsewhere: back to a blank new entry.
      if (editingId !== null) reset(false);
      return;
    }
    setEditingId(editing.id);
    setDate(editing.date);
    setType(editing.txn_type);
    setDescription(editing.description || '');
    setAmount('');
    const tagged = editing.lines.find((l) => l.faculty && l.faculty !== 'Central');
    setFaculty(tagged ? tagged.faculty : '');
    setLines(
      editing.lines.map((l) =>
        newLine({
          account_id: String(l.account_id),
          debit: l.debit ? String(l.debit) : '',
          credit: l.credit ? String(l.credit) : '',
        }),
      ),
    );
    setNote({ text: '', full: '', kind: '' });
  }, [editing]);

  // Typing anything clears an old "Entry posted." / error message so the guidance below can show.
  const clearNote = () => {
    if (note.text) setNote({ text: '', full: '', kind: '' });
  };

  const reset = (keepDate) => {
    setEditingId(null);
    setDescription('');
    setAmount('');
    setFaculty('');
    setType('');
    if (!keepDate) setDate('');
    setLines([newLine(), newLine()]);
  };

  const onType = (code) => {
    clearNote();
    setType(code);
    setLines(withAmount(templateLines(templates.find((t) => t.code === code)), amount));
  };

  const onAmount = (value) => {
    if (!AMOUNT_RE.test(value)) return;
    clearNote();
    setAmount(value);
    setLines((prev) => withAmount(prev, value));
  };

  const setLine = (key, field, value) => {
    if ((field === 'debit' || field === 'credit') && !AMOUNT_RE.test(value)) return;
    clearNote();
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  };

  // Totals in whole cents, so "balanced" is an exact comparison.
  const { debits, credits, filled } = useMemo(() => {
    const used = lines.filter((l) => l.account_id || toCents(l.debit) || toCents(l.credit));
    return {
      filled: used,
      debits: used.reduce((s, l) => s + toCents(l.debit), 0),
      credits: used.reduce((s, l) => s + toCents(l.credit), 0),
    };
  }, [lines]);
  const difference = debits - credits;
  const balanced = difference === 0 && debits > 0;
  const canPost = balanced && filled.length >= 2 && Boolean(date) && filled.every((l) => l.account_id) && !busy;

  const hint = editingId ? '' : hintFor(templates.find((t) => t.code === type));
  // Why Post is still disabled, shown once amounts have been typed.
  const reason =
    canPost || (debits === 0 && credits === 0)
      ? ''
      : !date
        ? 'Choose a date to post this entry.'
        : filled.length < 2
          ? 'An entry needs at least two lines.'
          : !filled.every((l) => l.account_id)
            ? 'Choose an account for every line.'
            : !balanced
              ? 'Debits and credits must be equal.'
              : '';
  const shown = note.text || reason || hint;

  const post = async () => {
    const body = {
      date,
      txn_type: type || 'Custom',
      description,
      faculty,
      lines: filled.map((l) => ({
        account_id: Number(l.account_id) || null,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      })),
    };
    setBusy(true);
    try {
      await api(editingId ? `/api/entries/${editingId}` : '/api/entries', { method: editingId ? 'PUT' : 'POST', body });
      setNote(shortNote(editingId ? 'Entry updated.' : 'Entry posted.', 'ok'));
      reset(true);
      if (editingId && onCancelEdit) onCancelEdit();
      if (onSaved) await onSaved();
    } catch (e) {
      setNote(shortNote(e.message, 'err'));
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    reset(false);
    setNote({ text: '', full: '', kind: '' });
    if (editingId && onCancelEdit) onCancelEdit();
  };

  // "Clear all data" and "Run sample data": the journal (and so Excel, which reads it from the app) changes completely.
  const runBulk = async (action) => {
    setBulkConfirm(null);
    setBusy(true);
    try {
      const text = await action();
      reset(false);
      setNote(shortNote(text, 'ok'));
    } catch (e) {
      setNote(shortNote(e.message, 'err'));
    } finally {
      setBusy(false);
    }
  };
  const clearAllData = async () => {
    await onClearAll();
    return 'All entries deleted.';
  };
  const loadSampleData = async () => {
    const r = await onRunSample();
    return `Sample year loaded: ${r.entries} entries, ${r.lines} lines.`;
  };
  const askClearAll = () => {
    if (entryCount === 0) setNote(shortNote('The journal is already empty.', 'ok'));
    else setBulkConfirm('clear');
  };
  const askSample = () => {
    if (entryCount > 0) setBulkConfirm('sample');
    else runBulk(loadSampleData);
  };

  // Fills the form with the monthly income tax entry the server proposes.
  const suggestTax = async () => {
    const month = date.slice(0, 7) || defaultMonth;
    try {
      const t = await api(`/api/tax/suggest?month=${month}`);
      if (!t.proposal) {
        setNote(shortNote(`Tax for ${month} is up to date (required to date ${f2(t.tax_required_ytd)}).`, 'ok'));
        return;
      }
      setEditingId(null);
      if (editingId && onCancelEdit) onCancelEdit();
      setType('T28');
      setDate(t.period_end);
      setDescription('Monthly income tax accrual');
      setFaculty('');
      setAmount('');
      setLines(
        t.proposal.map((l) =>
          newLine({
            account_id: String(l.account_id),
            debit: l.debit ? String(l.debit) : '',
            credit: l.credit ? String(l.credit) : '',
          }),
        ),
      );
      const posted = t.recorded_before_this_month + t.recorded_this_month;
      setNote(
        shortNote(
          `Tax to date ${f2(t.tax_required_ytd)} (${(t.rate * 100).toFixed(1)}% of ${f2(t.profit_before_tax_ytd)}) minus ${f2(posted)} already posted = ${f2(t.to_post)}. Review it, then post.`,
          '',
        ),
      );
    } catch (e) {
      setNote(shortNote(e.message, 'err'));
    }
  };

  return (
    <section className="panel entry-form" aria-label="New entry">
      <div className="entry-form__header">
        <h2 className="panel__title">{editingId ? `Edit entry ${eid(editingId)}` : 'New entry'}</h2>
      </div>

      <div className="form-row form-row--thirds">
        <label className="field">
          <span className="field__label">Date</span>
          <input
            className="input input--date"
            type="date"
            value={date}
            min={fyStart}
            max={fyEnd(fyStart)}
            onChange={(e) => {
              clearNote();
              setDate(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">Transaction type</span>
          <select className="input input--select" value={type} onChange={(e) => onType(e.target.value)}>
            <option value="">Choose a template...</option>
            {templates.map((t) => (
              <option key={t.code} value={t.code}>
                {t.code} · {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Faculty</span>
          <select className="input input--select" value={faculty} onChange={(e) => setFaculty(e.target.value)}>
            <option value="">none</option>
            <option value="BA">BA</option>
            <option value="BT">BT</option>
            <option value="CS">CS</option>
          </select>
        </label>
      </div>

      <div className="form-row">
        <label className="field field--amount">
          <span className="field__label">Amount</span>
          <input
            className="input"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
          />
        </label>
        <label className="field field--grow">
          <span className="field__label">Transaction Description</span>
          <input
            className="input"
            type="text"
            maxLength={120}
            value={description}
            onChange={(e) => {
              clearNote();
              setDescription(e.target.value);
            }}
          />
        </label>
      </div>

      <div className="form-lines">
        {lines.map((l) => (
          <div className="form-row form-row--lines" key={l.key}>
            <label className="field field--account">
              <span className="field__label field__label--mono">Account</span>
              <select
                className="input input--select"
                value={l.account_id}
                onChange={(e) => setLine(l.key, 'account_id', e.target.value)}
              >
                <option value="">Choose account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id} · {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--money">
              <span className="field__label field__label--mono">Debit</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="Input amount"
                value={l.debit}
                onChange={(e) => setLine(l.key, 'debit', e.target.value)}
              />
            </label>
            <label className="field field--money">
              <span className="field__label field__label--mono">Credit</span>
              <input
                className="input"
                type="text"
                inputMode="decimal"
                placeholder="Input amount"
                value={l.credit}
                onChange={(e) => setLine(l.key, 'credit', e.target.value)}
              />
            </label>
            <button
              type="button"
              className="remove-btn"
              aria-label="Remove line"
              onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
            >
              <img src={removeIcon} alt="" width="12" height="12" />
            </button>
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn--outline" onClick={() => setLines((prev) => [...prev, newLine()])}>
          <img src={plusIcon} alt="" width="12" height="12" />
          Add line
        </button>
        <button type="button" className="btn btn--outline" onClick={suggestTax}>
          Suggest tax entry
        </button>
      </div>

      <div className={`balance-bar${balanced ? ' balance-bar--ok' : ''}`}>
        {`Debits ${f2(debits / 100)}  Credits ${f2(credits / 100)}  Difference ${f2(Math.abs(difference) / 100)}`}
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn--post" disabled={!canPost} onClick={post}>
          {editingId ? 'Save changes' : 'Post entry'}
        </button>
        <button type="button" className="btn btn--outline" onClick={clear}>
          Clear
        </button>
        <button type="button" className="btn btn--outline" onClick={askClearAll} disabled={busy}>
          Clear all data
        </button>
        <button type="button" className="btn btn--outline" onClick={askSample} disabled={busy}>
          Run sample data
        </button>
        {shown && (
          <span className={`form-note${note.kind ? ` form-note--${note.kind}` : ''}`} title={note.full || reason || hint}>
            {shown}
          </span>
        )}
      </div>

      {bulkConfirm === 'clear' && (
        <ConfirmDialog
          title="Delete all entries?"
          message={`This deletes all ${entryCount} entries from the journal. The Excel reports will be empty too after their next refresh. It cannot be undone.`}
          confirmLabel="Delete all data"
          onConfirm={() => runBulk(clearAllData)}
          onCancel={() => setBulkConfirm(null)}
        />
      )}
      {bulkConfirm === 'sample' && (
        <ConfirmDialog
          title="Replace the journal with sample data?"
          message={`This deletes the ${entryCount} entries in the journal now and loads the sample financial year instead. It cannot be undone.`}
          confirmLabel="Run sample data"
          onConfirm={() => runBulk(loadSampleData)}
          onCancel={() => setBulkConfirm(null)}
        />
      )}
    </section>
  );
}
