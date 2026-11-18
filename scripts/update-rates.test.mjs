// Tests for update-rates.mjs. Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { merge, monthsBack, parseFeed, update } from './update-rates.mjs';

const NOV = readFileSync(new URL('./fixtures/treasury-2026-11.xml', import.meta.url), 'utf8');
const NOW = new Date('2026-11-18T10:30:00Z');

/** A month of made-up feed text: one value on each weekday. */
function fakeMonth(month) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(4)) - 1;
  let xml = '<feed><title>DailyTreasuryYieldCurveRateData</title>';
  for (let d = 1; d <= 28; d += 1) {
    const date = new Date(Date.UTC(y, m, d));
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    xml += `<m:properties><d:NEW_DATE m:type="Edm.DateTime">${date.toISOString().slice(0, 10)}T00:00:00</d:NEW_DATE><d:BC_10YEAR m:type="Edm.Double">4.50</d:BC_10YEAR></m:properties>`;
  }
  return xml + '</feed>';
}

test('reads the real feed: dates and the 10-year column only', () => {
  const values = parseFeed(NOV);
  assert.ok(values.length >= 10);
  assert.deepEqual(values[0], ['2026-11-02', 4.91]);
});

test('skips a day with no 10-year value', () => {
  const xml = '<m:properties><d:NEW_DATE>2026-11-02T00:00:00</d:NEW_DATE><d:BC_10YEAR m:null="true" /></m:properties>';
  assert.deepEqual(parseFeed(xml), []);
});

test('fetches 14 months on the first run, oldest first', () => {
  const months = monthsBack(NOW, 14);
  assert.equal(months.length, 14);
  assert.equal(months[0], '202510');
  assert.equal(months.at(-1), '202611');
});

test('merges: a newer value wins, older than 12 months goes, sorted', () => {
  const out = merge([['2025-11-01', 4], ['2026-11-02', 4.8]], [['2026-11-02', 4.91], ['2026-11-03', 4.95]], NOW);
  assert.deepEqual(out, [['2026-11-02', 4.91], ['2026-11-03', 4.95]]);
});

test('writes rates.json with its source and check time, then only fetches 2 months', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rates-'));
  const path = join(dir, 'rates.json');
  const asked = [];
  const fetchText = async (url) => {
    const month = /month=(\d{6})/.exec(url)[1];
    asked.push(month);
    return fakeMonth(month);
  };
  const file = await update(path, { now: NOW, fetchText });
  assert.equal(asked.length, 14);
  assert.equal(file.version, 1);
  assert.match(file.source, /Treasury/);
  assert.equal(file.checkedAt, '2026-11-18T10:30:00Z');
  assert.ok(file.tenYear.length >= 200);
  asked.length = 0;
  await update(path, { now: new Date('2026-11-19T10:30:00Z'), fetchText });
  assert.deepEqual(asked, ['202610', '202611']);
});

test('writes nothing when the feed looks wrong', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rates-'));
  const path = join(dir, 'rates.json');
  await assert.rejects(update(path, { now: NOW, fetchText: async () => '<html>Oops</html>' }));
  assert.equal(existsSync(path), false);
});

test('writes nothing when too few values come back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rates-'));
  const path = join(dir, 'rates.json');
  writeFileSync(path, '{"keep":"me"}');
  await assert.rejects(update(path, { now: NOW, fetchText: async () => '<title>DailyTreasuryYieldCurveRateData</title>' }));
  assert.equal(readFileSync(path, 'utf8'), '{"keep":"me"}');
});
