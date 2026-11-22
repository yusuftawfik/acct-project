// Small SQLite layer (better-sqlite3). Swap this file for PostgreSQL when hosting needs persistent storage.
// Amounts are stored as whole cents (INTEGER), never as decimals.
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  txn_type    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id     INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  account_id   INTEGER NOT NULL,
  debit_cents  INTEGER NOT NULL DEFAULT 0,
  credit_cents INTEGER NOT NULL DEFAULT 0,
  faculty      TEXT NOT NULL DEFAULT 'Central'
);
CREATE INDEX IF NOT EXISTS idx_lines_entry ON lines(entry_id);
`;

export function openDb(path) {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const insertEntryStmt = db.prepare('INSERT INTO entries (date, txn_type, description) VALUES (?, ?, ?)');
  const insertLineStmt = db.prepare(
    'INSERT INTO lines (entry_id, account_id, debit_cents, credit_cents, faculty) VALUES (?, ?, ?, ?, ?)',
  );
  const updateEntryStmt = db.prepare('UPDATE entries SET date = ?, txn_type = ?, description = ? WHERE id = ?');
  const deleteLinesStmt = db.prepare('DELETE FROM lines WHERE entry_id = ?');
  const deleteEntryStmt = db.prepare('DELETE FROM entries WHERE id = ?');
  const existsStmt = db.prepare('SELECT 1 FROM entries WHERE id = ?');
  const flatStmt = db.prepare(
    `SELECT e.id AS entry_id, e.date, e.txn_type, e.description,
            l.account_id, l.debit_cents, l.credit_cents, l.faculty
     FROM lines l JOIN entries e ON e.id = l.entry_id
     ORDER BY e.date, e.id, l.id`,
  );

  const addLines = (entryId, lines) => {
    for (const l of lines) insertLineStmt.run(entryId, l.account_id, l.debit_cents, l.credit_cents, l.faculty);
  };

  // Each write is one transaction, so an entry is stored completely or not at all.
  const insertEntry = db.transaction((clean) => {
    const id = Number(insertEntryStmt.run(clean.date, clean.txn_type, clean.description).lastInsertRowid);
    addLines(id, clean.lines);
    return id;
  });
  const replaceEntry = db.transaction((id, clean) => {
    updateEntryStmt.run(clean.date, clean.txn_type, clean.description, id);
    deleteLinesStmt.run(id);
    addLines(id, clean.lines);
  });

  /** Every journal line in Journal-sheet order. */
  const flatLines = () => flatStmt.all();

  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM entries');
  const entryCount = () => countStmt.get().n;

  // Empties the journal and starts the entry numbers again at E0001. Returns how many entries were removed.
  const clearAll = db.transaction(() => {
    const removed = entryCount();
    db.exec('DELETE FROM lines; DELETE FROM entries;');
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('entries', 'lines')");
    return removed;
  });
  // Replaces everything with the given clean entries in ONE transaction: all of them are stored or none.
  const replaceAll = db.transaction((list) => {
    clearAll();
    for (const clean of list) insertEntry(clean);
  });

  return {
    insertEntry,
    replaceEntry,
    entryCount,
    clearAll,
    replaceAll,
    deleteEntry: (id) => deleteEntryStmt.run(id).changes > 0,
    entryExists: (id) => existsStmt.get(id) !== undefined,
    flatLines,
    entriesWithLines() {
      const out = [];
      const index = new Map();
      for (const r of flatLines()) {
        let e = index.get(r.entry_id);
        if (!e) {
          e = {
            id: r.entry_id,
            date: r.date,
            txn_type: r.txn_type,
            description: r.description,
            lines: [],
            total_cents: 0,
          };
          index.set(r.entry_id, e);
          out.push(e);
        }
        e.lines.push({
          account_id: r.account_id,
          debit_cents: r.debit_cents,
          credit_cents: r.credit_cents,
          faculty: r.faculty,
        });
        e.total_cents += r.debit_cents;
      }
      return out;
    },
    close: () => db.close(),
  };
}
