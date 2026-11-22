// Financial statements built from the journal, in code (no Excel needed).
// Mirrors the formulas of CIC_Financial_Model_v2.xlsx: Trial Balance, Tax, Financial Position, Income Statement,
// Net Income, Cash Flows, Owners Equity, Notes and Checks.
//
// MONEY RULE (same as core.js): every amount here is a whole number of cents. Nothing is converted to decimals
// until the PDF writer formats it for display.
import { ACCOUNTS, CASH_ID, TAX_EXPENSE_ID, TAX_PAYABLE_ID, fiscalMonth, monthEnd, parseIsoDate } from './core.js';

export const FACULTY_CODES = ['BA', 'BT', 'CS', 'Central'];
export const FACULTY_NAMES = {
  BA: 'Business Administration',
  BT: 'Business Technology',
  CS: 'Computer Science',
  Central: 'Central (shared, not faculty-specific)',
};

// Chart-of-accounts columns that core.js does not carry: statement line, normal balance and the cash flow label
// (the label a cash line takes from the account on the opposite side of the entry).
const CASH_FLOW_LABEL = {
  1010: '(cash account)',
  1100: 'Received from students',
  1110: 'Received from services',
  1200: 'Paid to suppliers',
  1210: 'Paid to suppliers',
  1220: 'Paid to suppliers',
  1500: 'Paid for assets',
  1510: 'Paid for assets',
  1520: 'Paid for assets',
  1530: 'Paid for assets',
  2010: 'Paid to suppliers',
  2020: 'Paid to employees',
  2030: 'Paid for income tax',
  3010: 'Owner investment',
  3020: 'Owner drawings',
  4010: 'Received from students',
  4020: 'Received from students',
  4030: 'Received from sales',
  4040: 'Received from sales',
  4050: 'Received from services',
  4060: 'Received from services',
  5010: 'Paid to employees',
  5020: 'Paid to employees',
  5030: 'Non-cash',
  5040: 'Non-cash',
  5050: 'Non-cash',
  5060: 'Paid to suppliers',
  5070: 'Paid to suppliers',
  5080: 'Paid to suppliers',
  5090: 'Paid to students',
  5900: 'Paid for income tax',
};

function statementLine(id, type) {
  if (type === 'Asset') return id >= 1500 ? 'Non-current assets' : 'Current assets';
  if (type === 'Liability') return 'Current liabilities';
  if (type === 'Equity') return id === 3020 ? "Owner's equity (deduction)" : "Owner's equity";
  if (type === 'Revenue') return 'Revenue';
  return id === TAX_EXPENSE_ID ? 'Income tax' : 'Operating expenses';
}

export const CHART = [...ACCOUNTS].map(([id, a]) => ({
  id,
  name: a.name,
  type: a.type,
  normal: a.type === 'Asset' || a.type === 'Expense' || id === 3020 ? 'Debit' : 'Credit',
  statementLine: statementLine(id, a.type),
  facultyTag: a.facultyTag,
  cashFlowLine: CASH_FLOW_LABEL[id],
}));
const CHART_BY_ID = new Map(CHART.map((a) => [a.id, a]));

export const CASH_RECEIVED = ['Received from students', 'Received from sales', 'Received from services', 'Owner investment'];
export const CASH_PAID = ['Paid to employees', 'Paid to suppliers', 'Paid for assets', 'Paid to students', 'Paid for income tax', 'Owner drawings'];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Jul 2026' for fiscal month 1..12. */
export function monthLabel(fyStart, monthNo) {
  const idx = fyStart.m - 1 + monthNo - 1;
  return `${MONTH_NAMES[idx % 12]} ${fyStart.y + Math.floor(idx / 12)}`;
}

// ------------------------------------------------------------ exact integer helpers

// Exact half-up rounding of n/d for BigInt n >= 0, d > 0 (same as core.js, matches Excel's ROUND).
const roundRatioHalfUp = (n, d) => (2n * n + d) / (2n * d);
function rateFraction(rate) {
  const [whole, frac = ''] = Number(rate).toFixed(9).split('.');
  return { num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) };
}

/** Splits `total` (signed cents) across `weights` (non-negative integers) with no cent lost (largest remainder). */
export function splitCents(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const abs = BigInt(Math.abs(total));
  const W = BigInt(sum);
  const parts = weights.map((w, i) => {
    const num = abs * BigInt(w);
    return { i, base: num / W, rem: num % W };
  });
  let left = abs - parts.reduce((a, p) => a + p.base, 0n);
  const order = [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const p of order) {
    if (left === 0n) break;
    if (weights[p.i] > 0) {
      p.base += 1n;
      left -= 1n;
    }
  }
  const sign = total < 0 ? -1 : 1;
  return parts.map((p) => sign * Number(p.base));
}

// ---------------------------------------------------------------------- the report

/**
 * lines: [{ entry_id, date, txn_type, description, account_id, debit_cents, credit_cents, faculty }] in journal order
 *        (what db.flatLines() returns).
 * through: fiscal month 1..12 (the "Report through" month).
 * options: { entity, currency, taxRate }
 */
export function buildReport(lines, fyStart, through, options = {}) {
  const taxRate = options.taxRate ?? 0.225;
  const entity = options.entity ?? 'Canadian International College (CIC)';
  const currency = options.currency ?? 'EGP';

  // ----- journal rows with the computed columns (Journal sheet columns I to S)
  const entryNet = new Map(); // entry_id -> net debit-credit on the cash account
  const entryTotals = new Map(); // entry_id -> { dr, cr }
  const entryNonCash = new Map(); // entry_id -> { dr, cr } on accounts other than cash
  for (const l of lines) {
    const t = entryTotals.get(l.entry_id) ?? { dr: 0, cr: 0 };
    t.dr += l.debit_cents;
    t.cr += l.credit_cents;
    entryTotals.set(l.entry_id, t);
    if (l.account_id === CASH_ID) entryNet.set(l.entry_id, (entryNet.get(l.entry_id) ?? 0) + l.debit_cents - l.credit_cents);
    else {
      const n = entryNonCash.get(l.entry_id) ?? { dr: 0, cr: 0 };
      n.dr += l.debit_cents;
      n.cr += l.credit_cents;
      entryNonCash.set(l.entry_id, n);
    }
  }

  // Cash allocation: the entry's net cash is shared over the non-cash lines on the opposite side, in proportion
  // to their amounts (cents are split with no remainder lost).
  const alloc = new Array(lines.length).fill(0);
  const byEntry = new Map();
  lines.forEach((l, i) => {
    if (!byEntry.has(l.entry_id)) byEntry.set(l.entry_id, []);
    byEntry.get(l.entry_id).push(i);
  });
  for (const [entryId, idxs] of byEntry) {
    const O = entryNet.get(entryId) ?? 0;
    if (O === 0) continue;
    const side = O > 0 ? 'credit_cents' : 'debit_cents';
    const eligible = idxs.filter((i) => lines[i].account_id !== CASH_ID);
    const weights = eligible.map((i) => lines[i][side]);
    const shares = splitCents(O, weights);
    eligible.forEach((i, k) => {
      alloc[i] = shares[k];
    });
  }

  const rows = lines.map((l, i) => {
    const acct = CHART_BY_ID.get(l.account_id);
    const date = parseIsoDate(l.date);
    const fm = date ? fiscalMonth(date, fyStart) : null;
    const t = entryTotals.get(l.entry_id) ?? { dr: 0, cr: 0 };
    const faculty = l.faculty || 'Central';
    let status = 'OK';
    if (!acct) status = 'Unknown account';
    else if (fm === null) status = 'Date missing or outside year';
    else if (l.debit_cents < 0 || l.credit_cents < 0) status = 'Negative amount';
    else if (l.debit_cents > 0 && l.credit_cents > 0) status = 'Debit and credit both filled';
    else if (l.debit_cents + l.credit_cents === 0) status = 'No amount';
    else if (acct.facultyTag && faculty === 'Central') status = 'Faculty required';
    return {
      entry_id: l.entry_id,
      date: l.date,
      txn_type: l.txn_type,
      account_id: l.account_id,
      debit_cents: l.debit_cents,
      credit_cents: l.credit_cents,
      faculty,
      description: l.description ?? '',
      account_name: acct ? acct.name : 'Unknown account',
      account_type: acct ? acct.type : 'Unknown account',
      statement_line: acct ? acct.statementLine : 'Unknown account',
      fiscal_month: fm,
      cash_flow_line: acct ? acct.cashFlowLine : 'Unknown account',
      net_cents: l.debit_cents - l.credit_cents,
      entry_net_cash_cents: entryNet.get(l.entry_id) ?? 0,
      cash_allocated_cents: l.account_id === CASH_ID ? 0 : alloc[i],
      entry_diff_cents: t.dr - t.cr,
      status,
    };
  });

  // ----- trial balance: net movement per account per fiscal month
  const movement = new Map(CHART.map((a) => [a.id, new Array(12).fill(0)]));
  for (const r of rows) {
    if (r.fiscal_month === null || !movement.has(r.account_id)) continue;
    movement.get(r.account_id)[r.fiscal_month - 1] += r.net_cents;
  }
  const trialBalance = CHART.map((a) => {
    const months = movement.get(a.id);
    const cumulative = months.slice(0, through).reduce((x, y) => x + y, 0);
    return {
      ...a,
      months,
      selected: months[through - 1],
      cumulative,
      debit: cumulative > 0 ? cumulative : 0,
      credit: cumulative < 0 ? -cumulative : 0,
    };
  });
  const tb = new Map(trialBalance.map((a) => [a.id, a]));
  const cum = (id) => tb.get(id).cumulative;
  const sel = (id) => tb.get(id).selected;
  const totals = {
    months: Array.from({ length: 12 }, (_, m) => trialBalance.reduce((s, a) => s + a.months[m], 0)),
    selected: trialBalance.reduce((s, a) => s + a.selected, 0),
    cumulative: trialBalance.reduce((s, a) => s + a.cumulative, 0),
    debit: trialBalance.reduce((s, a) => s + a.debit, 0),
    credit: trialBalance.reduce((s, a) => s + a.credit, 0),
  };

  // ----- income statement and net income
  const revenueIds = CHART.filter((a) => a.type === 'Revenue').map((a) => a.id);
  const expenseIds = CHART.filter((a) => a.type === 'Expense' && a.id !== TAX_EXPENSE_ID).map((a) => a.id);
  const incomeStatement = {
    revenue: revenueIds.map((id) => ({ id, name: tb.get(id).name, month: -sel(id), ytd: -cum(id) })),
    expenses: expenseIds.map((id) => ({ id, name: tb.get(id).name, month: sel(id), ytd: cum(id) })),
  };
  const sumKey = (list, k) => list.reduce((s, r) => s + r[k], 0);
  const totalRevenue = { month: sumKey(incomeStatement.revenue, 'month'), ytd: sumKey(incomeStatement.revenue, 'ytd') };
  const totalExpenses = { month: sumKey(incomeStatement.expenses, 'month'), ytd: sumKey(incomeStatement.expenses, 'ytd') };
  const pbt = { month: totalRevenue.month - totalExpenses.month, ytd: totalRevenue.ytd - totalExpenses.ytd };
  const taxLine = { month: -sel(TAX_EXPENSE_ID), ytd: -cum(TAX_EXPENSE_ID) };
  const netIncome = { month: pbt.month + taxLine.month, ytd: pbt.ytd + taxLine.ytd };
  const netIncomeSheet = {
    revenue: totalRevenue,
    expenses: { month: -totalExpenses.month, ytd: -totalExpenses.ytd },
    pbt,
    tax: taxLine,
    net: netIncome,
    rate: taxRate,
    effective: {
      month: pbt.month > 0 ? -taxLine.month / pbt.month : 0,
      ytd: pbt.ytd > 0 ? -taxLine.ytd / pbt.ytd : 0,
    },
    margin: {
      month: totalRevenue.month === 0 ? 0 : netIncome.month / totalRevenue.month,
      ytd: totalRevenue.ytd === 0 ? 0 : netIncome.ytd / totalRevenue.ytd,
    },
  };

  // ----- statement of financial position
  const assetRow = (id) => ({ id, name: tb.get(id).name, amount: cum(id) });
  const liabRow = (id) => ({ id, name: tb.get(id).name, amount: -cum(id) });
  const currentAssets = [1010, 1100, 1110, 1200, 1210, 1220].map(assetRow);
  const nonCurrentAssets = [1500, 1510, 1520, 1530].map(assetRow);
  const totalCurrent = sumKey(currentAssets, 'amount');
  const totalNonCurrent = sumKey(nonCurrentAssets, 'amount');
  const totalAssets = totalCurrent + totalNonCurrent;
  const liabilities = [2010, 2020, 2030].map(liabRow);
  const totalLiabilities = sumKey(liabilities, 'amount');
  const capital = -cum(3010);
  const drawingsShown = -cum(3020); // shown as a negative number (a deduction)
  const totalEquity = capital + netIncome.ytd + drawingsShown;
  const financialPosition = {
    currentAssets,
    nonCurrentAssets,
    totalCurrent,
    totalNonCurrent,
    totalAssets,
    liabilities,
    totalLiabilities,
    capital,
    netIncomeToDate: netIncome.ytd,
    drawings: drawingsShown,
    totalEquity,
    totalLE: totalLiabilities + totalEquity,
    difference: totalAssets - (totalLiabilities + totalEquity),
  };

  // ----- cash flows
  const flow = (label, upTo, only) => {
    let s = 0;
    for (const r of rows) {
      if (r.fiscal_month === null) continue;
      if (only ? r.fiscal_month !== through : r.fiscal_month > through) continue;
      if (upTo === 'all') s += r.cash_allocated_cents;
      else if (r.cash_flow_line === label) s += r.cash_allocated_cents;
    }
    return s;
  };
  const flowRow = (label) => ({ label, month: flow(label, 'x', true), ytd: flow(label, 'x', false) });
  const received = CASH_RECEIVED.map(flowRow);
  const paid = CASH_PAID.map(flowRow);
  const totalReceived = { month: sumKey(received, 'month'), ytd: sumKey(received, 'ytd') };
  const totalPaid = { month: sumKey(paid, 'month'), ytd: sumKey(paid, 'ytd') };
  const unclassified = {
    month: flow(null, 'all', true) - totalReceived.month - totalPaid.month,
    ytd: flow(null, 'all', false) - totalReceived.ytd - totalPaid.ytd,
  };
  const net = {
    month: totalReceived.month + totalPaid.month + unclassified.month,
    ytd: totalReceived.ytd + totalPaid.ytd + unclassified.ytd,
  };
  const openingMonth = tb.get(CASH_ID).months.slice(0, through - 1).reduce((a, b) => a + b, 0);
  const cashFlows = {
    received,
    paid,
    totalReceived,
    totalPaid,
    unclassified,
    net,
    opening: { month: openingMonth, ytd: 0 },
    closing: { month: net.month + openingMonth, ytd: net.ytd },
  };

  // ----- owner's equity
  const openingCapital = 0;
  const ownersEquity = {
    opening: openingCapital,
    introduced: -cum(3010) - openingCapital,
    netIncome: netIncome.ytd,
    drawings: -cum(3020),
  };
  ownersEquity.closing = ownersEquity.opening + ownersEquity.introduced + ownersEquity.netIncome + ownersEquity.drawings;

  // ----- tax sheet (all twelve months)
  const { num, den } = rateFraction(taxRate);
  const taxMonths = [];
  let ytdPbt = 0;
  let recordedEarlier = 0;
  for (let m = 1; m <= 12; m++) {
    const rev = -revenueIds.reduce((s, id) => s + movement.get(id)[m - 1], 0);
    const opex = expenseIds.reduce((s, id) => s + movement.get(id)[m - 1], 0);
    const pbtMonth = rev - opex;
    ytdPbt += pbtMonth;
    const requiredWhole = ytdPbt > 0 ? Number(roundRatioHalfUp(BigInt(ytdPbt) * num, den * 100n)) : 0;
    const required = requiredWhole * 100;
    const recorded = movement.get(TAX_EXPENSE_ID)[m - 1];
    const suggested = required - recordedEarlier;
    const variance = recorded - suggested;
    taxMonths.push({
      month: m,
      label: monthLabel(fyStart, m),
      revenue: rev,
      opex,
      pbt: pbtMonth,
      pbtYtd: ytdPbt,
      required,
      recorded,
      recordedEarlier,
      suggested,
      variance,
      status: Math.abs(variance) <= 50 ? 'OK' : 'Post / review',
    });
    recordedEarlier += recorded;
  }

  // ----- notes
  const faculties = FACULTY_CODES;
  const facultyAmount = (id, f, sign) =>
    sign *
      rows
        .filter((r) => r.account_id === id && r.faculty === f && r.fiscal_month !== null && r.fiscal_month <= through)
        .reduce((s, r) => s + r.net_cents, 0) +
    0; // the "+ 0" turns -0 into 0
  const noteTable = (ids, sign) =>
    ids.map((id) => {
      const byFaculty = faculties.map((f) => facultyAmount(id, f, sign));
      return { id, name: tb.get(id).name, byFaculty, total: byFaculty.reduce((a, b) => a + b, 0) };
    });
  const note2 = noteTable(revenueIds, -1);
  const note2Total = faculties.map((_, k) => note2.reduce((s, r) => s + r.byFaculty[k], 0));
  const note3 = noteTable([5010, 5090], 1);
  const costTotals = faculties.map((_, k) => note3.reduce((s, r) => s + r.byFaculty[k], 0));
  const facultyRevenue = faculties.map((_, k) => note2[0].byFaculty[k] + note2[4].byFaculty[k]); // 4010 + 4050
  const contribution = faculties.map((_, k) => facultyRevenue[k] - costTotals[k]);
  const sumArr = (a) => a.reduce((x, y) => x + y, 0);
  const listFor = (ids, sign = 1) => ids.map((id) => ({ id, name: tb.get(id).name, amount: sign * cum(id) }));
  const taxPaid = -rows
    .filter((r) => r.fiscal_month !== null && r.fiscal_month <= through && r.cash_flow_line === 'Paid for income tax')
    .reduce((s, r) => s + r.cash_allocated_cents, 0);
  const taxExpenseRecorded = cum(TAX_EXPENSE_ID);
  const taxPayable = -cum(TAX_PAYABLE_ID);
  const notes = {
    note2: { rows: note2, totals: note2Total, grand: sumArr(note2Total) },
    note3: {
      rows: note3,
      totals: costTotals,
      grandCosts: sumArr(costTotals),
      facultyRevenue,
      grandFacultyRevenue: sumArr(facultyRevenue),
      contribution,
      grandContribution: sumArr(contribution),
    },
    inventory: listFor([1200, 1210, 1220]),
    receivables: listFor([1100, 1110]),
    payables: listFor([2010, 2020, 2030], -1),
    property: listFor([1500, 1510, 1520, 1530]),
    tax: {
      pbtYtd: pbt.ytd,
      rate: taxRate,
      expense: taxExpenseRecorded,
      paid: taxPaid,
      payable: taxPayable,
      check: taxExpenseRecorded - taxPaid - taxPayable,
    },
  };
  for (const key of ['inventory', 'receivables', 'payables', 'property']) notes[key + 'Total'] = sumKey(notes[key], 'amount');

  // ----- checks
  const sumDebits = rows.reduce((s, r) => s + r.debit_cents, 0);
  const sumCredits = rows.reduce((s, r) => s + r.credit_cents, 0);
  const checks = [
    { test: 'Journal: total debits equal total credits', value: sumDebits - sumCredits, where: 'Journal debit and credit columns' },
    { test: 'Journal: every EntryID balances (lines in unbalanced entries)', value: rows.filter((r) => r.entry_diff_cents !== 0).length, count: true, where: 'Entries whose debits and credits differ' },
    { test: 'Journal: every line is valid (lines not marked OK)', value: rows.filter((r) => r.status !== 'OK').length, count: true, where: 'Journal Status column' },
    { test: 'Trial balance: debit balances equal credit balances', value: totals.debit - totals.credit, where: 'Trial Balance debit and credit columns' },
    { test: "Accounting equation: assets = liabilities + owner's equity", value: financialPosition.difference, where: 'Financial Position, difference row' },
    { test: 'Cash flow closing cash equals cash on the Statement of Financial Position', value: cashFlows.closing.ytd - cum(CASH_ID), where: 'Cash Flows year to date vs account 1010' },
    { test: 'All cash movements are classified to a cash flow line', value: unclassified.ytd, where: 'Journal Cash Flow Line vs Cash Flows rows' },
    { test: "Owner's equity statement closing equals Financial Position equity", value: ownersEquity.closing - financialPosition.totalEquity, where: 'Owners Equity vs Financial Position' },
    { test: 'Income tax recorded is up to date for every month through the selected month', value: taxMonths.filter((t) => t.month <= through && Math.abs(t.variance) > 50).length, count: true, where: 'Tax sheet: suggested entry vs recorded' },
    { test: 'Income tax: expense minus paid equals payable (Note 7)', value: notes.tax.check, where: 'Notes, Note 7' },
  ].map((c, i) => ({ n: i + 1, ...c, pass: c.value === 0 }));
  const failing = checks.filter((c) => !c.pass).length;

  return {
    meta: {
      entity,
      currency,
      fyStart: fyStart.iso,
      fyEnd: monthEnd(fyStart, 12),
      through,
      throughLabel: monthLabel(fyStart, through),
      periodEnd: monthEnd(fyStart, through),
      monthLabels: Array.from({ length: 12 }, (_, i) => monthLabel(fyStart, i + 1)),
      taxRate,
    },
    journal: rows,
    trialBalance,
    trialBalanceTotals: totals,
    taxMonths,
    incomeStatement: { ...incomeStatement, totalRevenue, totalExpenses, pbt },
    netIncome: netIncomeSheet,
    financialPosition,
    cashFlows,
    ownersEquity,
    notes,
    checks,
    overall: failing === 0 ? 'ALL CHECKS PASS' : `${failing} CHECK(S) FAILING`,
  };
}
