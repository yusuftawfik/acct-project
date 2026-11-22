// Parity check: compares the Node API with the old Python API, both holding the same sample year.
//
//   node scripts/parity-check.js                                   (Node on :5000, Python on :5001)
//   node scripts/parity-check.js --node http://127.0.0.1:5000 --python http://127.0.0.1:5001
//
// It compares, for all 12 months of the financial year:
//   - /api/summary?through=YYYY-MM   (every field)
//   - /api/tax/suggest?month=YYYY-MM (every field)
// and the whole /journal.csv (row count, every cell, debit and credit totals).
// Read-only: it only sends GET requests and changes nothing.
//
// How differences are labelled:
//   DIFFERENT  the two apps disagree: a real parity failure
//   float noise  numbers differ by less than half a cent (Python used decimal numbers, Node uses cents)
//   format only  the same number written differently in the CSV (for example 1500.0 and 1500)
// Exit code: 1 if anything is DIFFERENT, otherwise 0.

import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    node: { type: 'string', default: 'http://127.0.0.1:5000' },
    python: { type: 'string', default: 'http://127.0.0.1:5001' },
  },
});
const NODE = args.node.replace(/\/+$/, '');
const PY = args.python.replace(/\/+$/, '');

async function getText(base, urlPath) {
  let res;
  try {
    res = await fetch(base + urlPath, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    console.error(`Cannot reach ${base} (${err.cause?.code ?? err.message}). Is that server running?`);
    process.exit(2);
  }
  return { status: res.status, text: await res.text() };
}

async function getJson(base, urlPath) {
  const { status, text } = await getText(base, urlPath);
  if (status !== 200) {
    console.error(`${base}${urlPath} answered ${status}: ${text.slice(0, 200)}`);
    process.exit(2);
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------- comparing

const HALF_CENT = 0.005;

/** Recursively compares two JSON values. Pushes { where, node, python, kind } for each difference. */
function compare(node, python, where, out) {
  if (typeof node === 'number' && typeof python === 'number') {
    if (node === python) return;
    out.push({ where, node, python, kind: Math.abs(node - python) < HALF_CENT ? 'noise' : 'diff' });
    return;
  }
  const bothObjects = node !== null && python !== null && typeof node === 'object' && typeof python === 'object';
  if (!bothObjects) {
    if (node !== python) out.push({ where, node, python, kind: 'diff' });
    return;
  }
  if (Array.isArray(node) !== Array.isArray(python)) {
    out.push({ where, node: 'array/object', python: 'object/array', kind: 'diff' });
    return;
  }
  for (const key of new Set([...Object.keys(node), ...Object.keys(python)])) {
    const here = `${where}.${key}`;
    if (!(key in node)) out.push({ where: here, node: '(missing)', python: python[key], kind: 'diff' });
    else if (!(key in python)) out.push({ where: here, node: node[key], python: '(missing)', kind: 'diff' });
    else compare(node[key], python[key], here, out);
  }
}

// Minimal CSV reader (handles quoted cells, doubled quotes, commas and line breaks inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------- reporting

let failures = 0;
let cosmetic = 0;

function report(title, diffs, formatOnly = 0) {
  const real = diffs.filter((d) => d.kind === 'diff');
  const noise = diffs.filter((d) => d.kind === 'noise');
  failures += real.length;
  cosmetic += noise.length + formatOnly;
  if (!real.length && !noise.length && !formatOnly) {
    console.log(`OK         ${title}`);
    return;
  }
  console.log(`${real.length ? 'DIFFERENT ' : 'ok (minor)'} ${title}: ${real.length} different, ${noise.length} float noise, ${formatOnly} format only`);
  for (const d of [...real, ...noise].slice(0, 25)) {
    console.log(`             ${d.kind === 'diff' ? 'DIFFERENT' : 'float noise'}  ${d.where}   node=${JSON.stringify(d.node)}   python=${JSON.stringify(d.python)}`);
  }
  if (real.length + noise.length > 25) console.log(`             ... and ${real.length + noise.length - 25} more`);
}

// ---------------------------------------------------------------- checks

console.log(`Node:   ${NODE}\nPython: ${PY}\n`);

const healthNode = await getJson(NODE, '/api/health');
const healthPy = await getJson(PY, '/api/health');
{
  const d = [];
  compare(healthNode.financial_year_start, healthPy.financial_year_start, 'financial_year_start', d);
  report('financial year start', d);
}

// 1. number of entries
{
  const nodeEntries = await getJson(NODE, '/api/entries');
  const pyEntries = await getJson(PY, '/api/entries');
  const d = [];
  compare(nodeEntries.length, pyEntries.length, 'entry count', d);
  report(`entry count (node ${nodeEntries.length}, python ${pyEntries.length})`, d);
}

// 2 and 3. summary and tax suggestion for all 12 months
const [fyYear, fyMonth] = healthNode.financial_year_start.split('-').map(Number);
const months = Array.from({ length: 12 }, (_, i) => {
  const idx = fyMonth - 1 + i;
  return `${fyYear + Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
});

{
  const d = [];
  for (const ym of months) {
    compare(await getJson(NODE, `/api/summary?through=${ym}`), await getJson(PY, `/api/summary?through=${ym}`), `summary ${ym}`, d);
  }
  report('/api/summary for all 12 months', d);
}
{
  const d = [];
  for (const ym of months) {
    compare(await getJson(NODE, `/api/tax/suggest?month=${ym}`), await getJson(PY, `/api/tax/suggest?month=${ym}`), `tax ${ym}`, d);
  }
  report('/api/tax/suggest for all 12 months', d);
}

// 4. journal.csv
{
  const nodeRows = parseCsv((await getText(NODE, '/journal.csv')).text);
  const pyRows = parseCsv((await getText(PY, '/journal.csv')).text);
  const d = [];
  let formatOnly = 0;

  compare(nodeRows[0], pyRows[0], 'header', d);
  compare(nodeRows.length, pyRows.length, 'row count (including header)', d);

  const totals = { node: { dr: 0, cr: 0 }, python: { dr: 0, cr: 0 } };
  const cents = (x) => (x === '' ? 0 : Math.round(Number(x) * 100));
  const rowCount = Math.min(nodeRows.length, pyRows.length);
  const names = nodeRows[0] ?? [];
  for (let r = 1; r < rowCount; r++) {
    for (let c = 0; c < names.length; c++) {
      const a = nodeRows[r][c] ?? '';
      const b = pyRows[r][c] ?? '';
      const isMoney = names[c] === 'Debit' || names[c] === 'Credit';
      if (isMoney) {
        totals.node[c === 4 ? 'dr' : 'cr'] += cents(a);
        totals.python[c === 4 ? 'dr' : 'cr'] += cents(b);
        if (a === '' || b === '') {
          if (a !== b) d.push({ where: `row ${r} ${names[c]}`, node: a, python: b, kind: 'diff' });
        } else if (Number(a) !== Number(b)) {
          d.push({ where: `row ${r} ${names[c]}`, node: a, python: b, kind: Math.abs(Number(a) - Number(b)) < HALF_CENT ? 'noise' : 'diff' });
        } else if (a !== b) formatOnly++;
      } else if (a !== b) {
        d.push({ where: `row ${r} ${names[c]}`, node: a, python: b, kind: 'diff' });
      }
    }
  }
  compare(totals.node.dr, totals.python.dr, 'total debits (cents)', d);
  compare(totals.node.cr, totals.python.cr, 'total credits (cents)', d);
  report(`/journal.csv (node ${nodeRows.length - 1} lines, python ${pyRows.length - 1} lines)`, d, formatOnly);
  if (formatOnly) {
    const example = nodeRows.slice(1).findIndex((row, i) => row[4] !== (pyRows[i + 1] ?? [])[4] && row[4] !== '');
    const sample = example >= 0 ? `, for example node "${nodeRows[example + 1][4]}" vs python "${pyRows[example + 1][4]}"` : '';
    console.log(`             ${formatOnly} amount cells are the same number written differently${sample}. Excel reads both the same.`);
  }
}

console.log('');
if (failures) {
  console.log(`PARITY FAILED: ${failures} real difference(s). Do not delete legacy/.`);
  process.exit(1);
}
console.log(cosmetic
  ? `PARITY PASSED with ${cosmetic} cosmetic difference(s) (float noise or number format only).`
  : 'PARITY PASSED: everything is identical.');
