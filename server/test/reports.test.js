import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { runCommand, SLUGS } from '../src/reports.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A stand-in for the PowerShell + Excel run: writes a small fake PDF for every slug.
function fakeRunner(outDir, delay) {
  const state = { calls: 0, fail: null };
  state.run = async () => {
    state.calls += 1;
    if (delay) await sleep(delay);
    if (state.fail) throw state.fail;
    for (const slug of SLUGS) writeFileSync(path.join(outDir, `${slug}.pdf`), `%PDF-1.4 ${slug} run ${state.calls}`);
  };
  return state;
}

/**
 * Starts the API on a free port with temporary files.
 * options: mode ('live' | 'static'), apiKey, delay (ms the fake export takes),
 *          before(exportsDir, dir) runs before the app starts, real (use the real PowerShell runner)
 */
async function start({ mode = 'live', apiKey = '', delay = 0, before, real = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cic-reports-'));
  const exportsDir = path.join(dir, 'exports');
  mkdirSync(exportsDir);
  before?.(exportsDir, dir);
  const runner = fakeRunner(exportsDir, delay);
  const config = { database: path.join(dir, 't.db'), apiKey, exportsDir, exportMode: mode };
  if (real) config.excelPath = path.join(dir, 'missing.xlsx'); // never let a test open the real workbook
  else config.exportRunner = runner.run;
  const { app, close } = createApp(config);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    dir,
    exportsDir,
    runner,
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function get(url) {
  const res = await fetch(url);
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, text: body.toString('utf8'), json: () => JSON.parse(body.toString('utf8')) };
}

const ENTRY = {
  date: '2026-07-01',
  txn_type: 'T01',
  description: 'Owner invests',
  lines: [
    { account_id: 1010, debit: 100, credit: 0 },
    { account_id: 3010, debit: 0, credit: 100 },
  ],
};
const send = (base, method, urlPath, body, headers = {}) =>
  fetch(base + urlPath, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('unknown report names are refused before any file is touched', async () => {
  const s = await start({
    before: (_exports, dir) => writeFileSync(path.join(dir, 'secret.pdf'), 'SECRET'), // a file OUTSIDE the exports folder
  });
  try {
    for (const bad of ['general-ledger', '..%2Fsecret', '%2e%2e%2fsecret', 'Trial-Balance', 'trial-balance%00', 'a%5Cb']) {
      const r = await get(`${s.base}/api/reports/${bad}.pdf`);
      assert.equal(r.status, 404, bad);
      assert.match(r.json().errors[0], /Unknown report/, bad);
      assert.ok(!r.text.includes('SECRET'), bad);
    }
    assert.equal((await get(`${s.base}/api/reports/trial-balance`)).status, 404); // no .pdf
    assert.equal(s.runner.calls, 0, 'Excel must never run for an unknown name');
  } finally {
    await s.stop();
  }
});

test('static mode streams an existing PDF, never runs Excel, and 404s when none exists', async () => {
  const s = await start({
    mode: 'static',
    before: (exportsDir) => writeFileSync(path.join(exportsDir, 'trial-balance.pdf'), '%PDF-1.4 static test'),
  });
  try {
    const ok = await get(`${s.base}/api/reports/trial-balance.pdf`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'application/pdf');
    assert.equal(ok.headers.get('content-disposition'), 'attachment; filename="trial-balance.pdf"');
    assert.equal(ok.text, '%PDF-1.4 static test');

    const missing = await get(`${s.base}/api/reports/tax.pdf`);
    assert.equal(missing.status, 404);
    assert.match(missing.json().errors[0], /No exported PDF/);

    const refresh = await send(s.base, 'POST', '/api/reports/refresh');
    assert.equal(refresh.status, 409);

    const list = (await get(`${s.base}/api/reports`)).json();
    assert.equal(list.mode, 'static');
    assert.equal(list.reports.find((r) => r.slug === 'trial-balance').available, true);
    assert.equal(list.reports.find((r) => r.slug === 'tax').available, false);
    assert.ok(list.reports.every((r) => r.stale === false), 'static mode never reports stale');

    // a journal change in static mode must not start Excel either
    assert.equal((await send(s.base, 'POST', '/api/entries', ENTRY)).status, 201);
    assert.equal((await get(`${s.base}/api/reports/trial-balance.pdf`)).status, 200);
    assert.equal(s.runner.calls, 0);
  } finally {
    await s.stop();
  }
});

test('live mode: a missing export is made first, then streamed, and reused', async () => {
  const s = await start();
  try {
    const first = await get(`${s.base}/api/reports/journal.pdf`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('content-type'), 'application/pdf');
    assert.equal(first.text, '%PDF-1.4 journal run 1');
    assert.equal(s.runner.calls, 1);

    // one run produces every report, so the next request needs no new run
    const second = await get(`${s.base}/api/reports/trial-balance.pdf`);
    assert.equal(second.text, '%PDF-1.4 trial-balance run 1');
    assert.equal(s.runner.calls, 1);
  } finally {
    await s.stop();
  }
});

test('a journal write (post, edit, delete) makes the exports stale; a rejected write does not', async () => {
  const s = await start();
  try {
    const url = `${s.base}/api/reports/checks.pdf`;
    assert.equal((await get(url)).text, '%PDF-1.4 checks run 1');

    assert.equal((await send(s.base, 'POST', '/api/entries', {})).status, 422); // rejected: nothing changed
    assert.equal((await get(url)).text, '%PDF-1.4 checks run 1');
    assert.equal(s.runner.calls, 1);

    const created = await send(s.base, 'POST', '/api/entries', ENTRY);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await get(url)).text, '%PDF-1.4 checks run 2');

    assert.equal((await send(s.base, 'PUT', `/api/entries/${id}`, { ...ENTRY, description: 'edited' })).status, 200);
    assert.equal((await get(url)).text, '%PDF-1.4 checks run 3');

    assert.equal((await send(s.base, 'DELETE', `/api/entries/${id}`)).status, 200);
    assert.equal((await get(url)).text, '%PDF-1.4 checks run 4');

    assert.equal((await send(s.base, 'DELETE', '/api/entries/9999')).status, 404); // nothing deleted
    assert.equal((await get(url)).text, '%PDF-1.4 checks run 4');
    assert.equal(s.runner.calls, 4);
  } finally {
    await s.stop();
  }
});

test('after a restart, an export newer than the database is kept and an older one is rebuilt', async () => {
  const hour = 3600 * 1000;
  const keep = await start({
    before: (exportsDir) => {
      const file = path.join(exportsDir, 'tax.pdf');
      writeFileSync(file, 'KEEP');
      utimesSync(file, new Date(Date.now() + hour), new Date(Date.now() + hour)); // newer than the database file
    },
  });
  try {
    assert.equal((await get(`${keep.base}/api/reports/tax.pdf`)).text, 'KEEP');
    assert.equal(keep.runner.calls, 0);
  } finally {
    await keep.stop();
  }

  const old = await start({
    before: (exportsDir) => {
      const file = path.join(exportsDir, 'tax.pdf');
      writeFileSync(file, 'OLD');
      utimesSync(file, new Date('2001-01-01'), new Date('2001-01-01')); // older than the database file
    },
  });
  try {
    assert.equal((await get(`${old.base}/api/reports/tax.pdf`)).text, '%PDF-1.4 tax run 1');
    assert.equal(old.runner.calls, 1);
  } finally {
    await old.stop();
  }
});

test('requests that arrive during an export share that one run', async () => {
  const s = await start({ delay: 200 });
  try {
    const [a, b, c] = await Promise.all([
      get(`${s.base}/api/reports/notes.pdf`),
      get(`${s.base}/api/reports/cash-flows.pdf`),
      get(`${s.base}/api/reports/all-statements.pdf`),
    ]);
    assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
    assert.equal(s.runner.calls, 1);
  } finally {
    await s.stop();
  }
});

test('refresh needs the API key, answers 409 while an export is running, and lists the reports', async () => {
  const s = await start({ apiKey: 'secret', delay: 300 });
  try {
    assert.equal((await send(s.base, 'POST', '/api/reports/refresh')).status, 401);
    assert.equal((await send(s.base, 'POST', '/api/reports/refresh', undefined, { 'X-API-Key': 'wrong' })).status, 401);
    assert.equal(s.runner.calls, 0);
    assert.equal((await get(`${s.base}/api/reports`)).status, 200); // listing needs no key

    const key = { 'X-API-Key': 'secret' };
    const first = send(s.base, 'POST', '/api/reports/refresh', undefined, key);
    await sleep(60);
    const busyList = (await get(`${s.base}/api/reports`)).json();
    assert.equal(busyList.running, true);
    assert.equal((await send(s.base, 'POST', '/api/reports/refresh', undefined, key)).status, 409);

    const done = await first;
    assert.equal(done.status, 200);
    const body = await done.json();
    assert.deepEqual(body.exported, SLUGS);
    assert.equal(s.runner.calls, 1);

    const list = (await get(`${s.base}/api/reports`)).json();
    assert.equal(list.running, false);
    assert.equal(list.last_run.ok, true);
    assert.deepEqual(list.reports.map((r) => r.slug), SLUGS);
    for (const r of list.reports) {
      assert.equal(r.available, true);
      assert.equal(r.stale, false);
      assert.match(r.exported_at, /^\d{4}-\d{2}-\d{2}T/);
    }
  } finally {
    await s.stop();
  }
});

test('the listing before any export shows every slug as missing and stale', async () => {
  const s = await start();
  try {
    const list = (await get(`${s.base}/api/reports`)).json();
    assert.equal(list.mode, 'live');
    assert.deepEqual(list.reports.map((r) => r.slug), SLUGS);
    for (const r of list.reports) {
      assert.equal(r.available, false);
      assert.equal(r.exported_at, null);
      assert.equal(r.stale, true);
    }
  } finally {
    await s.stop();
  }
});

test('export failures give a clear error (500, or 504 for a timeout) and the next try runs again', async () => {
  const s = await start();
  try {
    s.runner.fail = new Error('Excel is not installed');
    const failed = await get(`${s.base}/api/reports/tax.pdf`);
    assert.equal(failed.status, 500);
    assert.match(failed.json().errors[0], /Excel is not installed/);

    s.runner.fail = Object.assign(new Error('Export timed out after 120 s.'), { code: 'TIMEOUT' });
    assert.equal((await get(`${s.base}/api/reports/tax.pdf`)).status, 504);
    assert.equal((await send(s.base, 'POST', '/api/reports/refresh')).status, 504);
    assert.equal((await get(`${s.base}/api/reports`)).json().last_run.ok, false);

    s.runner.fail = null; // the failure did not leave the server stuck
    assert.equal((await get(`${s.base}/api/reports/tax.pdf`)).status, 200);
    assert.equal((await get(`${s.base}/api/reports`)).json().last_run.ok, true);
  } finally {
    await s.stop();
  }
});

test('the real runner refuses clearly when Excel cannot be used, and never touches the real workbook', async () => {
  const s = await start({ real: true });
  try {
    const r = await get(`${s.base}/api/reports/tax.pdf`);
    assert.equal(r.status, 500);
    assert.match(r.json().errors[0], /not found|needs Windows/);
  } finally {
    await s.stop();
  }
});

test('runCommand returns the output of a program that succeeds', async () => {
  const { stdout } = await runCommand(process.execPath, ['-e', "console.log('hello')"]);
  assert.match(stdout, /hello/);
});

test('runCommand reports a failing program with its error text', async () => {
  await assert.rejects(
    runCommand(process.execPath, ['-e', "console.error('boom happened'); process.exit(3)"]),
    (err) => {
      assert.equal(err.code, 'EXPORT_FAILED');
      assert.equal(err.exitCode, 3);
      assert.match(err.message, /boom happened/);
      return true;
    },
  );
  await assert.rejects(runCommand('definitely-not-a-real-program-xyz', []), /Could not start/);
});

test('runCommand ends the process when the time limit is reached', async () => {
  let pid = 0;
  await assert.rejects(
    runCommand(process.execPath, ['-e', "console.log('CHILD_PID=' + process.pid); setInterval(() => {}, 1000);"], { timeoutMs: 1000 }),
    (err) => {
      assert.equal(err.code, 'TIMEOUT');
      assert.match(err.message, /timed out after 1 s/);
      pid = Number(/CHILD_PID=(\d+)/.exec(err.stdout)?.[1]);
      return true;
    },
  );
  assert.ok(pid > 0, 'the child reported its process id');
  let alive = true;
  for (let i = 0; i < 40 && alive; i++) {
    try {
      process.kill(pid, 0); // throws once the process no longer exists
      await sleep(100);
    } catch {
      alive = false;
    }
  }
  assert.equal(alive, false, 'the process must be gone after a timeout');
});
