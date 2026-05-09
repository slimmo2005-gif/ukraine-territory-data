#!/usr/bin/env node
/**
 * Recompute russian_change_km2 / ukrainian_change_km2 / disputed_change_km2 from
 * consecutive files in data/ so charts show true day-over-day movement after backfills.
 * First date in range keeps changes at 0 if no prior file exists.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
const HISTORY_DIR = './data/history';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function generateDates(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
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

function main() {
  const startDate = process.env.START_DATE || '2026-04-01';
  const endDate = process.env.END_DATE || new Date().toISOString().slice(0, 10);
  const dates = generateDates(startDate, endDate);
  let prevPath = null;
  let updated = 0;
  const gaps = [];

  for (const date of dates) {
    const curPath = path.join(DATA_DIR, `${date}.json`);
    if (!fs.existsSync(curPath)) {
      gaps.push(date);
      prevPath = null;
      continue;
    }
    const cur = loadJson(curPath);
    if (prevPath && fs.existsSync(prevPath)) {
      const prev = loadJson(prevPath);
      applyDeltas(cur, prev);
      fs.writeFileSync(curPath, JSON.stringify(cur, null, 2));
      fs.writeFileSync(path.join(HISTORY_DIR, `${date}.json`), JSON.stringify(cur, null, 2));
      updated++;
    }
    prevPath = curPath;
  }

  console.log(`Recomputed deltas for ${updated} days (${startDate} .. ${endDate})`);
  if (gaps.length) console.warn(`Missing data files (breaks chain): ${gaps.join(', ')}`);
}

main();
