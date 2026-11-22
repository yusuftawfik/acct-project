"""CIC journal API (Flask). Run:  python app.py   then open http://127.0.0.1:5000"""
import csv
import datetime as dt
import io
import os
from functools import wraps

from flask import Flask, Response, g, jsonify, request, send_from_directory

import core
import db


def create_app(config=None):
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config.update(
        DATABASE=os.environ.get("CIC_DATABASE", os.path.join(os.path.dirname(__file__), "cic.db")),
        API_KEY=os.environ.get("CIC_API_KEY", ""),  # empty = writes unprotected (development only)
        FY_START=os.environ.get("CIC_FY_START", "2026-07-01"),
        TAX_RATE=float(os.environ.get("CIC_TAX_RATE", "0.225")),
    )
    if config:
        app.config.update(config)
    db.init(app.config["DATABASE"])

    def fy_start():
        return dt.date.fromisoformat(app.config["FY_START"])

    def conn():
        if "db" not in g:
            g.db = db.connect(app.config["DATABASE"])
        return g.db

    @app.teardown_appcontext
    def close(_exc):
        c = g.pop("db", None)
        if c is not None:
            c.close()

    def protected(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            key = app.config["API_KEY"]
            if key and request.headers.get("X-API-Key") != key:
                return jsonify({"errors": ["Missing or wrong API key."]}), 401
            return fn(*a, **kw)
        return wrapper

    def lines_for_calc():
        return db.flat_lines(conn())

    # ---------- pages ----------
    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "financial_year_start": app.config["FY_START"],
                        "writes_protected": bool(app.config["API_KEY"])})

    # ---------- reference data ----------
    @app.get("/api/accounts")
    def accounts():
        return jsonify([{"id": i, "name": n, "type": t, "faculty_tag": tag}
                        for i, (n, t, tag) in core.ACCOUNTS.items()])

    @app.get("/api/templates")
    def templates():
        return jsonify([{"code": c, "name": n, "debit": d, "credit": cr}
                        for c, (n, d, cr) in core.TEMPLATES.items()])

    # ---------- entries ----------
    @app.get("/api/entries")
    def list_entries():
        return jsonify(db.entries_with_lines(conn()))

    @app.post("/api/entries")
    @protected
    def add_entry():
        clean, errors = core.validate_entry(request.get_json(silent=True) or {}, fy_start())
        if errors:
            return jsonify({"errors": errors}), 422
        eid = db.insert_entry(conn(), clean)
        return jsonify({"id": eid, **clean}), 201

    @app.put("/api/entries/<int:eid>")
    @protected
    def edit_entry(eid):
        if not db.entry_exists(conn(), eid):
            return jsonify({"errors": ["Entry not found."]}), 404
        clean, errors = core.validate_entry(request.get_json(silent=True) or {}, fy_start())
        if errors:
            return jsonify({"errors": errors}), 422
        db.replace_entry(conn(), eid, clean)
        return jsonify({"id": eid, **clean})

    @app.delete("/api/entries/<int:eid>")
    @protected
    def remove_entry(eid):
        if not db.delete_entry(conn(), eid):
            return jsonify({"errors": ["Entry not found."]}), 404
        return jsonify({"deleted": eid})

    # ---------- reports ----------
    @app.get("/api/summary")
    def summary():
        m = core.parse_month(request.args.get("through"), fy_start())
        if m is None:
            return jsonify({"errors": ["'through' must be YYYY-MM inside the financial year, or 1 to 12."]}), 422
        return jsonify(core.summary(lines_for_calc(), fy_start(), m))

    @app.get("/api/tax/suggest")
    def tax_suggest():
        m = core.parse_month(request.args.get("month"), fy_start())
        if m is None:
            return jsonify({"errors": ["'month' must be YYYY-MM inside the financial year, or 1 to 12."]}), 422
        return jsonify(core.tax_suggestion(lines_for_calc(), fy_start(), m, app.config["TAX_RATE"]))

    # ---------- feed for Excel and Power BI ----------
    FEED_COLS = ["EntryID", "Date", "TxnType", "AccountID", "Debit", "Credit", "Faculty", "Description"]

    def feed_rows():
        return [[r["entry_id"], r["date"], r["txn_type"], r["account_id"],
                 r["debit"] if r["debit"] else "", r["credit"] if r["credit"] else "",
                 r["faculty"], r["description"]] for r in lines_for_calc()]

    @app.get("/journal.csv")
    def journal_csv():
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(FEED_COLS)
        w.writerows(feed_rows())
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": "inline; filename=journal.csv"})

    @app.get("/api/journal")
    def journal_json():
        return jsonify([dict(zip(FEED_COLS, row)) for row in feed_rows()])

    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    create_app().run(host="127.0.0.1", port=port, debug=True)
