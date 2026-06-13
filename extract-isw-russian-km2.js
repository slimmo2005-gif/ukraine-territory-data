#!/usr/bin/env node
/**
 * Compare latest ISW km² snapshot to a DeepState daily extract.
 * For daily ISW ingestion use: npm run isw-daily-extract
 */

import fs from 'fs';
import path from 'path';
import { buildIswSnapshot, fetchIswLayers } from './isw-daily-extract.js';

function findLatestDaily() {
  const dataDir = 'data';
  const files = fs.readdirSync(dataDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));
  if (!files.length) throw new Error(`No daily files in ${dataDir}`);
  files.sort();
  return path.join(dataDir, files[files.length - 1]);
}

async function main() {
  const dailyPath = process.env.DAILY_JSON || findLatestDaily();
  const deep = JSON.parse(fs.readFileSync(dailyPath, 'utf8'));
  const layers = await fetchIswLayers();
  const isw = buildIswSnapshot(layers);

  const byOblast = isw.oblasts.map((row) => {
    const dsRow = (deep.oblasts || []).find((o) => o.oblast === row.oblast) || {};
    return {
      oblast: row.oblast,
      deepstate_russian_controlled_km2: Math.round((dsRow.russian_controlled_km2 || 0) * 100) / 100,
      isw_assessed_russian_control_km2: row.assessed_russian_control_km2,
      isw_assessed_russian_plus_infiltration_km2: row.assessed_russian_plus_infiltration_km2
    };
  });

  const out = {
    fetchedAt: isw.fetched_at,
    deepstateFile: dailyPath.replace(/\\/g, '/'),
    deepstateDate: deep.date,
    totals: {
      deepstate_russian_controlled_km2: deep.total_russian_controlled_km2,
      isw_assessed_russian_control_km2: isw.total_assessed_russian_control_km2,
      isw_infiltration_areas_only_km2: isw.total_infiltration_areas_km2,
      isw_assessed_russian_plus_infiltration_km2: isw.total_assessed_russian_plus_infiltration_km2
    },
    byOblast
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
