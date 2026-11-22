// Turns the numbers from statements.js into page layouts: one "document" per report, made of text and table blocks.
// Everything is already formatted as strings here; pdf.js only draws it.

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const group = (s) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Cents -> text. dp 0 = whole currency units (half away from zero), dp 2 = two decimals. Zero shows as "-", negatives in brackets. */
export function money(cents, dp = 0) {
  if (!cents) return '-';
  const abs = Math.abs(cents);
  let text;
  if (dp === 0) text = group(String(Math.floor((abs + 50) / 100)));
  else text = `${group(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `(${text})` : text;
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${LONG_MONTHS[m - 1]} ${y}`;
}
export function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${SHORT_MONTHS[m - 1]}-${y}`;
}
const entryCode = (id) => `E${String(id).padStart(4, '0')}`;

// ------------------------------------------------------------------ building blocks

const text = (value, style = 'normal', gap = 0) => ({ type: 'text', text: value, style, gap });
const table = (cols, header, rows, size = 8) => ({ type: 'table', cols, header, rows, size });
const row = (cells, style = 'normal') => ({ cells, style });
const blank = () => ({ cells: [], style: 'blank' });
const span = (value, style = 'note') => ({ span: value, style });

function headingFor(r, name, subtitle) {
  return [text(r.meta.entity, 'bold12'), text(name, 'bold11'), text(subtitle, 'italic', 4)];
}
const periodLine = (r) =>
  `For the period ending ${longDate(r.meta.periodEnd)} (month = ${r.meta.throughLabel}; YTD from ${longDate(r.meta.fyStart)}) | Amounts in ${r.meta.currency}`;

const ID = { w: 34, align: 'left' };
const LABEL = { w: 'flex', align: 'left', wrap: true };
const AMT = (w = 92) => ({ w, align: 'right' });

// ------------------------------------------------------------------ the statements

function financialPosition(r) {
  const f = r.financialPosition;
  const line = (a) => row([String(a.id), a.name, money(a.amount)]);
  return {
    slug: 'financial-position',
    name: 'Financial Position',
    orientation: 'portrait',
    blocks: [
      ...headingFor(r, 'Statement of Financial Position', `As at ${longDate(r.meta.periodEnd)} | Amounts in ${r.meta.currency}`),
      table([ID, LABEL, AMT()], ['ID', '', r.meta.throughLabel], [
        row(['', 'ASSETS'], 'section'),
        row(['', 'Current assets'], 'bold'),
        ...f.currentAssets.map(line),
        row(['', 'Total current assets', money(f.totalCurrent)], 'total'),
        row(['', 'Non-current assets (at cost)'], 'bold'),
        ...f.nonCurrentAssets.map(line),
        row(['', 'Total non-current assets', money(f.totalNonCurrent)], 'total'),
        row(['', 'TOTAL ASSETS', money(f.totalAssets)], 'total'),
        blank(),
        row(['', 'LIABILITIES'], 'section'),
        ...f.liabilities.map(line),
        row(['', 'Total liabilities', money(f.totalLiabilities)], 'total'),
        blank(),
        row(['', "OWNER'S EQUITY"], 'section'),
        row(['3010', "Owner's capital", money(f.capital)]),
        row(['', 'Add: net income to date', money(f.netIncomeToDate)]),
        row(['3020', "Less: owner's drawings", money(f.drawings)]),
        row(['', "Total owner's equity", money(f.totalEquity)], 'total'),
        blank(),
        row(['', "TOTAL LIABILITIES AND OWNER'S EQUITY", money(f.totalLE)], 'total'),
        row(['', 'Difference (assets minus liabilities and equity; must be nil)', money(f.difference)]),
        blank(),
        span("Accounting equation: Assets = Liabilities + (Capital + Revenue - Expenses - Drawings)"),
        span('Net income to date = revenue minus all expenses including income tax, year to date.'),
      ]),
    ],
  };
}

function incomeStatement(r) {
  const i = r.incomeStatement;
  const line = (a) => row([String(a.id), a.name, money(a.month), money(a.ytd)]);
  return {
    slug: 'income-statement',
    name: 'Income Statement',
    orientation: 'portrait',
    blocks: [
      ...headingFor(r, 'Income Statement (Profit or Loss)', periodLine(r)),
      table([ID, LABEL, AMT(), AMT()], ['ID', '', r.meta.throughLabel, 'Year to date'], [
        row(['', 'REVENUE'], 'section'),
        ...i.revenue.map(line),
        row(['', 'Total revenue', money(i.totalRevenue.month), money(i.totalRevenue.ytd)], 'total'),
        blank(),
        row(['', 'EXPENSES (before income tax)'], 'section'),
        ...i.expenses.map(line),
        row(['', 'Total expenses (before income tax)', money(i.totalExpenses.month), money(i.totalExpenses.ytd)], 'total'),
        blank(),
        row(['', 'PROFIT BEFORE TAX', money(i.pbt.month), money(i.pbt.ytd)], 'total'),
        blank(),
        span('Income tax and net income are shown on the Net Income sheet.'),
      ]),
    ],
  };
}

function netIncome(r) {
  const n = r.netIncome;
  return {
    slug: 'net-income',
    name: 'Net Income',
    orientation: 'portrait',
    blocks: [
      ...headingFor(r, 'Net Income', periodLine(r)),
      table([LABEL, AMT(), AMT()], ['', r.meta.throughLabel, 'Year to date'], [
        row(['Total revenue', money(n.revenue.month), money(n.revenue.ytd)]),
        row(['Less: total expenses (before income tax)', money(n.expenses.month), money(n.expenses.ytd)]),
        row(['Profit before tax', money(n.pbt.month), money(n.pbt.ytd)], 'total'),
        row(['Less: income tax expense (account 5900)', money(n.tax.month), money(n.tax.ytd)]),
        row(['NET INCOME', money(n.net.month), money(n.net.ytd)], 'total'),
        blank(),
        row(['Income tax rate applied', pct(n.rate), '']),
        row(['Effective tax rate on profit before tax', pct(n.effective.month), pct(n.effective.ytd)]),
        row(['Net margin (net income as % of revenue)', pct(n.margin.month), pct(n.margin.ytd)]),
        blank(),
        span("Net income carries into the Statement of Owner's Equity and the Statement of Financial Position."),
        span('Tax is recorded monthly via the Tax sheet. If it has not been posted yet, net income is shown before that tax.'),
      ]),
    ],
  };
}

function cashFlows(r) {
  const c = r.cashFlows;
  const line = (a) => row([a.label, money(a.month), money(a.ytd)]);
  return {
    slug: 'cash-flows',
    name: 'Cash Flows',
    orientation: 'portrait',
    blocks: [
      ...headingFor(r, 'Statement of Cash Flows', periodLine(r)),
      table([LABEL, AMT(), AMT()], ['', r.meta.throughLabel, 'Year to date'], [
        row(['CASH RECEIVED'], 'section'),
        ...c.received.map(line),
        row(['Total cash received', money(c.totalReceived.month), money(c.totalReceived.ytd)], 'total'),
        blank(),
        row(['CASH PAID'], 'section'),
        ...c.paid.map(line),
        row(['Total cash paid', money(c.totalPaid.month), money(c.totalPaid.ytd)], 'total'),
        row(['Other / unclassified cash movements (must be nil)', money(c.unclassified.month), money(c.unclassified.ytd)]),
        blank(),
        row(['NET INCREASE / (DECREASE) IN CASH', money(c.net.month), money(c.net.ytd)], 'total'),
        row(['Opening cash', money(c.opening.month), money(c.opening.ytd)]),
        row(['CLOSING CASH', money(c.closing.month), money(c.closing.ytd)], 'total'),
        blank(),
        span('A cash line takes its label from the account on the opposite side of the entry. Where several accounts are opposite, cash is split in proportion to their amounts.'),
        span('Receipts are positive; payments are negative.'),
      ]),
    ],
  };
}

function ownersEquity(r) {
  const e = r.ownersEquity;
  return {
    slug: 'owners-equity',
    name: 'Owners Equity',
    orientation: 'portrait',
    blocks: [
      ...headingFor(r, "Statement of Owner's Equity (year to date)", periodLine(r)),
      table([LABEL, AMT(110)], ['', 'Year to date'], [
        row(["Opening owner's capital (start of financial year)", money(e.opening)]),
        row(['Add: capital introduced during the period', money(e.introduced)]),
        row(['Add: net income for the period', money(e.netIncome)]),
        row(["Less: owner's drawings", money(e.drawings)]),
        row(["CLOSING OWNER'S EQUITY", money(e.closing)], 'total'),
        blank(),
        span('Opening + investments + net income - drawings = closing equity (ties to the Statement of Financial Position).'),
      ]),
    ],
  };
}

function notes(r) {
  const n = r.notes;
  const m = r.meta;
  const rateText = `${(m.taxRate * 100).toFixed(1)}%`;
  const para = (v) => text(v, 'normal', 3);
  const facultyCols = [{ w: 30, align: 'left' }, LABEL, ...[0, 1, 2, 3, 4].map(() => AMT(62))];
  const facultyHead = (first) => ['ID', first, 'BA', 'BT', 'CS', 'Central', 'Total'];
  const small = (title, list, total, totalLabel) => [
    text(title, 'bold10', 2),
    table([ID, LABEL, AMT(100)], ['ID', 'Item', m.throughLabel], [
      ...list.map((a) => row([String(a.id), a.name, money(a.amount)])),
      row(['', totalLabel, money(total)], 'total'),
    ]),
  ];
  return {
    slug: 'notes',
    name: 'Notes',
    orientation: 'portrait',
    blocks: [
      ...headingFor(r, 'Notes to the Financial Statements', periodLine(r)),
      text('Note 1: Basis of preparation and accounting policies', 'bold10', 2),
      para(`Reporting entity: ${m.entity}, a private for-profit university with a single owner.`),
      para(`Currency and period: ${m.currency}, financial year ${longDate(m.fyStart)} to ${longDate(m.fyEnd)}.`),
      para('Basis: accrual accounting. Revenue and expenses are recorded when earned or incurred, not when cash moves.'),
      para('Measurement: assets are held at cost. No depreciation is charged (not yet covered in the course material).'),
      para('Inventory: bookstore, cafeteria and lab/office stock is an asset when bought and an expense (cost of sales or supplies used) when sold or consumed.'),
      para(`Income tax: accrued monthly at ${rateText} of year-to-date profit before tax (Egyptian corporate rate). Simplification: accounting profit is used and any special treatment of private universities is ignored.`),
      para('Cash flows: shown as simple cash received and cash paid, without an operating/investing/financing split (not yet covered).'),
      text('', 'normal', 6),
      text('Note 2: Revenue by type and faculty (year to date)', 'bold10', 2),
      table(facultyCols, facultyHead('Revenue line'), [
        ...n.note2.rows.map((a) => row([String(a.id), a.name, ...a.byFaculty.map((v) => money(v)), money(a.total)])),
        row(['', 'Total revenue', ...n.note2.totals.map((v) => money(v)), money(n.note2.grand)], 'total'),
      ], 7.5),
      text('', 'normal', 6),
      text('Note 3: Academic cost and faculty contribution (year to date)', 'bold10', 2),
      table(facultyCols, facultyHead('Item'), [
        ...n.note3.rows.map((a) => row([String(a.id), a.name, ...a.byFaculty.map((v) => money(v)), money(a.total)])),
        row(['', 'Total academic costs', ...n.note3.totals.map((v) => money(v)), money(n.note3.grandCosts)], 'total'),
        row(['', 'Faculty revenue (tuition + training and consulting)', ...n.note3.facultyRevenue.map((v) => money(v)), money(n.note3.grandFacultyRevenue)]),
        row(['', 'Faculty contribution (revenue minus academic costs)', ...n.note3.contribution.map((v) => money(v)), money(n.note3.grandContribution)], 'total'),
      ], 7.5),
      text('', 'normal', 6),
      ...small('Note 4: Inventory at the selected month end', n.inventory, n.inventoryTotal, 'Total inventory'),
      text('', 'normal', 6),
      ...small('Note 5a: Receivables at the selected month end', n.receivables, n.receivablesTotal, 'Total receivables'),
      text('', 'normal', 6),
      ...small('Note 5b: Payables and accruals at the selected month end', n.payables, n.payablesTotal, 'Total payables and accruals'),
      text('', 'normal', 6),
      ...small('Note 6: Property and equipment at cost', n.property, n.propertyTotal, 'Total property and equipment'),
      text('', 'normal', 6),
      text('Note 7: Income tax (year to date)', 'bold10', 2),
      table([LABEL, AMT(100)], ['Item', m.throughLabel], [
        row(['Profit before tax', money(n.tax.pbtYtd)]),
        row(['Tax rate', rateText]),
        row(['Income tax expense recorded', money(n.tax.expense)]),
        row(['Income tax paid in cash', money(n.tax.paid)]),
        row(['Income tax payable at period end', money(n.tax.payable)]),
        row(['Check: expense minus paid equals payable (nil if consistent)', money(n.tax.check)], 'total'),
      ]),
    ],
  };
}

// ------------------------------------------------------------------ supporting reports

function trialBalance(r) {
  const tbRows = r.trialBalance;
  const t = r.trialBalanceTotals;
  const labels = r.meta.monthLabels;
  const idCol = { w: 34, align: 'left' };
  const nameCol = { w: 'flex', align: 'left' };
  const half = (from) => {
    const months = [0, 1, 2, 3, 4, 5].map((k) => from + k);
    return table(
      [idCol, nameCol, ...months.map(() => AMT(82))],
      ['ID', 'Account name', ...months.map((k) => labels[k])],
      [
        ...tbRows.map((a) => row([String(a.id), a.name, ...months.map((k) => money(a.months[k], 2))])),
        row(['', 'Total (each month should be nil)', ...months.map((k) => money(t.months[k], 2))], 'total'),
      ],
      7,
    );
  };
  return {
    slug: 'trial-balance',
    name: 'Trial Balance',
    orientation: 'landscape',
    blocks: [
      ...headingFor(
        r,
        'Trial balance by month',
        `Net movement (debit minus credit) per account per month, built from the Journal. Balances are through ${r.meta.throughLabel} | Amounts in ${r.meta.currency}`,
      ),
      table(
        [idCol, nameCol, { w: 52, align: 'left' }, { w: 46, align: 'left' }, { w: 104, align: 'left' }, AMT(82), AMT(88), AMT(88), AMT(88)],
        ['ID', 'Account name', 'Type', 'Normal', 'Statement line', 'Month movement', 'Cumulative', 'Debit balance', 'Credit balance'],
        [
          ...tbRows.map((a) => row([String(a.id), a.name, a.type, a.normal, a.statementLine, money(a.selected, 2), money(a.cumulative, 2), money(a.debit, 2), money(a.credit, 2)])),
          row(['', 'Total', '', '', '', money(t.selected, 2), money(t.cumulative, 2), money(t.debit, 2), money(t.credit, 2)], 'total'),
        ],
        7,
      ),
      text('', 'normal', 8),
      text('Monthly movements, first half of the year', 'bold10', 2),
      half(0),
      text('', 'normal', 8),
      text('Monthly movements, second half of the year', 'bold10', 2),
      half(6),
    ],
  };
}

function tax(r) {
  const months = r.taxMonths;
  const half = (from) => {
    const ms = months.slice(from, from + 6);
    const cols = [{ w: 'flex', align: 'left' }, ...ms.map(() => AMT(82))];
    const line = (label, fn, style) => row([label, ...ms.map(fn)], style);
    return table(cols, ['', ...ms.map((m) => m.label)], [
      line('Fiscal month', (m) => String(m.month)),
      line('Revenue in month', (m) => money(m.revenue, 2)),
      line('Operating expenses in month (excluding income tax)', (m) => money(m.opex, 2)),
      line('Profit before tax, month', (m) => money(m.pbt, 2)),
      line('Profit before tax, year to date', (m) => money(m.pbtYtd, 2)),
      line('Tax required on YTD profit (rounded to whole currency units)', (m) => money(m.required)),
      line('Tax expense recorded in the Journal this month', (m) => money(m.recorded, 2)),
      line('Tax expense recorded in earlier months', (m) => money(m.recordedEarlier, 2)),
      line('SUGGESTED TAX ENTRY this month (post as T28)', (m) => money(m.suggested), 'total'),
      line('Variance: recorded minus suggested', (m) => money(m.variance, 2)),
      line('Status', (m) => m.status),
    ], 7);
  };
  return {
    slug: 'tax',
    name: 'Tax',
    orientation: 'landscape',
    blocks: [
      ...headingFor(
        r,
        'Income tax calculation (monthly, year-to-date method)',
        `Suggested entry each month: tax required on YTD profit minus tax already recorded. Post it as T28 (Dr 5900, Cr 2030). Negative = reverse part of earlier tax. | Amounts in ${r.meta.currency}`,
      ),
      half(0),
      text('', 'normal', 8),
      half(6),
      text('', 'normal', 6),
      text(`Rate applied: ${(r.meta.taxRate * 100).toFixed(1)}% of accounting profit. Source: Egyptian standard corporate income tax rate. Simplification: no tax adjustments and no special treatment for private universities.`, 'italic'),
    ],
  };
}

function checks(r) {
  return {
    slug: 'checks',
    name: 'Checks',
    orientation: 'portrait',
    blocks: [
      ...headingFor(r, 'Model integrity checks', `Every test should read PASS. A FAIL points to a Journal entry or a statement that needs attention. Selected month: ${r.meta.throughLabel}`),
      table(
        [{ w: 20, align: 'left' }, { w: 'flex', align: 'left', wrap: true }, { w: 74, align: 'right' }, { w: 40, align: 'left' }, { w: 128, align: 'left', wrap: true }],
        ['#', 'Test', 'Difference / count', 'Result', 'Where to look if it fails'],
        [
          ...r.checks.map((c) => row([String(c.n), c.test, c.count ? String(c.value) : money(c.value, 2), c.pass ? 'PASS' : 'FAIL', c.where])),
          blank(),
          row(['', 'OVERALL STATUS', '', '', r.overall], 'total'),
        ],
      ),
    ],
  };
}

function journal(r) {
  const cols = [
    { w: 34, align: 'left' }, // entry
    { w: 50, align: 'left' }, // date
    { w: 26, align: 'left' }, // txn
    { w: 28, align: 'left' }, // account
    { w: 100, align: 'left' }, // account name
    { w: 64, align: 'right' }, // debit
    { w: 64, align: 'right' }, // credit
    { w: 38, align: 'left' }, // faculty
    { w: 'flex', align: 'left' }, // description
    { w: 76, align: 'left' }, // cash flow line
    { w: 20, align: 'right' }, // month
    { w: 64, align: 'right' }, // cash allocated
    { w: 44, align: 'left' }, // status
  ];
  return {
    slug: 'journal',
    name: 'Journal',
    orientation: 'landscape',
    blocks: [
      ...headingFor(r, 'Journal (one row per debit or credit line)', `${r.journal.length} lines | Amounts in ${r.meta.currency}`),
      table(
        cols,
        ['Entry', 'Date', 'Type', 'Acct', 'Account name', 'Debit', 'Credit', 'Faculty', 'Description', 'Cash flow line', 'Mo.', 'Cash alloc.', 'Status'],
        r.journal.map((l) =>
          row([
            entryCode(l.entry_id),
            shortDate(l.date),
            l.txn_type,
            String(l.account_id),
            l.account_name,
            l.debit_cents ? money(l.debit_cents, 2) : '',
            l.credit_cents ? money(l.credit_cents, 2) : '',
            l.faculty,
            l.description,
            l.cash_flow_line,
            l.fiscal_month === null ? '' : String(l.fiscal_month),
            money(l.cash_allocated_cents, 2),
            l.status,
          ]),
        ),
        6.5,
      ),
    ],
  };
}

// ------------------------------------------------------------------ public

export const REPORT_SLUGS = [
  'all-statements', 'financial-position', 'income-statement', 'net-income', 'cash-flows', 'owners-equity', 'notes',
  'trial-balance', 'tax', 'checks', 'journal',
];

/** The documents (one per page group) that make up the PDF for a slug. */
export function docsFor(slug, report) {
  const make = {
    'financial-position': financialPosition,
    'income-statement': incomeStatement,
    'net-income': netIncome,
    'cash-flows': cashFlows,
    'owners-equity': ownersEquity,
    notes,
    'trial-balance': trialBalance,
    tax,
    checks,
    journal,
  };
  if (slug === 'all-statements') {
    return ['financial-position', 'income-statement', 'net-income', 'cash-flows', 'owners-equity', 'notes'].map((s) => make[s](report));
  }
  if (!make[slug]) return null;
  return [make[slug](report)];
}
