#!/usr/bin/env node
/**
 * Wayback CDX has no archived DeepState /api/history/last JSON before 2022-05-10.
 * For weekly anchors from 2022-02-21 through 2022-05-02, the build uses slack-based
 * selection of that earliest capture. If a run fails transiently, this script rehydrates
 * anchors from a saved .raw.json (default: same geometry as 2022-05-10 snapshot).
 *
 * Usage:
 *   node seed-early-2022-weekly-from-earliest-wayback-raw.js
 *   RAW_JSON=./data/raw-history/weekly/2022-03-07.raw.json DATES=2022-02-21,2022-02-28 node ...
 */

import fs from 'fs';
import path from 'path';
import { processData } from './daily-extract-v2.js';

const WEEKLY_DIR = './data/history/weekly';
const RAW =
  process.env.RAW_JSON || './data/raw-history/weekly/2022-03-07.raw.json';
const TS = process.env.WAYBACK_TS || '20220510044041';
const CAP = process.env.WAYBACK_CAPTURE_DATE || '2022-05-10';
const DATES = (process.env.DATES || '2022-02-21,2022-02-28')
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const NOTE =
  'No DeepState /api/history/last JSON in Wayback CDX before 2022-05-10; geometry is from the earliest archived capture (~10 May 2022). Feb–Apr weekly labels are chronologically approximate.';

function main() {
  const raw = JSON.parse(fs.readFileSync(path.resolve(RAW), 'utf8'));
  for (const date of DATES) {
    const n = processData(raw, date);
    n.granularity = 'weekly';
    n.snapshot_source = 'wayback';
    n.wayback_timestamp = TS;
    n.wayback_capture_date = CAP;
    n.wayback_earliest_in_archive_note = NOTE;
    const out = path.join(WEEKLY_DIR, `${date}.json`);
    fs.writeFileSync(out, JSON.stringify(n, null, 2));
    console.log(`Wrote ${out} (Russian total ${n.total_russian_controlled_km2} km²)`);
  }
}

main();
