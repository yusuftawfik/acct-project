"""Small SQLite layer. Swap this file for PostgreSQL when hosting needs persistent storage."""
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    txn_type    TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id   INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL,
    debit      REAL NOT NULL DEFAULT 0,
    credit     REAL NOT NULL DEFAULT 0,
    faculty    TEXT NOT NULL DEFAULT 'Central'
);
CREATE INDEX IF NOT EXISTS idx_lines_entry ON lines(entry_id);
"""


def connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init(path):
    conn = connect(path)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def insert_entry(conn, clean):
    cur = conn.execute("INSERT INTO entries (date, txn_type, description) VALUES (?,?,?)",
                       (clean["date"], clean["txn_type"], clean["description"]))
    eid = cur.lastrowid
    _insert_lines(conn, eid, clean["lines"])
    conn.commit()
    return eid


def _insert_lines(conn, eid, lines):
    conn.executemany("INSERT INTO lines (entry_id, account_id, debit, credit, faculty) VALUES (?,?,?,?,?)",
                     [(eid, l["account_id"], l["debit"], l["credit"], l["faculty"]) for l in lines])


def replace_entry(conn, eid, clean):
    conn.execute("UPDATE entries SET date=?, txn_type=?, description=? WHERE id=?",
                 (clean["date"], clean["txn_type"], clean["description"], eid))
    conn.execute("DELETE FROM lines WHERE entry_id=?", (eid,))
    _insert_lines(conn, eid, clean["lines"])
    conn.commit()


def delete_entry(conn, eid):
    cur = conn.execute("DELETE FROM entries WHERE id=?", (eid,))
    conn.commit()
    return cur.rowcount > 0


def entry_exists(conn, eid):
    return conn.execute("SELECT 1 FROM entries WHERE id=?", (eid,)).fetchone() is not None


def flat_lines(conn):
    """Every journal line in Journal-sheet order."""
    rows = conn.execute(
        "SELECT e.id AS entry_id, e.date, e.txn_type, e.description, l.account_id, l.debit, l.credit, l.faculty "
        "FROM lines l JOIN entries e ON e.id = l.entry_id ORDER BY e.date, e.id, l.id").fetchall()
    return [dict(r) for r in rows]


def entries_with_lines(conn):
    out, index = [], {}
    for r in flat_lines(conn):
        e = index.get(r["entry_id"])
        if e is None:
            e = {"id": r["entry_id"], "date": r["date"], "txn_type": r["txn_type"],
                 "description": r["description"], "lines": [], "total": 0.0}
            index[r["entry_id"]] = e
            out.append(e)
        e["lines"].append({"account_id": r["account_id"], "debit": r["debit"],
                           "credit": r["credit"], "faculty": r["faculty"]})
        e["total"] = round(e["total"] + r["debit"], 2)
    return out
