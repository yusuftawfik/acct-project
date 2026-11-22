// Pure business logic for the CIC journal (no web or database code here).
//
// Port of core.py. Same chart of accounts, same validation, same monthly
// year-to-date income tax formula.
//
// MONEY RULE: every amount inside this file is a whole number of cents
// (an integer). Never use decimal arithmetic on money. Convert at the edges:
//   toCents(19.99) -> 1999        (input from the API)
//   toMoney(1999)  -> 19.99       (output to the API)
// Lines passed to summary() and taxSuggestion() look like:
//   { date: 'YYYY-MM-DD', account_id: 1010, debit_cents: 500000, credit_cents: 0 }

export const FACULTIES = ['BA', 'BT', 'CS', 'Central'];
export const CASH_ID = 1010;
export const TAX_EXPENSE_ID = 5900;
export const TAX_PAYABLE_ID = 2030;

// [id, name, type, needs a faculty tag]
const ACCOUNT_ROWS = [
  [1010, 'Cash at bank', 'Asset', false],
  [1100, 'Fees receivable', 'Asset', false],
  [1110, 'Other receivables', 'Asset', false],
  [1200, 'Inventory: bookstore', 'Asset', false],
  [1210, 'Inventory: cafeteria', 'Asset', false],
  [1220, 'Inventory: lab and office supplies', 'Asset', false],
  [1500, 'Land and buildings', 'Asset', false],
  [1510, 'Lab and IT equipment', 'Asset', false],
  [1520, 'Furniture and fittings', 'Asset', false],
  [1530, 'Vehicles', 'Asset', false],
  [2010, 'Accounts payable', 'Liability', false],
  [2020, 'Salaries payable', 'Liability', false],
  [2030, 'Income tax payable', 'Liability', false],
  [3010, "Owner's capital", 'Equity', false],
  [3020, "Owner's drawings", 'Equity', false],
  [4010, 'Tuition fees', 'Revenue', true],
  [4020, 'Application and registration fees', 'Revenue', false],
  [4030, 'Bookstore sales', 'Revenue', false],
  [4040, 'Cafeteria sales', 'Revenue', false],
  [4050, 'Training and consulting services', 'Revenue', true],
  [4060, 'Facility rental income', 'Revenue', false],
  [5010, 'Academic salaries', 'Expense', true],
  [5020, 'Administrative salaries', 'Expense', false],
  [5030, 'Cost of sales: bookstore', 'Expense', false],
  [5040, 'Cost of sales: cafeteria', 'Expense', false],
  [5050, 'Lab and office supplies used', 'Expense', false],
  [5060, 'Utilities', 'Expense', false],
  [5070, 'Marketing and admissions', 'Expense', false],
  [5080, 'Repairs and maintenance', 'Expense', false],
  [5090, 'Scholarships and discounts', 'Expense', true],
  [5900, 'Income tax expense', 'Expense', false],
];
export const ACCOUNTS = new Map(
  ACCOUNT_ROWS.map(([id, name, type, facultyTag]) => [id, { name, type, facultyTag }]),
);

// [code, name, suggested debit text, suggested credit text]
const TEMPLATE_ROWS = [
  ['T01', 'Owner invests cash', '1010', '3010'],
  ['T02', 'Owner invests an asset', '15xx asset', '3010'],
  ['T03', 'Owner draws cash', '3020', '1010'],
  ['T04', 'Tuition billed', '1100', '4010'],
  ['T05', 'Tuition collected later', '1010', '1100'],
  ['T06', 'Tuition received in cash immediately', '1010', '4010'],
  ['T07', 'Application fees received', '1010', '4020'],
  ['T08', 'Bookstore sale (cash)', '1010', '4030'],
  ['T09', 'Cafeteria sale (cash)', '1010', '4040'],
  ['T10', 'Training or consulting service on account', '1110', '4050'],
  ['T11', 'Other receivable collected', '1010', '1110'],
  ['T12', 'Facility rental received', '1010', '4060'],
  ['T13', 'Scholarship paid in cash', '5090', '1010'],
  ['T14', 'Scholarship applied against fees owed', '5090', '1100'],
  ['T15', 'Inventory bought on account', '1200/1210/1220', '2010'],
  ['T16', 'Inventory bought for cash', '1200/1210/1220', '1010'],
  ['T17', 'Supplier paid', '2010', '1010'],
  ['T18', 'Stock sold: cost recorded', '5030/5040', '1200/1210'],
  ['T19', 'Lab or office supplies used', '5050', '1220'],
  ['T20', 'Asset bought for cash', '15xx asset', '1010'],
  ['T21', 'Asset bought on account', '15xx asset', '2010'],
  ['T22', 'Asset bought part cash, part account', '15xx asset', '1010 + 2010'],
  ['T23', 'Salaries paid in cash', '5010/5020', '1010'],
  ['T24', 'Salaries earned but unpaid', '5010/5020', '2020'],
  ['T25', 'Salaries payable settled', '2020', '1010'],
  ['T26', 'Utilities, marketing or maintenance paid in cash', '5060/5070/5080', '1010'],
  ['T27', 'Utilities, marketing or maintenance on account', '5060/5070/5080', '2010'],
  ['T28', 'Monthly income tax accrual', '5900', '2030'],
  ['T29', 'Income tax paid', '2030', '1010'],
  ['Custom', 'Custom entry', 'any', 'any'],
];
export const TEMPLATES = new Map(
  TEMPLATE_ROWS.map(([code, name, debit, credit]) => [code, { name, debit, credit }]),
);

// ---------------------------------------------------------------- money

/** Decimal amount (number or numeric string) -> whole cents. Empty/null -> 0. Throws TypeError if not a number. */
export function toCents(x) {
  if (x === null || x === undefined || x === '') return 0;
  let n = NaN;
  if (typeof x === 'number') n = x;
  else if (typeof x === 'string' && x.trim() !== '') n = Number(x);
  if (!Number.isFinite(n)) throw new TypeError('not a number');
  // toFixed(2) removes binary noise (19.99 * 100 = 1998.9999999999998) before scaling.
  return Math.round(Number(n.toFixed(2)) * 100);
}

/** Whole cents -> decimal amount for the API. The "+ 0" turns -0 into 0. */
export const toMoney = (cents) => cents / 100 + 0;

const fmt = (cents) =>
  (cents / 100).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Whole-number rounding that matches Excel's ROUND(x, 0) for x >= 0.
 * Halves go UP (2.5 -> 3), unlike banker's rounding which goes to the nearest even number.
 */
export function roundHalfUp(x) {
  return Math.floor(Number(x.toFixed(6)) + 0.5);
}

// Exact half-up rounding of the fraction n/d (BigInt, n >= 0, d > 0).
const roundRatioHalfUp = (n, d) => (2n * n + d) / (2n * d);

// 0.225 -> { num: 225000000n, den: 1000000000n } so the tax needs no floating point.
function rateFraction(rate) {
  const [whole, frac = ''] = Number(rate).toFixed(9).split('.');
  return { num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) };
}

// ---------------------------------------------------------------- dates

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' -> { y, m, d, iso } or null when missing or not a real calendar date. */
export function parseIsoDate(value) {
  const match = ISO_DATE.exec(String(value));
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d, iso: match[0] };
}

const pad = (n) => String(n).padStart(2, '0');

/** 1..12 inside the financial year, else null. */
export function fiscalMonth(date, fyStart) {
  const m = (date.y - fyStart.y) * 12 + date.m - fyStart.m + 1;
  return m >= 1 && m <= 12 ? m : null;
}

export function monthEnd(fyStart, monthNo) {
  const idx = fyStart.m - 1 + monthNo - 1;
  const y = fyStart.y + Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(lastDay)}`;
}

/** Accept 'YYYY-MM' or 1..12 (a fiscal month number); return the fiscal month or null. Empty -> 12. */
export function parseMonth(value, fyStart) {
  if (value === null || value === undefined || value === '') return 12;
  const s = String(value);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 12 ? n : null;
  }
  const parts = s.split('-');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) return null;
  const [y, m] = [Number(parts[0]), Number(parts[1])];
  if (m < 1 || m > 12) return null;
  return fiscalMonth({ y, m, d: 1 }, fyStart);
}

// ----------------------------------------------------------- validation

/**
 * Returns { clean, errors }. clean is null when there are errors.
 * clean.lines hold debit_cents / credit_cents (integers).
 */
export function validateEntry(payload, fyStart) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const errors = [];

  const date = parseIsoDate(p.date ?? '');
  if (!date) errors.push('Date is missing or not in YYYY-MM-DD format.');
  else if (fiscalMonth(date, fyStart) === null) {
    errors.push(`Date ${date.iso} is outside the financial year starting ${fyStart.iso}.`);
  }

  const txnType = p.txn_type || 'Custom';
  if (!TEMPLATES.has(txnType)) errors.push(`Unknown transaction type '${txnType}'.`);

  const rawLines = Array.isArray(p.lines) ? p.lines : [];
  if (rawLines.length < 2) errors.push('An entry needs at least two lines.');

  const entryFaculty = p.faculty || '';
  const lines = [];
  let totalDr = 0;
  let totalCr = 0;

  rawLines.forEach((raw, index) => {
    const i = index + 1;
    const ln = raw && typeof raw === 'object' ? raw : {};

    const acctRaw = ln.account_id;
    const acct = acctRaw === null || acctRaw === undefined || acctRaw === '' ? NaN : Number(acctRaw);
    if (!Number.isInteger(acct)) {
      errors.push(`Line ${i}: account is missing.`);
      return;
    }
    if (!ACCOUNTS.has(acct)) {
      errors.push(`Line ${i}: unknown account ${acct}.`);
      return;
    }

    let dr;
    let cr;
    try {
      dr = toCents(ln.debit);
      cr = toCents(ln.credit);
    } catch {
      errors.push(`Line ${i}: amount is not a number.`);
      return;
    }
    if (dr < 0 || cr < 0) errors.push(`Line ${i}: amounts must be positive.`);
    if (dr > 0 && cr > 0) errors.push(`Line ${i}: a line has a debit or a credit, not both.`);
    if (dr === 0 && cr === 0) errors.push(`Line ${i}: amount is missing.`);

    const { name, facultyTag } = ACCOUNTS.get(acct);
    let faculty = ln.faculty || entryFaculty;
    if (facultyTag) {
      if (!['BA', 'BT', 'CS'].includes(faculty)) {
        errors.push(`Line ${i}: ${acct} ${name} needs a faculty (BA, BT or CS).`);
      }
    } else {
      faculty = 'Central';
    }

    totalDr += dr;
    totalCr += cr;
    lines.push({ account_id: acct, debit_cents: dr, credit_cents: cr, faculty });
  });

  if (totalDr !== totalCr) {
    errors.push(`Entry is out of balance: debits ${fmt(totalDr)}, credits ${fmt(totalCr)}.`);
  }
  if (errors.length) return { clean: null, errors };

  return {
    clean: {
      date: date.iso,
      txn_type: txnType,
      description: String(p.description ?? '').trim(),
      lines,
    },
    errors: [],
  };
}

// ------------------------------------------------------------- reports

// Net (debit - credit) in cents per account, for lines inside the financial year.
function netByAccount(lines, fyStart, throughMonth, onlyMonth = null) {
  const net = new Map();
  for (const ln of lines) {
    const date = parseIsoDate(ln.date);
    const fm = date ? fiscalMonth(date, fyStart) : null;
    if (fm === null || fm > throughMonth) continue;
    if (onlyMonth !== null && fm !== onlyMonth) continue;
    net.set(ln.account_id, (net.get(ln.account_id) ?? 0) + ln.debit_cents - ln.credit_cents);
  }
  return net;
}

/** Statement of financial position totals and net income through a fiscal month (amounts in currency). */
export function summary(lines, fyStart, throughMonth = 12) {
  const net = netByAccount(lines, fyStart, throughMonth);
  const byType = { Asset: 0, Liability: 0, Revenue: 0, Expense: 0 };
  for (const [acct, amt] of net) {
    const { type } = ACCOUNTS.get(acct);
    if (type in byType) byType[type] += amt;
  }
  const revenue = 0 - byType.Revenue;
  const expenses = byType.Expense;
  const tax = net.get(TAX_EXPENSE_ID) ?? 0;
  const capital = 0 - (net.get(3010) ?? 0);
  const drawings = net.get(3020) ?? 0;
  const netIncome = revenue - expenses;
  const equity = capital + netIncome - drawings;
  const assets = byType.Asset;
  const liabilities = 0 - byType.Liability;
  const difference = assets - liabilities - equity;

  return {
    through_month: throughMonth,
    period_end: monthEnd(fyStart, throughMonth),
    cash: toMoney(net.get(CASH_ID) ?? 0),
    assets: toMoney(assets),
    liabilities: toMoney(liabilities),
    capital: toMoney(capital),
    revenue: toMoney(revenue),
    expenses_before_tax: toMoney(expenses - tax),
    profit_before_tax: toMoney(revenue - (expenses - tax)),
    income_tax: toMoney(tax),
    net_income: toMoney(netIncome),
    drawings: toMoney(drawings),
    equity: toMoney(equity),
    balance_difference: toMoney(difference),
    balanced: difference === 0,
  };
}

/**
 * Same rule as the Excel Tax sheet.
 * suggested = ROUND(max(0, rate x YTD profit before tax)) - tax expense recorded in earlier months
 * The multiplication uses exact integer (BigInt) math so half-way cases round up like Excel.
 */
export function taxSuggestion(lines, fyStart, monthNo, rate) {
  const ytdNet = netByAccount(lines, fyStart, monthNo);
  let revenue = 0;
  let expenses = 0;
  for (const [acct, amt] of ytdNet) {
    const { type } = ACCOUNTS.get(acct);
    if (type === 'Revenue') revenue -= amt;
    else if (type === 'Expense' && acct !== TAX_EXPENSE_ID) expenses += amt;
  }
  const ytd = revenue - expenses; // cents

  const { num, den } = rateFraction(rate);
  const requiredWhole = ytd > 0 ? Number(roundRatioHalfUp(BigInt(ytd) * num, den * 100n)) : 0; // whole currency units
  const required = requiredWhole * 100; // cents

  const before = monthNo > 1 ? netByAccount(lines, fyStart, monthNo - 1).get(TAX_EXPENSE_ID) ?? 0 : 0;
  const thisMonth = netByAccount(lines, fyStart, monthNo, monthNo).get(TAX_EXPENSE_ID) ?? 0;
  const suggested = required - before;
  const toPost = suggested - thisMonth; // what is still missing after anything already posted this month

  let proposal = null;
  if (Math.abs(toPost) >= 50) {
    const amt = toMoney(Math.abs(toPost));
    proposal =
      toPost > 0
        ? [
            { account_id: TAX_EXPENSE_ID, debit: amt, credit: 0 },
            { account_id: TAX_PAYABLE_ID, debit: 0, credit: amt },
          ]
        : [ // reverse part of earlier tax
            { account_id: TAX_PAYABLE_ID, debit: amt, credit: 0 },
            { account_id: TAX_EXPENSE_ID, debit: 0, credit: amt },
          ];
  }

  return {
    month: monthNo,
    period_end: monthEnd(fyStart, monthNo),
    profit_before_tax_ytd: toMoney(ytd),
    rate: Number(rate),
    tax_required_ytd: requiredWhole,
    recorded_before_this_month: toMoney(before),
    recorded_this_month: toMoney(thisMonth),
    suggested: toMoney(suggested),
    to_post: toMoney(toPost),
    up_to_date: Math.abs(toPost) <= 50,
    proposal,
  };
}
