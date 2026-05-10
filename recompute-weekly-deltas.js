#!/usr/bin/env node
/**
 * Recompute *_change_km2 fields as week-over-week differences between consecutive
 * JSON files in data/history/weekly/ (sorted by date filename).
 * Can be run standalone: START_DATE=2026-01-01 END_DATE=2026-12-31 node recompute-weekly-deltas.js
 */

import fs from 'fs';
import path from 'path';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function applyDeltas(cur, prev) {
  cur.russian_change_km2 = round2(
    (cur.total_russian_controlled_km2 || 0) - (prev.total_russian_controlled_km2 || 0)
  );
  cur.ukrainian_change_km2 = round2(
    (cur.total_ukrainian_controlled_km2 || 0) - (prev.total_ukrainian_controlled_km2 || 0)
  );
  cur.disputed_change_km2 = round2((cur.total_disputed_km2 || 0) - (prev.total_disputed_km2 || 0));

  const prevBy = new Map((prev.oblasts || []).map((o) => [o.oblast, o]));
  for (const o of cur.oblasts || []) {
    const p = prevBy.get(o.oblast);
    if (!p) continue;
    o.russian_change_km2 = round2((o.russian_controlled_km2 || 0) - (p.russian_controlled_km2 || 0));
    o.ukrainian_change_km2 = round2(
      (o.ukrainian_controlled_km2 || 0) - (p.ukrainian_controlled_km2 || 0)
    );
    o.disputed_change_km2 = round2(
      (o.disputed_controlled_km2 || 0) - (p.disputed_controlled_km2 || 0)
    );
  }
  cur.last_updated = new Date().toISOString();
}

/**
 * Walk existing `YYYY-MM-DD.json` files sorted by date (not a theoretical +7 grid), so
 * week-over-week deltas stay correct when 2026 anchors (e.g. Jan 1) do not line up with
 * a chain that started on a different START_DATE (e.g. 2024-01-01).
 *
 * @param {string} weeklyDir
 * @param {string} startDate YYYY-MM-DD — only files with date >= this are updated (chain still uses prior file if present)
 * @param {string} endDate YYYY-MM-DD — only files with date <= this are updated
 * @returns {number} number of files updated
 */
export function recomputeWeeklyDeltasForDir(weeklyDir, startDate, endDate) {
  const allDates = fs
    .readdirSync(weeklyDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();

  let updated = 0;
  /** @type {object|null} */
  let prev = null;

  for (const date of allDates) {
    const curPath = path.join(weeklyDir, `${date}.json`);
    const cur = JSON.parse(fs.readFileSync(curPath, 'utf8'));
    if (prev && date >= startDate && date <= endDate) {
      applyDeltas(cur, prev);
      fs.writeFileSync(curPath, JSON.stringify(cur, null, 2));
      updated++;
    }
    prev = cur;
  }
  return updated;
}

function main() {
  const weeklyDir = path.resolve(process.env.WEEKLY_DIR || './data/history/weekly');
  const startDate = process.env.START_DATE || '2026-01-01';
  const endDate = process.env.END_DATE || new Date().toISOString().slice(0, 10);
  if (!fs.existsSync(weeklyDir)) {
    console.error('Missing directory:', weeklyDir);
    process.exit(1);
  }
  const n = recomputeWeeklyDeltasForDir(weeklyDir, startDate, endDate);
  console.log(`Updated week-over-week deltas for ${n} files under ${weeklyDir}`);
}

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && path.relative(__filename, entry) === '') {
  main();
}
