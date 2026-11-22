// Generates a synthetic sample financial year for CIC and posts it through the API.
//
// Port of legacy/seed_sample_year.py. Same assumptions, same random numbers, same journal.
// Everything in the ASSUMPTIONS block is invented sample data, not real accounts.
// Change a number, run the script again, and the whole year changes with it.
//
// Usage (from the server/ folder, with `npm start` running in another window):
//
//   node scripts/seed-sample-year.js --dry-run                       build and check the year, post nothing
//   node scripts/seed-sample-year.js --dry-run --csv sample_journal.csv
//   node scripts/seed-sample-year.js                                 post to http://127.0.0.1:5000
//   node scripts/seed-sample-year.js --reset                         delete existing entries first (asks to confirm)
//
// If the server has CIC_API_KEY set, pass --api-key or set the same environment variable.
//
// MONEY RULE: the assumptions below are whole EGP, the same as the Python version. The entries that
// come out of the builder hold integer CENTS (core.js converts them), and the API gets normal decimals.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as core from '../src/core.js';

// =====================================================================
// Python-compatible random numbers
// =====================================================================
// The sample year uses small random "jitter" on sales and costs. To get the SAME journal as the
// Python version (259 entries), JavaScript has to produce the SAME random numbers as Python's
// random.Random(2026). Math.random() cannot do that, so this is the Mersenne Twister (MT19937)
// that Python uses, with Python's seeding and its random() / uniform() formulas.

const N = 624;
const M = 397;

export class Mt19937 {
  constructor(key) {
    this.mt = new Uint32Array(N);
    this.index = N;
    this.initByArray(key);
  }

  initGenrand(seed) {
    const mt = this.mt;
    mt[0] = seed >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1];
      mt[i] = Math.imul(1812433253, prev ^ (prev >>> 30)) + i; // wraps to 32 bits on store
    }
    this.index = N;
  }

  initByArray(key) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1664525)) + key[j] + j;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      mt[i] = (mt[i] ^ Math.imul(mt[i - 1] ^ (mt[i - 1] >>> 30), 1566083941)) - i;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
    this.index = N;
  }

  #regenerate() {
    const mt = this.mt;
    const UPPER = 0x80000000;
    const LOWER = 0x7fffffff;
    const MATRIX_A = 0x9908b0df;
    let kk = 0;
    let y;
    for (; kk < N - M; kk++) {
      y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
      mt[kk] = mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
    }
    for (; kk < N - 1; kk++) {
      y = (mt[kk] & UPPER) | (mt[kk + 1] & LOWER);
      mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
    }
    y = (mt[N - 1] & UPPER) | (mt[0] & LOWER);
    mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0);
    this.index = 0;
  }

  /** Next 32-bit unsigned integer. */
  nextUint32() {
    if (this.index >= N) this.#regenerate();
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
}

/** Same numbers as Python's random.Random(seed) for an integer seed. */
export class PyRandom extends Mt19937 {
  constructor(seed) {
    // Python turns an integer seed into a list of 32-bit words (lowest first).
    let n = BigInt(Math.abs(Math.trunc(seed)));
    const key = [];
    do {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    } while (n > 0n);
    super(key);
  }

  /** Float in [0, 1) with 53 random bits, like Python's random.random(). */
  random() {
    const a = this.nextUint32() >>> 5;
    const b = this.nextUint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Like Python's random.uniform(a, b). */
  uniform(a, b) {
    return a + (b - a) * this.random();
  }
}

// Python's round() goes to the nearest EVEN number on an exact half (round(2.5) is 2).
// These two helpers copy that, so every rounded amount matches the Python version.

/** Python's round(x) for x >= 0. */
export function pyRound(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python's round(x, -2) for x >= 0: nearest hundred, exact halves to the even hundred. */
export function pyRoundHundreds(x) {
  const rest = x % 100; // exact for floats
  let low = x - rest;
  if (rest > 50) low += 100;
  else if (rest === 50 && (low / 100) % 2 === 1) low += 100;
  return low;
}

// =====================================================================
// ASSUMPTIONS (all invented, amounts in whole EGP)
// Month numbers: 1 = July ... 12 = June (financial year 1 July to 30 June)
// =====================================================================
export const SEED = 2026;

// Students per faculty: [semester 1, semester 2]. Total about 3,000.
const STUDENTS = { BA: [1040, 1020], BT: [960, 940], CS: [1000, 985] };
const TUITION_PER_SEMESTER = { BA: 45_000, BT: 55_000, CS: 65_000 };
const SCHOLARSHIP_RATE = 0.08; // share of billed tuition given as scholarships/discounts

// Tuition is earned while the semester is taught, so it is billed in equal monthly instalments:
// semester 1 in September to January, semester 2 in February to June. (Billing the whole semester
// up front would need unearned revenue, which the course has not covered yet.)
const TEACHING_MONTHS = [
  [3, 4, 5, 6, 7], // semester 1
  [8, 9, 10, 11, 12], // semester 2
];
const COLLECT_SAME_MONTH = 0.7; // share of each month's net bill collected in that month; the rest the month after

//                       Jul  Aug  Sep  Oct  Nov  Dec  Jan  Feb  Mar  Apr  May  Jun   (millions EGP)
const APPLICATION_FEES = [0.9, 1.3, 0.4, 0.3, 0.3, 0.4, 0.7, 0.5, 0.5, 0.7, 0.9, 1.1];
const BOOKSTORE_SALES = [0.2, 0.8, 4.5, 1.2, 0.8, 0.6, 0.5, 3.0, 0.8, 0.6, 0.5, 0.3];
const CAFETERIA_SALES = [0.4, 0.3, 1.6, 2.2, 2.2, 1.8, 1.2, 1.8, 2.2, 2.1, 2.0, 0.9];
const FACILITY_RENTAL = [1.2, 1.2, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.5, 0.9];
const UTILITIES = [2.4, 2.6, 2.0, 1.7, 1.5, 1.5, 1.5, 1.5, 1.6, 1.8, 2.2, 2.5];
const MARKETING = [3.0, 3.5, 1.5, 1.0, 0.8, 0.8, 1.2, 1.5, 2.5, 3.0, 3.2, 3.0];
const MAINTENANCE = [4.0, 3.5, 1.0, 0.8, 0.8, 0.8, 0.8, 1.0, 0.8, 0.8, 1.0, 2.0];

const TRAINING_BASE = { BA: 350_000, BT: 450_000, CS: 650_000 }; // training and consulting per month
const TRAINING_SEASON = [1.2, 1.1, 0.9, 1.0, 1.0, 0.9, 0.8, 0.9, 1.0, 1.0, 1.1, 1.2];

const ACADEMIC_SALARY_MONTHLY = { BA: 3_830_000, BT: 4_000_000, CS: 4_670_000 };
const ADMIN_SALARY_MONTHLY = 4_200_000;

const BOOKSTORE_COST_RATE = 0.7;
const CAFETERIA_COST_RATE = 0.65;
const SUPPLIES_USED_MONTHLY = 800_000;
const SUPPLIES_PURCHASES = { 1: 6_000_000, 7: 4_000_000 }; // bought for cash in July and January

const OWNER_CASH = 120_000_000;
const OWNER_BUILDINGS = 400_000_000;

// Equipment purchases: month, day, template, asset account, total, cash paid now, month the rest is paid
const EQUIPMENT = [
  { m: 1, day: 8, txn: 'T22', asset: 1510, total: 12_000_000, cash: 4_000_000, due: 4, what: 'Lab and IT equipment' },
  { m: 2, day: 20, txn: 'T20', asset: 1520, total: 3_000_000, cash: 3_000_000, due: null, what: 'Furniture and fittings' },
  { m: 2, day: 25, txn: 'T20', asset: 1530, total: 2_400_000, cash: 2_400_000, due: null, what: 'Vehicles' },
  { m: 7, day: 12, txn: 'T21', asset: 1510, total: 6_000_000, cash: 0, due: 10, what: 'Lab and IT equipment' },
];
const DRAWINGS = { 6: 20_000_000, 12: 25_000_000 }; // owner draws in December and June
const TAX_PAY_MONTHS = [4, 7, 10]; // tax paid in Oct, Jan, Apr for the quarter before
export const TAX_RATE = 0.225;

const SALES_JITTER = 0.06; // random +/- variation on sales
const COST_JITTER = 0.05; // random +/- variation on utilities

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// =====================================================================
// Building the year
// =====================================================================

class SeedError extends Error {}

/** Date inside fiscal month m (1 = first month of the year) as 'YYYY-MM-DD'; day is capped at month end. */
function mdate(fyStart, m, day) {
  const idx = fyStart.m - 1 + m - 1;
  const y = fyStart.y + Math.floor(idx / 12);
  const mo = (idx % 12) + 1;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/**
 * Returns { entries, flat, summaries }. Every entry is validated by core.validateEntry.
 * entries: clean entries (lines hold debit_cents / credit_cents)
 * flat:    one row per journal line, the shape core.summary() and core.taxSuggestion() expect
 * summaries: core.summary() for each of the 12 months, plus month and label
 */
export function buildYear(fyStart, taxRate = TAX_RATE, seed = SEED) {
  const rnd = new PyRandom(seed);

  // Same order of random draws as the Python version: this order decides every number.
  const jit = (base, j) => pyRoundHundreds(base * (1 + rnd.uniform(-j, j)));
  const millions = (arr, j) => arr.map((v) => jit(v * 1_000_000, j));
  const appFees = millions(APPLICATION_FEES, SALES_JITTER);
  const book = millions(BOOKSTORE_SALES, SALES_JITTER);
  const cafe = millions(CAFETERIA_SALES, SALES_JITTER);
  const rental = millions(FACILITY_RENTAL, SALES_JITTER);
  const util = millions(UTILITIES, COST_JITTER);
  const mark = millions(MARKETING, COST_JITTER);
  const maint = millions(MAINTENANCE, COST_JITTER);
  const bookCost = book.map((v) => pyRound(v * BOOKSTORE_COST_RATE));
  const cafeCost = cafe.map((v) => pyRound(v * CAFETERIA_COST_RATE));
  const training = {};
  for (const f of Object.keys(TRAINING_BASE)) {
    training[f] = [];
    for (let i = 0; i < 12; i++) training[f].push(jit(TRAINING_BASE[f] * TRAINING_SEASON[i], SALES_JITTER));
  }

  const entries = [];
  const flat = [];
  const summaries = [];
  const apDue = []; // [month, amount] supplier amounts to pay
  const state = { salariesPrev: 0, trainingPrev: 0, unpaidPrev: 0 };
  const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

  const validate = (payload) => {
    const { clean, errors } = core.validateEntry(payload, fyStart);
    if (errors.length) throw new SeedError(`Generated entry is invalid: ${errors.join(' ')}\n${JSON.stringify(payload)}`);
    return clean;
  };

  const addToFlat = (clean) => {
    for (const ln of clean.lines) {
      flat.push({ date: clean.date, account_id: ln.account_id, debit_cents: ln.debit_cents, credit_cents: ln.credit_cents });
    }
  };

  // Balance (debit - credit, in cents) of one account through a fiscal month.
  const balance = (acct, through) => {
    let total = 0;
    for (const ln of flat) {
      const fm = core.fiscalMonth(core.parseIsoDate(ln.date), fyStart);
      if (ln.account_id === acct && fm !== null && fm <= through) total += ln.debit_cents - ln.credit_cents;
    }
    return total;
  };

  for (let m = 1; m <= 12; m++) {
    const pending = []; // { date, seq, clean }

    // lines: [account, debit, credit, faculty] in whole EGP; zero lines are dropped
    const post = (day, txn, desc, lines, monthEnd = false) => {
      const date = monthEnd ? core.monthEnd(fyStart, m) : mdate(fyStart, m, day);
      const payload = {
        date,
        txn_type: txn,
        description: desc,
        lines: lines
          .filter(([, dr, cr]) => dr || cr)
          .map(([account_id, debit, credit, faculty]) => ({ account_id, debit, credit, faculty })),
      };
      pending.push({ date, seq: pending.length, clean: validate(payload) });
    };

    const i = m - 1;
    const label = MONTH_NAMES[Number(mdate(fyStart, m, 1).slice(5, 7)) - 1];

    // --- owner and equipment
    if (m === 1) {
      post(1, 'T01', 'Owner invests cash to start the year', [[1010, OWNER_CASH, 0, null], [3010, 0, OWNER_CASH, null]]);
      post(1, 'T02', 'Owner contributes campus land and buildings (at cost)',
        [[1500, OWNER_BUILDINGS, 0, null], [3010, 0, OWNER_BUILDINGS, null]]);
    }
    for (const eq of EQUIPMENT) {
      if (eq.m !== m) continue;
      const onAccount = eq.total - eq.cash;
      const lines = [[eq.asset, eq.total, 0, null]];
      if (eq.cash) lines.push([1010, 0, eq.cash, null]);
      if (onAccount) {
        lines.push([2010, 0, onAccount, null]);
        apDue.push([eq.due, onAccount]);
      }
      post(eq.day, eq.txn, `Purchase: ${eq.what}`, lines);
    }
    if (m in DRAWINGS) {
      post(20, 'T03', "Owner's drawings", [[3020, DRAWINGS[m], 0, null], [1010, 0, DRAWINGS[m], null]]);
    }

    // --- tuition: monthly billing while teaching, scholarships, collections
    if (state.unpaidPrev > 0) {
      post(8, 'T05', "Tuition collected from last month's bill",
        [[1010, state.unpaidPrev, 0, null], [1100, 0, state.unpaidPrev, null]]);
      state.unpaidPrev = 0;
    }
    TEACHING_MONTHS.forEach((months, sem) => {
      if (!months.includes(m)) return;
      const n = months.length;
      const gross = {};
      const schol = {};
      for (const f of Object.keys(STUDENTS)) gross[f] = pyRound((STUDENTS[f][sem] * TUITION_PER_SEMESTER[f]) / n);
      for (const f of Object.keys(STUDENTS)) schol[f] = pyRound(gross[f] * SCHOLARSHIP_RATE);
      const net = sum(gross) - sum(schol);
      post(15, 'T04', `Semester ${sem + 1} tuition billed for ${label}`,
        [[1100, sum(gross), 0, null], ...Object.keys(gross).map((f) => [4010, 0, gross[f], f])]);
      post(16, 'T14', `Scholarships applied against fees owed, ${label}`,
        [...Object.keys(schol).map((f) => [5090, schol[f], 0, f]), [1100, 0, sum(schol), null]]);
      const got = pyRound(net * COLLECT_SAME_MONTH);
      post(20, 'T05', `Tuition collected during ${label}`, [[1010, got, 0, null], [1100, 0, got, null]]);
      state.unpaidPrev = net - got;
    });

    // --- other revenue
    post(25, 'T07', 'Application and registration fees received', [[1010, appFees[i], 0, null], [4020, 0, appFees[i], null]]);
    post(26, 'T08', 'Bookstore sales (cash)', [[1010, book[i], 0, null], [4030, 0, book[i], null]]);
    post(26, 'T09', 'Cafeteria sales (cash)', [[1010, cafe[i], 0, null], [4040, 0, cafe[i], null]]);
    post(3, 'T12', 'Facility rental received', [[1010, rental[i], 0, null], [4060, 0, rental[i], null]]);
    const tr = {};
    for (const f of Object.keys(training)) tr[f] = training[f][i];
    post(24, 'T10', 'Training and consulting services on account',
      [[1110, sum(tr), 0, null], ...Object.keys(tr).map((f) => [4050, 0, tr[f], f])]);
    if (m > 1) {
      post(12, 'T11', 'Training and consulting receivables collected',
        [[1010, state.trainingPrev, 0, null], [1110, 0, state.trainingPrev, null]]);
    }
    state.trainingPrev = sum(tr);

    // --- inventory: bookstore and cafeteria stock bought a month ahead
    const nxt = (i + 1) % 12;
    const bookBuy = m === 1 ? bookCost[0] + bookCost[1] : bookCost[nxt];
    const cafeBuy = m === 1 ? cafeCost[0] + cafeCost[1] : cafeCost[nxt];
    post(5, 'T15', 'Bookstore stock bought on account', [[1200, bookBuy, 0, null], [2010, 0, bookBuy, null]]);
    apDue.push([m + 1, bookBuy]);
    post(6, 'T16', 'Cafeteria stock bought for cash', [[1210, cafeBuy, 0, null], [1010, 0, cafeBuy, null]]);
    post(27, 'T18', 'Bookstore cost of sales', [[5030, bookCost[i], 0, null], [1200, 0, bookCost[i], null]]);
    post(27, 'T18', 'Cafeteria cost of sales', [[5040, cafeCost[i], 0, null], [1210, 0, cafeCost[i], null]]);
    if (m in SUPPLIES_PURCHASES) {
      post(4, 'T16', 'Lab and office supplies bought for cash',
        [[1220, SUPPLIES_PURCHASES[m], 0, null], [1010, 0, SUPPLIES_PURCHASES[m], null]]);
    }
    post(27, 'T19', 'Lab and office supplies used',
      [[5050, SUPPLIES_USED_MONTHLY, 0, null], [1220, 0, SUPPLIES_USED_MONTHLY, null]]);

    // --- running costs
    post(28, 'T26', 'Utilities paid', [[5060, util[i], 0, null], [1010, 0, util[i], null]]);
    post(14, 'T26', 'Marketing and admissions campaigns paid', [[5070, mark[i], 0, null], [1010, 0, mark[i], null]]);
    post(18, 'T27', 'Repairs and maintenance on account', [[5080, maint[i], 0, null], [2010, 0, maint[i], null]]);
    apDue.push([m + 1, maint[i]]);

    // --- salaries: earned at month end, paid on the 5th of the next month
    if (m > 1) {
      post(5, 'T25', "Last month's salaries paid", [[2020, state.salariesPrev, 0, null], [1010, 0, state.salariesPrev, null]]);
    }
    const totalSal = sum(ACADEMIC_SALARY_MONTHLY) + ADMIN_SALARY_MONTHLY;
    post(0, 'T24', `Salaries earned for ${label}`,
      [
        ...Object.keys(ACADEMIC_SALARY_MONTHLY).map((f) => [5010, ACADEMIC_SALARY_MONTHLY[f], 0, f]),
        [5020, ADMIN_SALARY_MONTHLY, 0, null],
        [2020, 0, totalSal, null],
      ],
      true);
    state.salariesPrev = totalSal;

    // --- suppliers and equipment payable
    const dueNow = apDue.filter(([dm]) => dm === m).reduce((a, [, amt]) => a + amt, 0);
    if (dueNow) post(10, 'T17', 'Suppliers paid', [[2010, dueNow, 0, null], [1010, 0, dueNow, null]]);

    // --- income tax payment for the previous quarter (amount from the balance at last month end)
    if (TAX_PAY_MONTHS.includes(m)) {
      const payableCents = -balance(core.TAX_PAYABLE_ID, m - 1);
      if (payableCents > 50) {
        const pay = pyRound(payableCents / 100);
        post(15, 'T29', 'Income tax paid', [[2030, pay, 0, null], [1010, 0, pay, null]]);
      }
    }

    // add this month's entries (by date, then in the order posted), then work out the monthly tax
    // from the year-to-date profit
    pending.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq));
    for (const { clean } of pending) {
      entries.push(clean);
      addToFlat(clean);
    }
    const tax = core.taxSuggestion(flat, fyStart, m, taxRate);
    if (tax.proposal) {
      const desc = tax.to_post > 0 ? 'Monthly income tax accrual' : 'Income tax accrual reversed';
      const clean = validate({
        date: core.monthEnd(fyStart, m),
        txn_type: 'T28',
        description: desc,
        lines: tax.proposal.map((ln) => ({ ...ln, faculty: null })),
      });
      entries.push(clean);
      addToFlat(clean);
    }

    const s = { ...core.summary(flat, fyStart, m), month: m, label };
    const mustNotBeNegative = [
      [1010, 'cash'], [1100, 'receivables'], [1200, 'bookstore stock'],
      [1210, 'cafeteria stock'], [1220, 'supplies stock'], [1110, 'other receivables'],
    ];
    for (const [acct, name] of mustNotBeNegative) {
      if (balance(acct, m) < 0) {
        throw new SeedError(`Month ${m}: ${name} went negative (${(balance(acct, m) / 100).toLocaleString('en')}). Adjust the assumptions.`);
      }
    }
    if (balance(core.TAX_PAYABLE_ID, m) > 0) {
      throw new SeedError(`Month ${m}: income tax payable went negative. Adjust TAX_PAY_MONTHS or the assumptions.`);
    }
    if (!s.balanced) throw new SeedError(`Month ${m}: the accounting equation does not balance.`);
    summaries.push(s);
  }

  return { entries, flat, summaries };
}

/** Number of entries and journal lines in a built year. */
export function countYear(entries) {
  return { entries: entries.length, lines: entries.reduce((n, e) => n + e.lines.length, 0) };
}

// =====================================================================
// Output: summary, CSV, API
// =====================================================================

const num0 = (n) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const num2 = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function printSummary(entries, summaries) {
  const { lines } = countYear(entries);
  console.log(`\n${entries.length} entries, ${lines} journal lines (the Excel Journal holds 2,000).\n`);
  console.log(
    'Month'.padEnd(10) + 'Revenue YTD'.padStart(16) + 'Net income YTD'.padStart(16) +
    'Cash'.padStart(16) + 'Assets'.padStart(18) + 'Equity'.padStart(18),
  );
  for (const s of summaries) {
    console.log(
      s.label.padEnd(10) + num0(s.revenue).padStart(16) + num0(s.net_income).padStart(16) +
      num0(s.cash).padStart(16) + num0(s.assets).padStart(18) + num0(s.equity).padStart(18),
    );
  }
  const f = summaries[summaries.length - 1];
  const margin = f.revenue ? f.profit_before_tax / f.revenue : 0;
  console.log(
    `\nYear end: revenue ${num0(f.revenue)}; profit before tax ${num0(f.profit_before_tax)} ` +
    `(${(margin * 100).toFixed(1)}% of revenue); income tax ${num0(f.income_tax)}; net income ${num0(f.net_income)}.`,
  );
  console.log(
    `Assets ${num0(f.assets)} = liabilities ${num0(f.liabilities)} + equity ${num0(f.equity)} ` +
    `(difference ${num2(f.balance_difference)}).`,
  );
}

const csvCell = (v) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

function writeCsv(file, entries) {
  const rows = [['EntryID', 'Date', 'TxnType', 'AccountID', 'Debit', 'Credit', 'Faculty', 'Description']];
  entries.forEach((e, idx) => {
    for (const ln of e.lines) {
      rows.push([
        idx + 1, e.date, e.txn_type, ln.account_id,
        ln.debit_cents ? core.toMoney(ln.debit_cents) : '',
        ln.credit_cents ? core.toMoney(ln.credit_cents) : '',
        ln.faculty, e.description,
      ]);
    }
  });
  writeFileSync(file, rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
  console.log(`Wrote ${file}`);
}

/** One HTTP call to the API. Returns { status, body }. */
async function call(base, method, urlPath, key = '', payload = undefined) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['X-API-Key'] = key;
  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  return { status: res.status, body };
}

/** Entry as the API expects it: normal decimal amounts, not cents. */
const toApiEntry = (e) => ({
  date: e.date,
  txn_type: e.txn_type,
  description: e.description,
  lines: e.lines.map((ln) => ({
    account_id: ln.account_id,
    debit: core.toMoney(ln.debit_cents),
    credit: core.toMoney(ln.credit_cents),
    faculty: ln.faculty,
  })),
});

/** Posts entries one by one. Stops at the first rejection. Returns how many were posted. */
export async function postEntries(base, apiKey, entries) {
  let n = 0;
  for (const e of entries) {
    n++;
    const { status, body } = await call(base, 'POST', '/api/entries', apiKey, toApiEntry(e));
    if (status !== 201) {
      const hint = status === 401 ? ' (the server needs an API key: use --api-key or set CIC_API_KEY)' : '';
      throw new SeedError(`Entry ${n} was rejected (${status})${hint}: ${JSON.stringify(body)}\nStopped. Entries before it were already posted.`);
    }
  }
  return n;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      url: { type: 'string', default: 'http://127.0.0.1:5000' },
      'api-key': { type: 'string', default: process.env.CIC_API_KEY ?? '' },
      'fy-start': { type: 'string', default: '2026-07-01' },
      'tax-rate': { type: 'string', default: String(TAX_RATE) },
      seed: { type: 'string', default: String(SEED) },
      'dry-run': { type: 'boolean', default: false },
      csv: { type: 'string' },
      reset: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (args.help) {
    console.log('Usage: node scripts/seed-sample-year.js [--dry-run] [--csv FILE] [--reset] [--url URL] [--api-key KEY]\n' +
      '                                          [--fy-start YYYY-MM-DD] [--tax-rate 0.225] [--seed 2026]');
    return;
  }

  const base = args.url.replace(/\/+$/, '');
  let fyStart = core.parseIsoDate(args['fy-start']);
  if (!fyStart) throw new SeedError(`--fy-start must be YYYY-MM-DD, got '${args['fy-start']}'.`);

  if (!args['dry-run']) {
    let health;
    try {
      ({ body: health } = await call(base, 'GET', '/api/health'));
    } catch (err) {
      throw new SeedError(`Cannot reach ${base} (${err.cause?.code ?? err.message}). Start the server with \`npm start\` in server/ first.`);
    }
    fyStart = core.parseIsoDate(health.financial_year_start);
    console.log(`Connected. Financial year starts ${fyStart.iso}.`);
  }

  const { entries, summaries } = buildYear(fyStart, Number(args['tax-rate']), Number(args.seed));
  printSummary(entries, summaries);
  if (args.csv) writeCsv(args.csv, entries);
  if (args['dry-run']) {
    console.log('\nDry run: nothing was posted.');
    return;
  }

  const { body: existing } = await call(base, 'GET', '/api/entries');
  if (Array.isArray(existing) && existing.length) {
    if (!args.reset) {
      throw new SeedError(`\nThe app already holds ${existing.length} entries. Nothing was posted. Run again with --reset to delete them first.`);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`\nDelete all ${existing.length} existing entries? Type YES to confirm: `)).trim();
    rl.close();
    if (answer !== 'YES') throw new SeedError('Cancelled. Nothing was changed.');
    for (const e of existing) {
      const { status } = await call(base, 'DELETE', `/api/entries/${e.id}`, args['api-key']);
      if (status !== 200) throw new SeedError(`Could not delete entry ${e.id} (${status}). Use --api-key if the server needs one. Stopped.`);
    }
    console.log(`Deleted ${existing.length} entries.`);
  }

  const posted = await postEntries(base, args['api-key'], entries);
  console.log(`\nPosted ${posted} entries.`);
  const { body: s } = await call(base, 'GET', '/api/summary?through=12');
  console.log(`API summary through June: assets ${num0(s.assets)}, net income ${num0(s.net_income)}, balanced: ${s.balanced}`);
}

// Run main() only when this file is started directly (not when the tests import it).
// Windows paths are compared without regard to upper/lower case (C: vs c:).
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && samePath(path.resolve(process.argv[1]), path.resolve(fileURLToPath(import.meta.url)))) {
  main().catch((err) => {
    console.error(err instanceof SeedError ? err.message : err);
    process.exit(1);
  });
}
