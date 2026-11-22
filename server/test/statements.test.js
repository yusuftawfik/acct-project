import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import * as core from '../src/core.js';
import { docsFor, REPORT_SLUGS } from '../src/reportDocs.js';
import { renderPdf } from '../src/pdf.js';
import { buildYear } from '../scripts/seed-sample-year.js';
import { buildReport, splitCents } from '../src/statements.js';

const FY_START = core.parseIsoDate('2026-07-01');

function sampleLines() {
  const { entries } = buildYear(FY_START);
  const lines = [];
  entries.forEach((e, i) =>
    e.lines.forEach((l) => lines.push({ entry_id: i + 1, date: e.date, txn_type: e.txn_type, description: e.description, ...l })),
  );
  return lines;
}

test('statements for the sample year equal the Excel model (all amounts in cents)', () => {
  const r = buildReport(sampleLines(), FY_START, 12);
  const fp = r.financialPosition;
  assert.deepEqual([fp.totalAssets, fp.totalLiabilities, fp.totalEquity, fp.difference], [55313453700, 2524917600, 52788536100, 0]);
  assert.deepEqual([r.netIncome.revenue.ytd, r.netIncome.pbt.ytd, r.netIncome.net.ytd], [39149970000, 6823917500, 5288536100]);
  assert.equal(r.netIncome.tax.ytd, -1535381400);
  assert.equal(r.cashFlows.closing.ytd, 11818808700);
  assert.equal(r.cashFlows.closing.month, 11818808700); // opening cash of June + the June movement
  const flow = (label) => r.cashFlows.received.concat(r.cashFlows.paid).find((x) => x.label === label);
  assert.equal(flow('Received from students').ytd, 29924380000);
  assert.equal(flow('Paid to suppliers').month, -715302000);
  assert.deepEqual(r.taxMonths.map((t) => t.required / 100), [0, 0, 0, 0, 0, 1025076, 3741153, 6447009, 8855438, 11150601, 13352028, 15353814]);
  assert.equal(r.notes.note2.totals[0], 9698490000); // BA revenue
  assert.equal(r.overall, 'ALL CHECKS PASS');
});

test('every month of the sample year passes all ten checks', () => {
  const lines = sampleLines();
  for (let m = 1; m <= 12; m++) {
    const r = buildReport(lines, FY_START, m);
    assert.equal(r.overall, 'ALL CHECKS PASS', `month ${m}`);
  }
});

test('the lecture example: assets 10,200, liabilities 0, equity 10,200', () => {
  const L = (entry_id, date, account_id, debit, credit, faculty = 'Central') => ({
    entry_id, date, txn_type: 'Custom', description: '', account_id, debit_cents: debit * 100, credit_cents: credit * 100, faculty,
  });
  const lines = [
    L(1, '2026-07-01', 1010, 10000, 0), L(1, '2026-07-01', 3010, 0, 10000),
    L(2, '2026-07-02', 1510, 5000, 0), L(2, '2026-07-02', 1010, 0, 1500), L(2, '2026-07-02', 2010, 0, 3500),
    L(3, '2026-07-05', 1110, 1200, 0), L(3, '2026-07-05', 4050, 0, 1200, 'BT'),
    L(4, '2026-07-10', 3020, 1000, 0), L(4, '2026-07-10', 1010, 0, 1000),
    L(5, '2026-07-15', 1010, 600, 0), L(5, '2026-07-15', 1110, 0, 600),
    L(6, '2026-07-20', 2010, 3500, 0), L(6, '2026-07-20', 1010, 0, 3500),
    L(7, '2026-07-25', 1010, 600, 0), L(7, '2026-07-25', 1110, 0, 600),
  ];
  const r = buildReport(lines, FY_START, 1);
  const fp = r.financialPosition;
  assert.deepEqual([fp.totalAssets, fp.totalLiabilities, fp.totalEquity], [1020000, 0, 1020000]);
  assert.equal(r.cashFlows.closing.ytd, 520000);
  // equipment bought part cash, part on account: the 1,500 cash is "Paid for assets", the later 3,500 "Paid to suppliers"
  assert.equal(r.cashFlows.paid.find((x) => x.label === 'Paid for assets').ytd, -150000);
  assert.equal(r.cashFlows.paid.find((x) => x.label === 'Paid to suppliers').ytd, -350000);
  assert.equal(r.checks.filter((c) => !c.pass).length, 1); // only the tax check: the 270 tax has not been posted yet
  assert.equal(r.checks.find((c) => !c.pass).n, 9);
});

test('an empty journal gives zero statements and all checks pass', () => {
  const r = buildReport([], FY_START, 1);
  assert.equal(r.financialPosition.totalAssets, 0);
  assert.equal(r.overall, 'ALL CHECKS PASS');
});

test('splitCents never loses a cent', () => {
  assert.deepEqual(splitCents(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(splitCents(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(splitCents(5, [0, 0]), [0, 0]);
  assert.equal(splitCents(1000001, [3, 5, 7, 11]).reduce((a, b) => a + b, 0), 1000001);
});

test('all 11 reports render as real PDFs, including text a PDF font cannot draw', async () => {
  const lines = sampleLines();
  lines[0].description = 'Arabic مرحبا and symbols ✓ … must not crash';
  const report = buildReport(lines, FY_START, 12);
  for (const slug of REPORT_SLUGS) {
    const bytes = await renderPdf(docsFor(slug, report), { title: slug });
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), '%PDF-', slug);
    assert.ok(bytes.length > 1500, slug);
  }
  assert.equal(docsFor('nope', report), null);
});

// ------------------------------------------------------------------ per-visitor journals over HTTP

async function start(config = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cic-multi-'));
  const { app, close } = createApp({ database: path.join(dir, 't.db'), apiKey: '', multiUser: true, exportMode: 'generated', ...config });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (id, method, url, body) =>
    fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(id ? { 'X-Journal-Id': id } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    send,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const ALICE = 'a'.repeat(32);
const BOB = 'b'.repeat(32);
const ENTRY = {
  date: '2026-07-01',
  txn_type: 'T01',
  description: 'Owner invests',
  lines: [{ account_id: 1010, debit: 100, credit: 0 }, { account_id: 3010, debit: 0, credit: 100 }],
};

test('each visitor only ever sees, changes and prints their own journal', async () => {
  const s = await start();
  try {
    const created = await (await s.send(ALICE, 'POST', '/api/entries', ENTRY)).json();

    assert.deepEqual(await (await s.send(BOB, 'GET', '/api/entries')).json(), []);
    assert.equal((await (await s.send(ALICE, 'GET', '/api/entries')).json()).length, 1);
    assert.equal((await (await s.send(BOB, 'GET', '/api/summary?through=1')).json()).cash, 0);
    assert.equal((await (await s.send(ALICE, 'GET', '/api/summary?through=1')).json()).cash, 100);

    // Bob cannot edit or delete Alice's entry, even knowing its number
    assert.equal((await s.send(BOB, 'PUT', `/api/entries/${created.id}`, ENTRY)).status, 404);
    assert.equal((await s.send(BOB, 'DELETE', `/api/entries/${created.id}`)).status, 404);
    assert.equal((await (await s.send(ALICE, 'GET', '/api/entries')).json()).length, 1);

    // Bob clearing his journal leaves Alice's alone
    await s.send(BOB, 'POST', '/api/entries', ENTRY);
    assert.equal((await (await s.send(BOB, 'DELETE', '/api/entries')).json()).deleted, 1);
    assert.equal((await (await s.send(ALICE, 'GET', '/api/entries')).json()).length, 1);

    // the Excel feed takes the id as ?journal=, and shows only that visitor's lines
    const csv = await (await fetch(`${(await s.send(ALICE, 'GET', '/api/health')).url.replace('/api/health', '')}/journal.csv?journal=${ALICE}`)).text();
    assert.equal(csv.trim().split('\r\n').length, 3);
  } finally {
    await s.stop();
  }
});

test('requests without a valid journal id are refused on the hosted setup', async () => {
  const s = await start();
  try {
    for (const bad of [undefined, 'short', 'x'.repeat(65), 'has spaces in it but long enough']) {
      const r = await s.send(bad, 'GET', '/api/entries');
      assert.equal(r.status, 400, String(bad));
    }
    assert.equal((await s.send(undefined, 'GET', '/api/accounts')).status, 200); // reference data needs no journal
    assert.equal((await s.send(undefined, 'GET', '/api/health')).status, 200);
  } finally {
    await s.stop();
  }
});

test('generated PDF reports come from the visitor\'s own entries', async () => {
  const s = await start();
  try {
    await s.send(ALICE, 'POST', '/api/entries', ENTRY);
    const list = await (await s.send(ALICE, 'GET', '/api/reports')).json();
    assert.equal(list.mode, 'generated');
    assert.deepEqual(list.reports.map((r) => r.slug), REPORT_SLUGS);

    for (const slug of REPORT_SLUGS) {
      const res = await s.send(ALICE, 'GET', `/api/reports/${slug}.pdf?through=2026-07`);
      assert.equal(res.status, 200, slug);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.equal(res.headers.get('content-disposition'), `attachment; filename="${slug}.pdf"`);
      assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    }
    assert.equal((await s.send(ALICE, 'GET', '/api/reports/general-ledger.pdf')).status, 404);
    assert.equal((await s.send(ALICE, 'GET', '/api/reports/tax.pdf?through=2030-01')).status, 422);
    assert.equal((await s.send(undefined, 'GET', '/api/reports/tax.pdf')).status, 400);
    assert.equal((await s.send(ALICE, 'POST', '/api/reports/refresh')).status, 409);
  } finally {
    await s.stop();
  }
});

test('a visitor cannot store more lines than the limit', async () => {
  const s = await start({ maxLines: 3 });
  try {
    assert.equal((await s.send(ALICE, 'POST', '/api/entries', ENTRY)).status, 201); // 2 lines
    const second = await s.send(ALICE, 'POST', '/api/entries', ENTRY); // would make 4
    assert.equal(second.status, 422);
    assert.match((await second.json()).errors[0], /at most 3 lines/);
    assert.equal((await s.send(BOB, 'POST', '/api/entries', ENTRY)).status, 201); // Bob has his own allowance
  } finally {
    await s.stop();
  }
});
