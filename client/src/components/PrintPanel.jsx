// The Print Reports panel (Figma node 13:4). Each button maps to a report slug served by GET /api/reports/<slug>.pdf.
export const FINANCIAL_STATEMENTS = [
  { slug: 'all-statements', label: 'Print all statements', primary: true },
  { slug: 'financial-position', label: 'Financial Position' },
  { slug: 'income-statement', label: 'Income Statement' },
  { slug: 'net-income', label: 'Net Income' },
  { slug: 'cash-flows', label: 'Cash Flows' },
  { slug: 'owners-equity', label: "Owner's Equity" },
  { slug: 'notes', label: 'Notes' },
];

export const SUPPORTING_REPORTS = [
  { slug: 'trial-balance', label: 'Trial Balance' },
  { slug: 'tax', label: 'Tax' },
  { slug: 'checks', label: 'Checks' },
  { slug: 'journal', label: 'Journal' },
];

function PrinterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function PrintGroup({ title, items, onPrint, busySlug, variant }) {
  return (
    <>
      <div className="print-panel__group">{title}</div>
      <div className={`print-panel__list print-panel__list--${variant}`}>
        {items.map((item) => (
          <button
            type="button"
            key={item.slug}
            className={`print-btn${item.primary ? ' print-btn--primary' : ''}`}
            onClick={onPrint ? () => onPrint(item.slug) : undefined}
            disabled={Boolean(busySlug)}
          >
            <PrinterIcon />
            {busySlug === item.slug ? 'Preparing...' : item.label}
          </button>
        ))}
      </div>
    </>
  );
}

export default function PrintPanel({ onPrint, busySlug, error }) {
  return (
    <aside className="print-panel" aria-label="Print Reports">
      <div className="print-panel__header">
        <p className="print-panel__title">Print Reports</p>
        <p className="print-panel__subtitle">From the Excel model</p>
      </div>
      <PrintGroup
        title="Financial statements"
        items={FINANCIAL_STATEMENTS}
        onPrint={onPrint}
        busySlug={busySlug}
        variant="statements"
      />
      <PrintGroup
        title="Supporting reports"
        items={SUPPORTING_REPORTS}
        onPrint={onPrint}
        busySlug={busySlug}
        variant="supporting"
      />
      {error && (
        <p className="print-panel__error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}
