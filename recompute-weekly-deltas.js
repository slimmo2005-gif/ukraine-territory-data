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

function generateWeeklyAnchorsUTC(startDate, endDate) {
  const dates = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let d = new Date(`${startDate}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
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
 * @param {string} weeklyDir
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @returns {number} number of files updated
 */
export function recomputeWeeklyDeltasForDir(weeklyDir, startDate, endDate) {
  const anchors = generateWeeklyAnchorsUTC(startDate, endDate);
  let updated = 0;
  let prevPath = null;

  for (const date of anchors) {
    const curPath = path.join(weeklyDir, `${date}.json`);
    if (!fs.existsSync(curPath)) {
      prevPath = null;
      continue;
    }
    const cur = JSON.parse(fs.readFileSync(curPath, 'utf8'));
    if (prevPath && fs.existsSync(prevPath)) {
      const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
      applyDeltas(cur, prev);
      fs.writeFileSync(curPath, JSON.stringify(cur, null, 2));
      updated++;
    }
    prevPath = curPath;
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
