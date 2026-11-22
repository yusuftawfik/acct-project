// CIC journal API (Express). Same endpoints as the Python version.
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as core from './core.js';
import { openDb } from './db.js';
import { createReports } from './reports.js';
import { buildYear, countYear } from '../scripts/seed-sample-year.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// On Vercel the deployed files are read-only (only the temp folder is writable) and there is no Excel.
const onVercel = Boolean(process.env.VERCEL);

const FEED_COLS = ['EntryID', 'Date', 'TxnType', 'AccountID', 'Debit', 'Credit', 'Faculty', 'Description'];

const csvCell = (v) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

// Entry as the API returns it: amounts in currency, not cents.
const apiLine = (l) => ({
  account_id: l.account_id,
  debit: core.toMoney(l.debit_cents),
  credit: core.toMoney(l.credit_cents),
  faculty: l.faculty,
});

/**
 * config (all optional): database, apiKey, fyStart ('YYYY-MM-DD'), taxRate (e.g. 0.225),
 * exportMode ('live' | 'static'), excelPath, exportsDir, exportTimeoutMs, exportRunner (tests only)
 * Defaults come from the environment: CIC_DATABASE, CIC_API_KEY, CIC_FY_START, CIC_TAX_RATE,
 * EXCEL_EXPORT_MODE, EXCEL_PATH.
 */
export function createApp(config = {}) {
  const settings = {
    database:
      config.database ??
      process.env.CIC_DATABASE ??
      (onVercel ? path.join(os.tmpdir(), 'cic.db') : path.join(serverRoot, 'data', 'cic.db')),
    apiKey: config.apiKey ?? process.env.CIC_API_KEY ?? '', // empty = writes unprotected (development only)
    fyStart: config.fyStart ?? process.env.CIC_FY_START ?? '2026-07-01',
    taxRate: Number(config.taxRate ?? process.env.CIC_TAX_RATE ?? '0.225'),
    // 'live' runs Excel to make the PDF reports; 'static' only serves the PDFs already in excel/exports.
    exportMode: config.exportMode ?? process.env.EXCEL_EXPORT_MODE ?? (onVercel ? 'static' : 'live'),
    excelPath: config.excelPath ?? process.env.EXCEL_PATH ?? path.resolve(serverRoot, '..', 'excel', 'CIC_Financial_Model_v2.xlsx'),
    // On Vercel the PDFs must live inside server/ so they are deployed with the function (excel/ is outside it).
    exportsDir:
      config.exportsDir ?? (onVercel ? path.resolve(serverRoot, 'exports') : path.resolve(serverRoot, '..', 'excel', 'exports')),
    // Quiet time (ms) after a journal change before Excel makes the PDFs in the background. 0 = only when asked.
    prewarmMs: Number(config.prewarmMs ?? process.env.EXCEL_PREWARM_MS ?? 0),
  };
  const fyStart = core.parseIsoDate(settings.fyStart);
  if (!fyStart) throw new Error(`CIC_FY_START must be YYYY-MM-DD, got '${settings.fyStart}'.`);
  if (!Number.isFinite(settings.taxRate) || settings.taxRate < 0) throw new Error('CIC_TAX_RATE must be a number >= 0.');
  if (!['live', 'static'].includes(settings.exportMode)) {
    throw new Error(`EXCEL_EXPORT_MODE must be 'live' or 'static', got '${settings.exportMode}'.`);
  }

  mkdirSync(path.dirname(settings.database), { recursive: true });
  const db = openDb(settings.database);

  const app = express();
  app.use(express.json());

  const protectedRoute = (req, res, next) => {
    if (settings.apiKey && req.get('X-API-Key') !== settings.apiKey) {
      return res.status(401).json({ errors: ['Missing or wrong API key.'] });
    }
    next();
  };

  // ---------- Excel PDF reports (see reports.js) ----------
  const reports = createReports({
    database: settings.database,
    exportsDir: settings.exportsDir,
    exportMode: settings.exportMode,
    excelPath: settings.excelPath,
    script: path.join(serverRoot, 'scripts', 'export-excel.ps1'),
    timeoutMs: config.exportTimeoutMs,
    prewarmMs: settings.prewarmMs,
    runner: config.exportRunner,
    protectedRoute,
  });
  app.use('/api/reports', reports.router);

  // ---------- pages (the front end build goes in server/public) ----------
  const publicDir = path.join(serverRoot, 'public');
  if (existsSync(publicDir)) app.use(express.static(publicDir));

  app.get('/api/health', (_req, res) =>
    res.json({ status: 'ok', financial_year_start: settings.fyStart, writes_protected: Boolean(settings.apiKey) }),
  );

  // ---------- reference data ----------
  app.get('/api/accounts', (_req, res) =>
    res.json([...core.ACCOUNTS].map(([id, a]) => ({ id, name: a.name, type: a.type, faculty_tag: a.facultyTag }))),
  );

  app.get('/api/templates', (_req, res) =>
    res.json([...core.TEMPLATES].map(([code, t]) => ({ code, name: t.name, debit: t.debit, credit: t.credit }))),
  );

  // ---------- entries ----------
  app.get('/api/entries', (_req, res) =>
    res.json(
      db.entriesWithLines().map((e) => ({
        id: e.id,
        date: e.date,
        txn_type: e.txn_type,
        description: e.description,
        lines: e.lines.map(apiLine),
        total: core.toMoney(e.total_cents),
      })),
    ),
  );

  const savedEntry = (id, clean) => ({
    id,
    date: clean.date,
    txn_type: clean.txn_type,
    description: clean.description,
    lines: clean.lines.map(apiLine),
  });

  app.post('/api/entries', protectedRoute, (req, res) => {
    const { clean, errors } = core.validateEntry(req.body, fyStart);
    if (errors.length) return res.status(422).json({ errors });
    const id = db.insertEntry(clean);
    reports.noteChange(); // the PDF reports are now out of date
    res.status(201).json(savedEntry(id, clean));
  });

  app.put('/api/entries/:eid(\\d+)', protectedRoute, (req, res) => {
    const id = Number(req.params.eid);
    if (!db.entryExists(id)) return res.status(404).json({ errors: ['Entry not found.'] });
    const { clean, errors } = core.validateEntry(req.body, fyStart);
    if (errors.length) return res.status(422).json({ errors });
    db.replaceEntry(id, clean);
    reports.noteChange();
    res.json(savedEntry(id, clean));
  });

  app.delete('/api/entries/:eid(\\d+)', protectedRoute, (req, res) => {
    const id = Number(req.params.eid);
    if (!db.deleteEntry(id)) return res.status(404).json({ errors: ['Entry not found.'] });
    reports.noteChange();
    res.json({ deleted: id });
  });

  // Empties the whole journal (the Excel workbook reads the journal from this app, so it is empty there too
  // after its next refresh). Entry numbers start again at E0001.
  app.delete('/api/entries', protectedRoute, (_req, res) => {
    const deleted = db.clearAll();
    reports.noteChange();
    res.json({ deleted });
  });

  // Builds the same sample financial year as scripts/seed-sample-year.js and stores it.
  // With entries already present it only goes ahead when ?replace=1 is given (the old entries are removed first).
  app.post('/api/sample-data', protectedRoute, (req, res) => {
    const existing = db.entryCount();
    if (existing && req.query.replace !== '1') {
      return res.status(409).json({ errors: [`The journal already holds ${existing} entries. Clear it first, or replace them.`] });
    }
    try {
      const { entries } = buildYear(fyStart, settings.taxRate);
      db.replaceAll(entries);
      reports.noteChange();
      res.status(201).json(countYear(entries));
    } catch (err) {
      console.error(err);
      res.status(500).json({ errors: [`Could not build the sample year: ${err.message}`] });
    }
  });

  // ---------- reports ----------
  app.get('/api/summary', (req, res) => {
    const m = core.parseMonth(req.query.through, fyStart);
    if (m === null) {
      return res.status(422).json({ errors: ["'through' must be YYYY-MM inside the financial year, or 1 to 12."] });
    }
    res.json(core.summary(db.flatLines(), fyStart, m));
  });

  app.get('/api/tax/suggest', (req, res) => {
    const m = core.parseMonth(req.query.month, fyStart);
    if (m === null) {
      return res.status(422).json({ errors: ["'month' must be YYYY-MM inside the financial year, or 1 to 12."] });
    }
    res.json(core.taxSuggestion(db.flatLines(), fyStart, m, settings.taxRate));
  });

  // ---------- feed for Excel and Power BI (same columns as the Journal sheet) ----------
  const feedRows = () =>
    db.flatLines().map((r) => [
      r.entry_id,
      r.date,
      r.txn_type,
      r.account_id,
      r.debit_cents ? core.toMoney(r.debit_cents) : '',
      r.credit_cents ? core.toMoney(r.credit_cents) : '',
      r.faculty,
      r.description,
    ]);

  app.get('/journal.csv', (_req, res) => {
    const text = [FEED_COLS, ...feedRows()].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
    res.type('text/csv').set('Content-Disposition', 'inline; filename=journal.csv').send(text);
  });

  app.get('/api/journal', (_req, res) =>
    res.json(feedRows().map((row) => Object.fromEntries(FEED_COLS.map((c, i) => [c, row[i]])))),
  );

  // Malformed JSON body: answer in the same { errors } shape as every other failure.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(422).json({ errors: ['Request body is not valid JSON.'] });
    }
    console.error(err);
    res.status(500).json({ errors: ['Server error.'] });
  });

  return { app, close: () => db.close(), settings, warmReports: reports.warmSoon };
}
