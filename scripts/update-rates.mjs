// Updates rates.json with the last 12 months of the U.S. Treasury 10-year
// par yield, from the Treasury's official daily XML feed
// (home.treasury.gov, daily_treasury_yield_curve, the BC_10YEAR column).
// Only that feed is used. No packages: Node's own fetch.
//
// - First run (no rates.json, or one that doesn't reach back 12 months):
//   fetches every month of the last 12 months, plus the month before.
// - Later runs: fetches this month and last month, and merges them in
//   (a newer value for a date replaces the older one).
// - Keeps values dated within the last 12 months (366 days).
// - Writes `checkedAt` every run, so the scheduled run commits every day and
//   GitHub never switches the schedule off.
// - If the feed can't be read or looks wrong, it writes nothing and fails,
//   so the app keeps the last good file.
//
// Run: node scripts/update-rates.mjs [path to rates.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const FEED = 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';
export const SOURCE = 'U.S. Treasury, Daily Treasury Par Yield Curve Rates, 10-year (home.treasury.gov, daily_treasury_yield_curve)';
const KEEP_DAYS = 366;
const LEAST_VALUES = 150; // about 7 months of business days: less than that after a full refresh means something is wrong
const DAY = 86400e3;

/** The month as the feed names it, "202611". */
export function monthKey(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The months to fetch, oldest first, ending with this month. */
export function monthsBack(now, count) {
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) months.push(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return months;
}

/** Reads one month's XML: [[date, tenYear], ...]. Days with no 10-year value are skipped. */
export function parseFeed(xml) {
  const out = [];
  const blocks = xml.split('<m:properties>').slice(1);
  for (const block of blocks) {
    const date = /<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})T/.exec(block);
    const ten = /<d:BC_10YEAR[^>]*>([0-9.]+)<\/d:BC_10YEAR>/.exec(block);
    if (!date || !ten) continue;
    const value = Number(ten[1]);
    if (Number.isFinite(value) && value > 0 && value < 25) out.push([date[1], value]);
  }
  return out;
}

/** Merges new values into old ones (new wins), keeps the last 12 months, sorted by date. */
export function merge(old, fresh, now) {
  const byDate = new Map(old.map(([d, v]) => [d, v]));
  for (const [d, v] of fresh) byDate.set(d, v);
  const oldest = new Date(now.getTime() - KEEP_DAYS * DAY).toISOString().slice(0, 10);
  return [...byDate.entries()].filter(([d]) => d >= oldest).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** True if the old file already reaches back 12 months (within a couple of weeks). */
function reachesBack(values, now) {
  if (values.length === 0) return false;
  const wanted = new Date(now.getTime() - (KEEP_DAYS - 14) * DAY).toISOString().slice(0, 10);
  return values[0][0] <= wanted;
}

function readOld(path) {
  if (!existsSync(path)) return [];
  try {
    const file = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(file.tenYear) ? file.tenYear.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number') : [];
  } catch {
    return [];
  }
}

async function fetchMonth(month, fetchText) {
  const url = `${FEED}?data=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`;
  const text = await fetchText(url);
  if (!text.includes('DailyTreasuryYieldCurveRateData')) throw new Error(`The feed for ${month} doesn't look like the Treasury's yield curve`);
  return parseFeed(text);
}

export async function update(path, { now = new Date(), fetchText } = {}) {
  const old = readOld(path);
  const full = !reachesBack(old, now);
  const months = monthsBack(now, full ? 14 : 2);
  const fresh = [];
  for (const month of months) fresh.push(...(await fetchMonth(month, fetchText)));
  const tenYear = merge(full ? [] : old, fresh, now);
  if (tenYear.length < LEAST_VALUES) throw new Error(`Only ${tenYear.length} values: not writing rates.json`);
  const file = { version: 1, source: SOURCE, checkedAt: now.toISOString().slice(0, 19) + 'Z', tenYear };
  writeFileSync(path, JSON.stringify(file, null, 0).replace(/\],\[/g, '],\n[') + '\n');
  return file;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: 'application/xml' } });
  if (!response.ok) throw new Error(`The feed answered ${response.status} for ${url}`);
  return response.text();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2] ?? 'rates.json';
  update(path, { fetchText }).then(
    (file) => console.log(`rates.json: ${file.tenYear.length} values, latest ${file.tenYear.at(-1).join(' ')}`),
    (error) => {
      console.error(String(error));
      process.exit(1);
    },
  );
}
