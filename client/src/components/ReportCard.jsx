import { useId, useState } from 'react';
import Chevron from './Chevron.jsx';
import { MOBILE_QUERY, useMediaQuery } from '../useMediaQuery.js';

// One dashboard card (Cash Position, Accounting Equation or Profit & Loss).
// Figma: header (title, subtitle, "Report through" dropdown), burgundy header row, data row.
// columns: [{ label, value }]. badge (optional): { text, tone: 'ok' | 'bad', title } shown top right (Balanced / Off by X / load error).
// On phones the card can be collapsed: only the title (and the warning badge, if any) stays visible.
export default function ReportCard({ title, subtitle, columns, months, month, onMonthChange, badge }) {
  const compact = useMediaQuery(MOBILE_QUERY);
  const [open, setOpen] = useState(true);
  const collapsed = compact && !open;
  const bodyId = useId();

  return (
    <section className={`report-card${collapsed ? ' report-card--collapsed' : ''}`} aria-label={title}>
      <div className="report-card__header">
        <h3 className="report-card__title">
          {compact ? (
            <button
              type="button"
              className="fold-toggle fold-toggle--card"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpen((o) => !o)}
            >
              <span>{title}</span>
              <Chevron open={open} />
            </button>
          ) : (
            title
          )}
        </h3>
        {badge && (
          <span className={`report-card__badge report-card__badge--${badge.tone}`} title={badge.title}>
            {badge.text}
          </span>
        )}
        {/* On desktop the two wrappers have no box of their own, so the Figma positions below are unchanged. */}
        <div className="collapsible" data-collapsed={collapsed}>
          <div className="collapsible__inner">
            <label className="period">
              <span className="period__label">Report through</span>
              <select
                className="period__select"
                value={month}
                onChange={onMonthChange ? (e) => onMonthChange(e.target.value) : undefined}
                disabled={!onMonthChange}
              >
                {months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="report-card__subtitle">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="collapsible" id={bodyId} data-collapsed={collapsed}>
        <div className="collapsible__inner">
          <div className="report-card__row report-card__row--head" style={{ '--cols': columns.length }}>
            {columns.map((c) => (
              <div className="report-card__cell" key={c.label}>
                {c.label}
              </div>
            ))}
          </div>
          <div className="report-card__row report-card__row--data" style={{ '--cols': columns.length }}>
            {columns.map((c) => (
              <div className="report-card__cell" key={c.label}>
                {c.value}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
