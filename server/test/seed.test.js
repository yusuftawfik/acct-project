import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import * as core from '../src/core.js';
import {
  buildYear, countYear, Mt19937, postEntries, pyRound, pyRoundHundreds, PyRandom,
} from '../scripts/seed-sample-year.js';

const FY_START = core.parseIsoDate('2026-07-01');

test('Mersenne Twister matches the official MT19937 reference output', () => {
  // First outputs of mt19937ar.c with init_by_array({0x123, 0x234, 0x345, 0x456}).
  const mt = new Mt19937([0x123, 0x234, 0x345, 0x456]);
  const first = [mt.nextUint32(), mt.nextUint32(), mt.nextUint32(), mt.nextUint32(), mt.nextUint32()];
  assert.deepEqual(first, [1067595299, 955945823, 477289528, 4107218783, 4228976476]);
});

test("PyRandom gives the same numbers as Python's random.Random", () => {
  // Python: random.seed(42); random.random() twice, and random.seed(1); random.random()
  const a = new PyRandom(42);
  assert.equal(a.random(), 0.6394267984578837);
  assert.equal(a.random(), 0.025010755222666936);
  assert.equal(new PyRandom(1).random(), 0.13436424411240122);
});

test("pyRound copies Python's round-half-to-even", () => {
  assert.equal(pyRound(0.5), 0);
  assert.equal(pyRound(1.5), 2);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(2.4), 2);
  assert.equal(pyRound(2.6), 3);
  assert.equal(pyRoundHundreds(150), 200);
  assert.equal(pyRoundHundreds(250), 200);
  assert.equal(pyRoundHundreds(349.99), 300);
  assert.equal(pyRoundHundreds(351), 400);
  assert.equal(pyRoundHundreds(12349.9), 12300);
});

test('the sample year has 259 entries and 619 lines, and every month balances', () => {
  const { entries, summaries } = buildYear(FY_START);
  assert.deepEqual(countYear(entries), { entries: 259, lines: 619 });
  assert.equal(summaries.length, 12);
  for (const s of summaries) {
    assert.equal(s.balanced, true, `month ${s.month} should balance`);
    assert.equal(s.balance_difference, 0);
  }
  for (const e of entries) {
    const dr = e.lines.reduce((n, l) => n + l.debit_cents, 0);
    const cr = e.lines.reduce((n, l) => n + l.credit_cents, 0);
    assert.equal(dr, cr);
  }
});

test('building the year twice gives the identical journal (fixed seed)', () => {
  assert.deepEqual(buildYear(FY_START).entries, buildYear(FY_START).entries);
});

test('posting the sample year through the API reproduces the built summary', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cic-seed-'));
  const { app, close } = createApp({ database: path.join(dir, 't.db'), apiKey: '' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { entries, summaries } = buildYear(FY_START);
    assert.equal(await postEntries(base, '', entries), 259);

    // Every month from the API equals the month the builder computed (all fields).
    for (let m = 1; m <= 12; m++) {
      const api = await (await fetch(`${base}/api/summary?through=${m}`)).json();
      const { month, label, ...expected } = summaries[m - 1];
      assert.deepEqual(api, expected, `month ${m}`);
    }

    // The feed has one row per journal line plus the header.
    const csv = await (await fetch(`${base}/journal.csv`)).text();
    assert.equal(csv.trim().split('\r\n').length, 619 + 1);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    close();
    rmSync(dir, { recursive: true, force: true });
  }
});
