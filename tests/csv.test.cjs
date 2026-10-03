'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const CSV = require('../bank-import.js');
test('French CSV, quoted separator/newline, BOM and CRLF', () => {
  const parsed = CSV.parseCSV('\ufeffDate;Libellé;Montant\r\n01/10/2026;"Courses; au marché";-12,34\r\n02/10/2026;"Virement\nreçu";1200,50');
  assert.equal(parsed.records.length, 2);
  const result = CSV.convertRows(parsed, CSV.guessMapping(parsed.headers));
  assert.deepEqual(result.rows.map(r => r.amount), [-12.34, 1200.5]);
  assert.equal(result.rows[0].date, '2026-10-01');
  assert.equal(result.rows[1].isSalary, false);
});
test('debit/credit mapping; invalid dates and double-entry rejected', () => {
  const parsed = CSV.parseCSV('Date,Description,Debit,Credit\n2026-10-01,Test,30,\n2026-10-02,Pay,,100\n31/02/2026,Invalid,10,\n2026-10-03,Both,20,10');
  const result = CSV.convertRows(parsed, CSV.guessMapping(parsed.headers));
  assert.deepEqual(result.rows.map(r => r.amount), [-30, 100]);
  assert.equal(result.errors.length, 2);
});
test('locale amounts, malformed CSV and size limits', () => {
  assert.equal(CSV.parseAmount('1 234,56 €'), 1234.56);
  assert.equal(CSV.parseAmount('1,234.56'), 1234.56);
  assert.equal(CSV.parseAmount('(12,30)'), -12.3);
  assert.equal(CSV.parseAmount('12-'), -12);
  assert.equal(CSV.parseAmount('1.2.3'), null);
  assert.equal(CSV.parseAmount('1e9'), null);
  assert.equal(CSV.parseDate('29/02/2024'), '2024-02-29');
  assert.equal(CSV.parseDate('29/02/2025'), null);
  assert.throws(() => CSV.parseCSV('Date;Label\n"oops;test'));
  assert.throws(() => CSV.parseCSV('x'.repeat(CSV.MAX_BYTES + 1)));
});
