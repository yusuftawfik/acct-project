import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.js';

// Line helper: L(account, debit, credit, faculty)
const L = (account_id, debit = 0, credit = 0, faculty) => {
  const line = { account_id, debit, credit };
  if (faculty) line.faculty = faculty;
  return line;
};

const LECTURE = [
  ['2026-07-01', 'T01', 'Owner invests cash', [L(1010, 10000), L(3010, 0, 10000)]],
  ['2026-07-02', 'T22', 'Equipment, part cash', [L(1510, 5000), L(1010, 0, 1500), L(2010, 0, 3500)]],
  ['2026-07-05', 'T10', 'Service on account', [L(1110, 1200), L(4050, 0, 1200, 'BT')]],
  ['2026-07-10', 'T03', 'Owner draws', [L(3020, 1000), L(1010, 0, 1000)]],
  ['2026-07-15', 'T11', 'Collect 600', [L(1010, 600), L(1110, 0, 600)]],
  ['2026-07-20', 'T17', 'Pay supplier', [L(2010, 3500), L(1010, 0, 3500)]],
  ['2026-07-25', 'T11', 'Collect rest', [L(1010, 600), L(1110, 0, 600)]],
];

// Starts a server on a free port with its own temporary database.
async function startServer(config = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cic-test-'));
  const { app, close } = createApp({ database: path.join(dir, 't.db'), apiKey: '', ...config });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, json, text };
  };

  // Sends a raw string body (for malformed JSON).
  const raw = async (method, url, bodyText) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: bodyText });
    return { status: res.status, json: await res.json() };
  };

  return {
    raw,
    get: (url) => call('GET', url),
    post: (url, body, headers) => call('POST', url, body, headers),
    put: (url, body) => call('PUT', url, body),
    del: (url) => call('DELETE', url),
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('API', () => {
  let api;
  beforeEach(async () => { api = await startServer(); });
  afterEach(async () => { await api.stop(); });

  const postEntry = (date, txn_type, description, lines) =>
    api.post('/api/entries', { date, txn_type, description, lines });

  const loadLecture = async () => {
    for (const [d, t, desc, lines] of LECTURE) {
      assert.equal((await postEntry(d, t, desc, lines)).status, 201);
    }
  };

  test('lecture example matches the Excel expectations', async () => {
    await loadLecture();
    const s = (await api.get('/api/summary')).json;
    assert.deepEqual([s.cash, s.assets, s.liabilities], [5200, 10200, 0]);
    assert.deepEqual([s.net_income, s.equity], [1200, 10200]);
    assert.equal(s.balanced, true);
  });

  test('tax suggestion, then post it', async () => {
    await loadLecture();
    const t = (await api.get('/api/tax/suggest?month=2026-07')).json;
    assert.deepEqual([t.profit_before_tax_ytd, t.tax_required_ytd, t.suggested], [1200, 270, 270]);
    assert.equal(t.up_to_date, false);
    assert.equal((await postEntry('2026-07-31', 'T28', 'Tax', t.proposal)).status, 201);

    const t2 = (await api.get('/api/tax/suggest?month=2026-07')).json;
    assert.equal(t2.up_to_date, true);
    assert.equal(t2.proposal, null); // must not offer the same entry twice
    assert.equal(t2.to_post, 0);

    const s = (await api.get('/api/summary')).json;
    assert.deepEqual([s.income_tax, s.net_income, s.liabilities, s.equity], [270, 930, 270, 9930]);
    assert.equal(s.balanced, true);
  });

  test('partial tax posting proposes only the shortfall', async () => {
    await loadLecture();
    await postEntry('2026-07-31', 'T28', 'Part tax', [L(5900, 100), L(2030, 0, 100)]);
    const t = (await api.get('/api/tax/suggest?month=2026-07')).json;
    assert.deepEqual([t.suggested, t.to_post], [270, 170]);
    assert.deepEqual(t.proposal[0], { account_id: 5900, debit: 170, credit: 0 });
  });

  test('a loss month suggests a reversal', async () => {
    await loadLecture();
    let t = (await api.get('/api/tax/suggest?month=7')).json;
    await postEntry('2026-07-31', 'T28', 'Tax', t.proposal);
    await postEntry('2026-08-10', 'T26', 'Utilities', [L(5060, 2000), L(1010, 0, 2000)]);
    t = (await api.get('/api/tax/suggest?month=2026-08')).json;
    assert.deepEqual([t.profit_before_tax_ytd, t.tax_required_ytd, t.suggested], [-800, 0, -270]);
    assert.equal(t.proposal[0].account_id, 2030); // Dr payable, Cr expense
  });

  test('validation rules', async () => {
    const bad = {
      unbalanced: ['2026-07-01', 'T01', [L(1010, 500), L(3010, 0, 400)]],
      'one line': ['2026-07-01', 'T01', [L(1010, 500)]],
      'outside year': ['2027-07-01', 'T01', [L(1010, 5), L(3010, 0, 5)]],
      'unknown account': ['2026-07-01', 'T01', [L(9999, 5), L(3010, 0, 5)]],
      'both sides': ['2026-07-01', 'T01', [L(1010, 5, 5), L(3010, 0, 0)]],
      'no faculty': ['2026-07-01', 'T06', [L(1010, 5), L(4010, 0, 5)]],
      negative: ['2026-07-01', 'T01', [L(1010, -5), L(3010, 0, -5)]],
    };
    for (const [name, [d, t, lines]] of Object.entries(bad)) {
      const r = await postEntry(d, t, name, lines);
      assert.equal(r.status, 422, name);
      assert.ok(r.json.errors.length > 0, name);
    }
    assert.deepEqual((await api.get('/api/entries')).json, []); // nothing was stored
  });

  test('edit and delete', async () => {
    await loadLecture();
    const r = await api.put('/api/entries/1', {
      date: '2026-07-01', txn_type: 'T01', description: 'x', lines: [L(1010, 12000), L(3010, 0, 12000)],
    });
    assert.equal(r.status, 200);
    assert.equal((await api.get('/api/summary')).json.cash, 7200);
    assert.equal((await api.del('/api/entries/3')).status, 200);
    assert.equal((await api.del('/api/entries/3')).status, 404);
  });

  test('malformed JSON gets a 422 in the same error shape', async () => {
    const r = await api.raw('POST', '/api/entries', '{ not json');
    assert.equal(r.status, 422);
    assert.ok(Array.isArray(r.json.errors));
  });

  test('feed matches the Journal layout', async () => {
    await loadLecture();
    const csv = (await api.get('/journal.csv')).text.trim().split(/\r?\n/);
    assert.equal(csv[0], 'EntryID,Date,TxnType,AccountID,Debit,Credit,Faculty,Description');
    assert.equal(csv.length - 1, 15);
    assert.equal((await api.get('/api/journal')).json.length, 15);
  });

  test('reference endpoints', async () => {
    assert.equal((await api.get('/api/accounts')).json.length, 31);
    assert.equal((await api.get('/api/templates')).json.length, 30);
    assert.equal((await api.get('/api/summary?through=2028-01')).status, 422);
  });

  test('amounts with cents survive a round trip exactly', async () => {
    const r = await postEntry('2026-07-01', 'T01', 'cents', [L(1010, 19.99), L(3010, 0, 19.99)]);
    assert.equal(r.status, 201);
    const s = (await api.get('/api/summary')).json;
    assert.deepEqual([s.cash, s.capital, s.balance_difference], [19.99, 19.99, 0]);
    const entry = (await api.get('/api/entries')).json[0];
    assert.equal(entry.total, 19.99);
  });
});

describe('API key', () => {
  test('protects writes only', async () => {
    const api = await startServer({ apiKey: 'secret' });
    try {
      const body = { date: '2026-07-01', txn_type: 'T01', lines: [L(1010, 5), L(3010, 0, 5)] };
      assert.equal((await api.post('/api/entries', body)).status, 401);
      assert.equal((await api.post('/api/entries', body, { 'X-API-Key': 'secret' })).status, 201);
      assert.equal((await api.get('/api/entries')).status, 200);
    } finally {
      await api.stop();
    }
  });
});
