import os, tempfile, unittest
import core
from app import create_app


def L(a, dr=0, cr=0, fac=None):
    d = {"account_id": a, "debit": dr, "credit": cr}
    if fac:
        d["faculty"] = fac
    return d


LECTURE = [
    ("2026-07-01", "T01", "Owner invests cash", [L(1010, 10000), L(3010, cr=10000)]),
    ("2026-07-02", "T22", "Equipment, part cash", [L(1510, 5000), L(1010, cr=1500), L(2010, cr=3500)]),
    ("2026-07-05", "T10", "Service on account", [L(1110, 1200), L(4050, cr=1200, fac="BT")]),
    ("2026-07-10", "T03", "Owner draws", [L(3020, 1000), L(1010, cr=1000)]),
    ("2026-07-15", "T11", "Collect 600", [L(1010, 600), L(1110, cr=600)]),
    ("2026-07-20", "T17", "Pay supplier", [L(2010, 3500), L(1010, cr=3500)]),
    ("2026-07-25", "T11", "Collect rest", [L(1010, 600), L(1110, cr=600)]),
]


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.app = create_app({"DATABASE": os.path.join(self.tmp, "t.db"), "API_KEY": "", "TESTING": True})
        self.c = self.app.test_client()

    def post(self, date, t, desc, lines, **kw):
        return self.c.post("/api/entries", json={"date": date, "txn_type": t, "description": desc, "lines": lines}, **kw)

    def load_lecture(self):
        for d, t, desc, lines in LECTURE:
            self.assertEqual(self.post(d, t, desc, lines).status_code, 201)

    def test_lecture_example_matches_excel_expectations(self):
        self.load_lecture()
        s = self.c.get("/api/summary").get_json()
        self.assertEqual((s["cash"], s["assets"], s["liabilities"]), (5200, 10200, 0))
        self.assertEqual((s["net_income"], s["equity"]), (1200, 10200))
        self.assertTrue(s["balanced"])

    def test_tax_suggestion_then_post(self):
        self.load_lecture()
        t = self.c.get("/api/tax/suggest?month=2026-07").get_json()
        self.assertEqual((t["profit_before_tax_ytd"], t["tax_required_ytd"], t["suggested"]), (1200, 270, 270))
        self.assertFalse(t["up_to_date"])
        r = self.post("2026-07-31", "T28", "Tax", t["proposal"])
        self.assertEqual(r.status_code, 201)
        t2 = self.c.get("/api/tax/suggest?month=2026-07").get_json()
        self.assertTrue(t2["up_to_date"])
        self.assertIsNone(t2["proposal"])  # must not offer the same entry twice
        self.assertEqual(t2["to_post"], 0)
        s = self.c.get("/api/summary").get_json()
        self.assertEqual((s["income_tax"], s["net_income"], s["liabilities"], s["equity"]), (270, 930, 270, 9930))
        self.assertTrue(s["balanced"])

    def test_partial_tax_posting_proposes_only_the_shortfall(self):
        self.load_lecture()
        self.post("2026-07-31", "T28", "Part tax", [L(5900, 100), L(2030, cr=100)])
        t = self.c.get("/api/tax/suggest?month=2026-07").get_json()
        self.assertEqual((t["suggested"], t["to_post"]), (270, 170))
        self.assertEqual(t["proposal"][0], {"account_id": 5900, "debit": 170.0, "credit": 0})

    def test_loss_month_suggests_reversal(self):
        self.load_lecture()
        t = self.c.get("/api/tax/suggest?month=7").get_json()
        self.post("2026-07-31", "T28", "Tax", t["proposal"])
        self.post("2026-08-10", "T26", "Utilities", [L(5060, 2000), L(1010, cr=2000)])
        t = self.c.get("/api/tax/suggest?month=2026-08").get_json()
        self.assertEqual((t["profit_before_tax_ytd"], t["tax_required_ytd"], t["suggested"]), (-800, 0, -270))
        self.assertEqual(t["proposal"][0]["account_id"], 2030)  # Dr payable, Cr expense

    def test_validation_rules(self):
        bad = {
            "unbalanced": ("2026-07-01", "T01", [L(1010, 500), L(3010, cr=400)]),
            "one line": ("2026-07-01", "T01", [L(1010, 500)]),
            "outside year": ("2027-07-01", "T01", [L(1010, 5), L(3010, cr=5)]),
            "unknown account": ("2026-07-01", "T01", [L(9999, 5), L(3010, cr=5)]),
            "both sides": ("2026-07-01", "T01", [L(1010, 5, 5), L(3010, cr=0)]),
            "no faculty": ("2026-07-01", "T06", [L(1010, 5), L(4010, cr=5)]),
            "negative": ("2026-07-01", "T01", [L(1010, -5), L(3010, cr=-5)]),
        }
        for name, (d, t, lines) in bad.items():
            r = self.post(d, t, name, lines)
            self.assertEqual(r.status_code, 422, name)
            self.assertTrue(r.get_json()["errors"], name)
        self.assertEqual(self.c.get("/api/entries").get_json(), [])  # nothing was stored

    def test_edit_and_delete(self):
        self.load_lecture()
        r = self.c.put("/api/entries/1", json={"date": "2026-07-01", "txn_type": "T01", "description": "x",
                                               "lines": [L(1010, 12000), L(3010, cr=12000)]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get("/api/summary").get_json()["cash"], 7200)
        self.assertEqual(self.c.delete("/api/entries/3").status_code, 200)
        self.assertEqual(self.c.delete("/api/entries/3").status_code, 404)

    def test_api_key_protects_writes_only(self):
        app = create_app({"DATABASE": os.path.join(self.tmp, "k.db"), "API_KEY": "secret", "TESTING": True})
        c = app.test_client()
        body = {"date": "2026-07-01", "txn_type": "T01", "lines": [L(1010, 5), L(3010, cr=5)]}
        self.assertEqual(c.post("/api/entries", json=body).status_code, 401)
        self.assertEqual(c.post("/api/entries", json=body, headers={"X-API-Key": "secret"}).status_code, 201)
        self.assertEqual(c.get("/api/entries").status_code, 200)

    def test_feed_matches_journal_layout(self):
        self.load_lecture()
        lines = self.c.get("/journal.csv").get_data(as_text=True).strip().splitlines()
        self.assertEqual(lines[0], "EntryID,Date,TxnType,AccountID,Debit,Credit,Faculty,Description")
        self.assertEqual(len(lines) - 1, 15)
        self.assertEqual(len(self.c.get("/api/journal").get_json()), 15)

    def test_tax_rounding_matches_excel_round(self):
        # 22.5% of 128,574,500 is exactly 28,929,262.5: Excel ROUND gives ...263, Python round() gives ...262.
        import datetime as dt
        lines = [{"date": "2026-07-01", "account_id": 1010, "debit": 128574500, "credit": 0},
                 {"date": "2026-07-01", "account_id": 4010, "debit": 0, "credit": 128574500}]
        s = core.tax_suggestion(lines, dt.date(2026, 7, 1), 1, 0.225)
        self.assertEqual(s["tax_required_ytd"], 28929263)
        self.assertEqual(core.round_half_up(0.5), 1)
        self.assertEqual(core.round_half_up(2.5), 3)
        self.assertEqual(core.round_half_up(2.4999), 2)

    def test_reference_endpoints(self):
        self.assertEqual(len(self.c.get("/api/accounts").get_json()), 31)
        self.assertEqual(len(self.c.get("/api/templates").get_json()), 30)
        self.assertEqual(self.c.get("/api/summary?through=2028-01").status_code, 422)


if __name__ == "__main__":
    unittest.main(verbosity=2)
