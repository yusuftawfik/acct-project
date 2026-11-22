// Excel PDF reports: list, refresh and download.
//
// Every PDF is produced by Excel itself (server/scripts/export-excel.ps1, run through PowerShell).
// This file never builds a PDF: it decides WHEN to run the script and then streams the result.
//
// Modes (EXCEL_EXPORT_MODE):
//   live    (default) run Excel when an export is missing or out of date. Needs Windows + desktop Excel.
//   static  never run Excel; serve whatever PDFs are already in excel/exports (for hosting without Excel).
//
// When is an export "out of date" (live mode)?
//   - the PDF file is missing, or
//   - the journal changed (POST, PUT or DELETE) after the last export finished, tracked with an
//     in-memory counter, or
//   - after a server restart, the PDF is older than the database file.
//
// Contract with export-excel.ps1 (Part 4B), started as:
//   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File export-excel.ps1
//                  -WorkbookPath <xlsx> -OutDir <folder>
//   - writes <OutDir>\<slug>.pdf for every slug below, exits 0 on success, non-zero on failure
//   - writes a readable message to stderr when it fails
//   - prints "EXCEL_PID=<number>" (the hidden Excel process it started) to stdout right after
//     starting Excel, so a timeout can also end that Excel process, not only PowerShell.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import express from 'express';

// Slug -> what it contains. The sheet names are the exact Excel sheet names.
export const REPORTS = [
  { slug: 'all-statements', title: 'All statements' },
  { slug: 'financial-position', title: 'Financial Position' },
  { slug: 'income-statement', title: 'Income Statement' },
  { slug: 'net-income', title: 'Net Income' },
  { slug: 'cash-flows', title: 'Cash Flows' },
  { slug: 'owners-equity', title: 'Owners Equity' },
  { slug: 'notes', title: 'Notes' },
  { slug: 'trial-balance', title: 'Trial Balance' },
  { slug: 'tax', title: 'Tax' },
  { slug: 'checks', title: 'Checks' },
  { slug: 'journal', title: 'Journal' },
];
export const SLUGS = REPORTS.map((r) => r.slug); // the whitelist: nothing else is ever turned into a file name

const exportError = (message, code = 'EXPORT_FAILED') => Object.assign(new Error(message), { code });

// ------------------------------------------------------------ running a program

/**
 * Runs a program, collects its output, and enforces a time limit.
 * Resolves { stdout, stderr } on exit code 0. Rejects with an Error whose .code is
 *   'TIMEOUT' (time limit hit, the process is ended) or 'EXPORT_FAILED' (non-zero exit, could not start).
 */
export function runCommand(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let finished = false;
    let timer;
    let hardTimer;

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      fn(value);
    };
    const timeoutError = () => Object.assign(exportError(`Export timed out after ${timeoutMs / 1000} s.`, 'TIMEOUT'), { stdout });

    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (err) {
      reject(exportError(`Could not start ${command}: ${err.message}`));
      return;
    }
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(reject, exportError(`Could not start ${command}: ${err.message}`)));
    child.on('close', (code) => {
      if (timedOut) return finish(reject, timeoutError());
      if (code === 0) return finish(resolve, { stdout, stderr });
      const text = (stderr || stdout).trim().slice(0, 500);
      return finish(reject, Object.assign(exportError(text || `${command} exited with code ${code}.`), { exitCode: code }));
    });

    timer = setTimeout(() => {
      timedOut = true;
      killTree(child, stdout);
      // If the process somehow will not die, do not leave the API stuck forever.
      hardTimer = setTimeout(() => finish(reject, timeoutError()), 10_000);
    }, timeoutMs);
  });
}

// Ends the child and everything it started. The hidden Excel is NOT a child of PowerShell (Windows
// starts it separately), so its process id is read from the script's "EXCEL_PID=n" output.
function killTree(child, stdout) {
  const kill = (args) => {
    try {
      spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    } catch { /* taskkill missing: nothing more we can do */ }
  };
  if (process.platform === 'win32') {
    if (child.pid) kill(['/PID', String(child.pid), '/T', '/F']);
    for (const m of stdout.matchAll(/EXCEL_PID=(\d+)/g)) {
      // The image-name filter makes sure a recycled process id can never end some other program.
      kill(['/PID', m[1], '/F', '/FI', 'IMAGENAME eq EXCEL.EXE']);
    }
  } else if (child.pid) {
    try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

// ------------------------------------------------------------------ the module

const statFile = (p) => {
  try {
    const st = statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
};

/**
 * options:
 *   database       path of the SQLite file (its modified time decides staleness after a restart)
 *   exportsDir     folder that holds the PDFs
 *   exportMode     'live' | 'static'
 *   excelPath      the workbook, passed to the script
 *   script         path of export-excel.ps1
 *   timeoutMs      time limit for one export (default 120 s)
 *   runner         async ({ workbookPath, outDir }) => void; replaces the PowerShell run (used by tests)
 *   protectedRoute Express middleware that checks the API key
 * Returns { router, noteChange }. Call noteChange() after every successful journal write.
 */
export function createReports(options) {
  const {
    database, exportsDir, exportMode, excelPath, script, protectedRoute,
    timeoutMs = 120_000,
    prewarmMs = 0,
  } = options;
  const live = exportMode === 'live';

  const fileFor = (slug) => path.join(exportsDir, `${slug}.pdf`);

  // Journal changes seen by this server process, and the change count the last finished export covers.
  let version = 0;
  let exportedVersion = null; // null until an export has finished in this process
  let running = null; // the Promise of the export that is running right now, if any
  let lastRun = null;

  // After a restart nothing is known in memory, so an export older than the database file counts as stale.
  const dbModified = statFile(database)?.mtimeMs ?? 0;

  const noteChange = () => {
    version += 1;
    scheduleWarm();
  };

  // Background export: shortly after the journal stops changing, Excel makes the PDFs, so they are already
  // up to date when someone clicks Print. prewarmMs is the quiet time to wait (0 = off).
  let warmTimer = null;
  function scheduleWarm(ms = prewarmMs) {
    if (!live || !(ms > 0)) return;
    clearTimeout(warmTimer);
    warmTimer = setTimeout(warm, ms);
    warmTimer.unref?.();
  }
  async function warm() {
    if (running) {
      const ok = await running.then(() => true, () => false);
      if (!ok) return; // the failure is kept in last_run; the next download tries again
    }
    if (!SLUGS.some(isStale)) return;
    try {
      await runOnce();
    } catch {
      /* recorded in last_run */
    }
  }

  function isStale(slug) {
    const st = statFile(fileFor(slug));
    if (!st) return true;
    if (exportedVersion !== null) return version > exportedVersion;
    return version > 0 || st.mtimeMs < dbModified;
  }

  const defaultRunner = async () => {
    if (process.platform !== 'win32') {
      throw exportError('Excel export needs Windows with desktop Excel. Set EXCEL_EXPORT_MODE=static to serve existing PDFs only.');
    }
    if (!existsSync(script)) throw exportError(`Export script not found: ${script}`);
    if (!existsSync(excelPath)) throw exportError(`Excel workbook not found: ${excelPath}`);
    mkdirSync(exportsDir, { recursive: true });
    const { stdout } = await runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-WorkbookPath', excelPath, '-OutDir', exportsDir],
      { timeoutMs },
    );
    const timing = stdout.match(/^TIMING .*$/m); // where the time went, printed by export-excel.ps1
    if (timing) console.log(`PDF export: ${timing[0].slice(7)}`);
  };
  const runner = options.runner ?? defaultRunner;

  // One export at a time. Anyone who asks while one is running waits for that same run.
  function runOnce() {
    if (running) return running;
    const versionAtStart = version;
    const startedAt = Date.now();
    const promise = (async () => {
      await null; // always asynchronous, so `running` is set before anything below can finish
      try {
        await runner({ workbookPath: excelPath, outDir: exportsDir });
        exportedVersion = versionAtStart; // changes made during the run are not covered by it
        lastRun = { ok: true, finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt, error: null };
      } catch (err) {
        lastRun = { ok: false, finished_at: new Date().toISOString(), duration_ms: Date.now() - startedAt, error: err.message };
        throw err;
      } finally {
        running = null;
      }
    })();
    running = promise;
    return promise;
  }

  // Runs Excel (at most twice, in case the journal changed during a run) until this report is up to date.
  async function ensureFresh(slug) {
    for (let attempt = 0; attempt < 2 && isStale(slug); attempt++) await runOnce();
  }

  const sendError = (res, err) => {
    const status = err.code === 'TIMEOUT' ? 504 : 500;
    res.status(status).json({ errors: [`Excel export failed: ${err.message}`] });
  };

  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json({
      mode: exportMode,
      running: Boolean(running),
      last_run: lastRun,
      reports: REPORTS.map(({ slug, title }) => {
        const st = statFile(fileFor(slug));
        return {
          slug,
          title,
          available: Boolean(st),
          exported_at: st ? st.mtime.toISOString() : null,
          stale: live ? isStale(slug) : false,
        };
      }),
    });
  });

  router.post('/refresh', protectedRoute, async (_req, res) => {
    if (!live) {
      return res.status(409).json({ errors: ['Exports are served as they are (EXCEL_EXPORT_MODE=static); refresh is turned off.'] });
    }
    if (running) return res.status(409).json({ errors: ['An export is already running. Try again when it has finished.'] });
    const startedAt = Date.now();
    try {
      await runOnce();
    } catch (err) {
      return sendError(res, err);
    }
    res.json({
      exported: SLUGS.filter((slug) => statFile(fileFor(slug))),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    });
  });

  router.get('/:slug.pdf', async (req, res) => {
    const { slug } = req.params;
    // Whitelist first. The slug is never used in a path before this check passes.
    if (!SLUGS.includes(slug)) return res.status(404).json({ errors: [`Unknown report '${slug}'.`] });

    if (live) {
      try {
        await ensureFresh(slug);
      } catch (err) {
        return sendError(res, err);
      }
    }
    if (!statFile(fileFor(slug))) {
      return live
        ? res.status(500).json({ errors: [`Excel finished but did not produce ${slug}.pdf.`] })
        : res.status(404).json({ errors: [`No exported PDF for '${slug}' yet. Export the reports on a Windows PC with Excel and copy them to the exports folder.`] });
    }
    // sendFile streams the file. `root` keeps it inside the exports folder.
    res.sendFile(`${slug}.pdf`, {
      root: exportsDir,
      dotfiles: 'allow',
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slug}.pdf"`,
        'Cache-Control': 'no-store',
      },
    }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ errors: ['Could not read the PDF.'] });
    });
  });

  return { router, noteChange, warmSoon: () => scheduleWarm(prewarmMs > 0 ? 1500 : 0) };
}
