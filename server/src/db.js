// Storage layer. Two interchangeable back ends, chosen by the settings passed to openDb:
//   - PostgreSQL (when a database URL is given): used on the hosted site, keeps the data permanently.
//   - SQLite (better-sqlite3): used on your own computer and in the tests.
// Every journal belongs to an owner (an anonymous visitor id), and every method takes that owner first, so
// one visitor can never read or change another visitor's entries.
// Amounts are stored as whole cents (integers), never as decimals. All methods are async.

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    TEXT NOT NULL DEFAULT 'local',
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

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id          BIGSERIAL PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  date        TEXT NOT NULL,
  txn_type    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entries_owner ON entries(owner_id);
CREATE TABLE IF NOT EXISTS lines (
  id           BIGSERIAL PRIMARY KEY,
  entry_id     BIGINT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  account_id   INTEGER NOT NULL,
  debit_cents  BIGINT NOT NULL DEFAULT 0,
  credit_cents BIGINT NOT NULL DEFAULT 0,
  faculty      TEXT NOT NULL DEFAULT 'Central'
);
CREATE INDEX IF NOT EXISTS idx_lines_entry ON lines(entry_id);
`;

// Groups flat journal lines back into entries (same shape for both back ends).
function groupEntries(flat) {
  const out = [];
  const index = new Map();
  for (const r of flat) {
    let e = index.get(r.entry_id);
    if (!e) {
      e = { id: r.entry_id, date: r.date, txn_type: r.txn_type, description: r.description, lines: [], total_cents: 0 };
      index.set(r.entry_id, e);
      out.push(e);
    }
    e.lines.push({ account_id: r.account_id, debit_cents: r.debit_cents, credit_cents: r.credit_cents, faculty: r.faculty });
    e.total_cents += r.debit_cents;
  }
  return out;
}

// ------------------------------------------------------------------ SQLite

async function openSqlite(file) {
  // Loaded only when needed, so the hosted site (which uses PostgreSQL) never loads the native module.
  const { default: Database } = await import('better-sqlite3');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec(SQLITE_SCHEMA);
  // A database made before journals had owners gets the column; its old entries belong to 'local'.
  if (!db.prepare('PRAGMA table_info(entries)').all().some((c) => c.name === 'owner_id')) {
    db.exec("ALTER TABLE entries ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local'");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_entries_owner ON entries(owner_id)');

  const insertEntryStmt = db.prepare('INSERT INTO entries (owner_id, date, txn_type, description) VALUES (?, ?, ?, ?)');
  const insertLineStmt = db.prepare(
    'INSERT INTO lines (entry_id, account_id, debit_cents, credit_cents, faculty) VALUES (?, ?, ?, ?, ?)',
  );
  const updateEntryStmt = db.prepare('UPDATE entries SET date = ?, txn_type = ?, description = ? WHERE id = ? AND owner_id = ?');
  const deleteLinesStmt = db.prepare('DELETE FROM lines WHERE entry_id = ?');
  const deleteEntryStmt = db.prepare('DELETE FROM entries WHERE id = ? AND owner_id = ?');
  const existsStmt = db.prepare('SELECT 1 FROM entries WHERE id = ? AND owner_id = ?');
  const flatStmt = db.prepare(
    `SELECT e.id AS entry_id, e.date, e.txn_type, e.description,
            l.account_id, l.debit_cents, l.credit_cents, l.faculty
     FROM lines l JOIN entries e ON e.id = l.entry_id
     WHERE e.owner_id = ?
     ORDER BY e.date, e.id, l.id`,
  );
  const countStmt = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE owner_id = ?');
  const lineCountStmt = db.prepare('SELECT COUNT(*) AS n FROM lines l JOIN entries e ON e.id = l.entry_id WHERE e.owner_id = ?');
  const clearEntriesStmt = db.prepare('DELETE FROM entries WHERE owner_id = ?');
  const anyEntryStmt = db.prepare('SELECT 1 FROM entries LIMIT 1');

  const addLines = (entryId, lines) => {
    for (const l of lines) insertLineStmt.run(entryId, l.account_id, l.debit_cents, l.credit_cents, l.faculty);
  };

  // Each write is one transaction, so an entry is stored completely or not at all.
  const insertEntry = db.transaction((owner, clean) => {
    const id = Number(insertEntryStmt.run(owner, clean.date, clean.txn_type, clean.description).lastInsertRowid);
    addLines(id, clean.lines);
    return id;
  });
  const replaceEntry = db.transaction((owner, id, clean) => {
    const changed = updateEntryStmt.run(clean.date, clean.txn_type, clean.description, id, owner).changes;
    if (!changed) return false;
    deleteLinesStmt.run(id);
    addLines(id, clean.lines);
    return true;
  });
  // Empties one owner's journal. When nothing is left in the whole database the entry numbers start again at E0001.
  const clearAll = db.transaction((owner) => {
    const removed = clearEntriesStmt.run(owner).changes;
    if (!anyEntryStmt.get()) db.exec("DELETE FROM sqlite_sequence WHERE name IN ('entries', 'lines')");
    return removed;
  });
  // Replaces everything with the given clean entries in ONE transaction: all of them are stored or none.
  const replaceAll = db.transaction((owner, list) => {
    clearAll(owner);
    for (const clean of list) insertEntry(owner, clean);
  });

  return {
    insertEntry: async (owner, clean) => insertEntry(owner, clean),
    replaceEntry: async (owner, id, clean) => replaceEntry(owner, id, clean),
    entryCount: async (owner) => countStmt.get(owner).n,
    lineCount: async (owner) => lineCountStmt.get(owner).n,
    clearAll: async (owner) => clearAll(owner),
    replaceAll: async (owner, list) => replaceAll(owner, list),
    deleteEntry: async (owner, id) => deleteEntryStmt.run(id, owner).changes > 0,
    entryExists: async (owner, id) => existsStmt.get(id, owner) !== undefined,
    flatLines: async (owner) => flatStmt.all(owner),
    close: async () => db.close(),
  };
}

// ------------------------------------------------------------------ PostgreSQL

async function openPostgres(url) {
  const pg = await import('pg');
  const { Pool, types } = pg.default ?? pg;
  // BIGINT comes back as text by default; cents and ids are far below 2^53, so plain numbers are exact.
  types.setTypeParser(20, (v) => Number(v));

  const pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 });
  pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));
  try {
    await pool.query(PG_SCHEMA);
  } catch (err) {
    // two cold starts creating the tables at the same moment: the second one just tries again
    await pool.query(PG_SCHEMA).catch(() => {
      throw err;
    });
  }

  const columns = (lines) => [
    lines.map((l) => l.account_id),
    lines.map((l) => l.debit_cents),
    lines.map((l) => l.credit_cents),
    lines.map((l) => l.faculty),
  ];

  const insertEntry = async (owner, clean) => {
    const { rows } = await pool.query(
      `WITH e AS (
         INSERT INTO entries (owner_id, date, txn_type, description) VALUES ($1, $2, $3, $4) RETURNING id
       )
       INSERT INTO lines (entry_id, account_id, debit_cents, credit_cents, faculty)
       SELECT e.id, t.a, t.d, t.c, t.f FROM e,
              unnest($5::int[], $6::bigint[], $7::bigint[], $8::text[]) AS t(a, d, c, f)
       RETURNING entry_id`,
      [owner, clean.date, clean.txn_type, clean.description, ...columns(clean.lines)],
    );
    return rows[0].entry_id;
  };

  const replaceEntry = async (owner, id, clean) => {
    const { rows } = await pool.query(
      `WITH u AS (
         UPDATE entries SET date = $1, txn_type = $2, description = $3 WHERE id = $4 AND owner_id = $5 RETURNING id
       ), d AS (
         DELETE FROM lines WHERE entry_id IN (SELECT id FROM u) RETURNING 1
       )
       INSERT INTO lines (entry_id, account_id, debit_cents, credit_cents, faculty)
       SELECT u.id, t.a, t.d, t.c, t.f FROM u,
              unnest($6::int[], $7::bigint[], $8::bigint[], $9::text[]) AS t(a, d, c, f)
       RETURNING entry_id`,
      [clean.date, clean.txn_type, clean.description, id, owner, ...columns(clean.lines)],
    );
    return rows.length > 0;
  };

  const replaceAll = async (owner, list) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM entries WHERE owner_id = $1', [owner]);
      if (list.length) {
        const { rows: idRows } = await client.query(
          "SELECT nextval(pg_get_serial_sequence('entries', 'id')) AS id FROM generate_series(1, $1::int)",
          [list.length],
        );
        const ids = idRows.map((r) => Number(r.id));
        await client.query(
          `INSERT INTO entries (id, owner_id, date, txn_type, description)
           SELECT t.id, $1, t.d, t.k, t.s FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[]) AS t(id, d, k, s)`,
          [owner, ids, list.map((e) => e.date), list.map((e) => e.txn_type), list.map((e) => e.description)],
        );
        const flat = list.flatMap((e, i) => e.lines.map((l) => ({ ...l, entry: ids[i] })));
        await client.query(
          `INSERT INTO lines (entry_id, account_id, debit_cents, credit_cents, faculty)
           SELECT * FROM unnest($1::bigint[], $2::int[], $3::bigint[], $4::bigint[], $5::text[])`,
          [flat.map((l) => l.entry), ...columns(flat)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };

  return {
    insertEntry,
    replaceEntry,
    replaceAll,
    entryCount: async (owner) => (await pool.query('SELECT COUNT(*) AS n FROM entries WHERE owner_id = $1', [owner])).rows[0].n,
    lineCount: async (owner) =>
      (await pool.query('SELECT COUNT(*) AS n FROM lines l JOIN entries e ON e.id = l.entry_id WHERE e.owner_id = $1', [owner])).rows[0].n,
    clearAll: async (owner) => (await pool.query('DELETE FROM entries WHERE owner_id = $1', [owner])).rowCount,
    deleteEntry: async (owner, id) => (await pool.query('DELETE FROM entries WHERE id = $1 AND owner_id = $2', [id, owner])).rowCount > 0,
    entryExists: async (owner, id) =>
      (await pool.query('SELECT 1 FROM entries WHERE id = $1 AND owner_id = $2', [id, owner])).rowCount > 0,
    flatLines: async (owner) =>
      (
        await pool.query(
          `SELECT e.id AS entry_id, e.date, e.txn_type, e.description,
                  l.account_id, l.debit_cents, l.credit_cents, l.faculty
           FROM lines l JOIN entries e ON e.id = l.entry_id
           WHERE e.owner_id = $1
           ORDER BY e.date, e.id, l.id`,
          [owner],
        )
      ).rows,
    close: async () => pool.end(),
  };
}

/**
 * openDb({ sqlitePath, databaseUrl }): PostgreSQL when databaseUrl is given, otherwise SQLite at sqlitePath.
 * Returns at once; the connection is opened on first use.
 */
export function openDb({ sqlitePath, databaseUrl } = {}) {
  let impl = null; // promise of the opened back end
  let opened = null; // the opened back end itself, once ready
  const ready = () => {
    if (!impl) {
      impl = (databaseUrl ? openPostgres(databaseUrl) : openSqlite(sqlitePath)).then(
        (db) => (opened = db),
        (err) => {
          impl = null; // a failed connect is tried again on the next request
          throw err;
        },
      );
    }
    return impl;
  };
  const call = (name) => async (...args) => (await ready())[name](...args);

  return {
    insertEntry: call('insertEntry'),
    replaceEntry: call('replaceEntry'),
    entryCount: call('entryCount'),
    lineCount: call('lineCount'),
    clearAll: call('clearAll'),
    replaceAll: call('replaceAll'),
    deleteEntry: call('deleteEntry'),
    entryExists: call('entryExists'),
    flatLines: call('flatLines'),
    async entriesWithLines(owner) {
      return groupEntries(await (await ready()).flatLines(owner));
    },
    // Closes at once when the database is already open (the tests delete the file right after).
    close() {
      if (opened) return opened.close();
      return impl ? impl.then((db) => db.close()) : undefined;
    },
  };
}
