import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as core from '../src/core.js';

const FY = core.parseIsoDate('2026-07-01');

test('toCents removes floating point noise', () => {
  assert.equal(core.toCents(19.99), 1999);
  assert.equal(core.toCents(0.1 + 0.2), 30);
  assert.equal(core.toCents('1234.50'), 123450);
  assert.equal(core.toCents(''), 0);
  assert.equal(core.toCents(null), 0);
  assert.equal(core.toCents(-5), -500);
  assert.throws(() => core.toCents('abc'), TypeError);
});

test('toMoney never returns negative zero', () => {
  assert.ok(Object.is(core.toMoney(-0), 0));
  assert.equal(core.toMoney(1999), 19.99);
});

test('roundHalfUp matches Excel ROUND for halves', () => {
  assert.equal(core.roundHalfUp(0.5), 1);
  assert.equal(core.roundHalfUp(2.5), 3);
  assert.equal(core.roundHalfUp(2.4999), 2);
});

test('tax rounding matches Excel ROUND', () => {
  // 22.5% of 128,574,500 is exactly 28,929,262.5: Excel ROUND gives ...263, banker's rounding gives ...262.
  const lines = [
    { date: '2026-07-01', account_id: 1010, debit_cents: 12857450000, credit_cents: 0 },
    { date: '2026-07-01', account_id: 4010, debit_cents: 0, credit_cents: 12857450000 },
  ];
  const s = core.taxSuggestion(lines, FY, 1, 0.225);
  assert.equal(s.tax_required_ytd, 28929263);
});

test('parseMonth accepts YYYY-MM and fiscal month numbers', () => {
  assert.equal(core.parseMonth('2026-07', FY), 1);
  assert.equal(core.parseMonth('2027-06', FY), 12);
  assert.equal(core.parseMonth('7', FY), 7);
  assert.equal(core.parseMonth('', FY), 12);
  assert.equal(core.parseMonth(undefined, FY), 12);
  assert.equal(core.parseMonth('2028-01', FY), null);
  assert.equal(core.parseMonth('13', FY), null);
  assert.equal(core.parseMonth('nonsense', FY), null);
});

test('dates: real calendar dates only, month end handles leap years', () => {
  assert.equal(core.parseIsoDate('2027-02-29'), null);
  assert.equal(core.parseIsoDate('2026-13-01'), null);
  assert.equal(core.parseIsoDate('not a date'), null);
  assert.equal(core.monthEnd(FY, 1), '2026-07-31');
  assert.equal(core.monthEnd(FY, 8), '2027-02-28');
  assert.equal(core.monthEnd(FY, 12), '2027-06-30');
  assert.equal(core.monthEnd(core.parseIsoDate('2027-07-01'), 8), '2028-02-29');
});

test('chart of accounts and templates match the Python version counts', () => {
  assert.equal(core.ACCOUNTS.size, 31);
  assert.equal(core.TEMPLATES.size, 30);
});
