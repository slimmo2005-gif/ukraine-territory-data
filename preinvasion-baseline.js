/**
 * Approximate Ukrainian territory under Russian / Russian-proxy control immediately before
 * the 24 Feb 2022 full-scale invasion. Totals align with the widely cited CNN figure
 * (~42,000 km² on 22 Feb 2022) summarized in Wikipedia's "Territorial control during the
 * Russo-Ukrainian war" table (row: 22 February 2022 | 42,000 km² | CNN).
 *
 * Split: full Crimea (incl. Sevastopol) per project oblast config + remainder allocated to
 * Donetsk / Luhansk proxy-held areas (~Donbas line of contact pre-invasion).
 *
 * This is a schematic baseline when Wayback has no chronologically valid DeepState JSON
 * for a given pre-war weekly anchor.
 */

import { OBLASTS } from './daily-extract-v2.js';
import { recalculateTopLevelTotals, round2, CANONICAL_OBLASTS } from './territory-validation.js';

/** CNN total Russian-controlled km² (incl. Crimea + proxy Donbas), Feb 22 2022 */
export const PREINVASION_TOTAL_RUSSIAN_KM2 = 42000;

export const PREINVASION_SOURCE_NOTE =
  'Schematic baseline: Wikipedia summary citing CNN (~42,000 km² Russian-controlled UA territory on 22 Feb 2022). Crimea = full oblast polygon in this dataset; Donetsk/Luhansk = remainder (~separatist-held).';

function splitDonbasRemainder(crimeaArea) {
  const rem = Math.max(0, round2(PREINVASION_TOTAL_RUSSIAN_KM2 - crimeaArea));
  const dTot = OBLASTS.donetsk.totalArea;
  const lTot = OBLASTS.luhansk.totalArea;
  const wDon = dTot / (dTot + lTot);
  let d = round2(rem * wDon);
  let l = round2(rem - d);
  d = Math.min(d, dTot);
  l = Math.min(l, lTot);
  return { donetskRussian: d, luhanskRussian: l };
}

/**
 * @param {string} anchorDate YYYY-MM-DD (weekly anchor)
 * @returns {object} frontend-compatible territory JSON
 */
export function buildPreInvasionWeeklySnapshot(anchorDate) {
  const crimeaArea = OBLASTS.crimea.totalArea;
  const { donetskRussian, luhanskRussian } = splitDonbasRemainder(crimeaArea);

  const oblasts = CANONICAL_OBLASTS.map((key) => {
    const total = OBLASTS[key].totalArea;
    let r = 0;
    let d = 0;
    if (key === 'crimea') {
      r = crimeaArea;
    } else if (key === 'donetsk') {
      r = donetskRussian;
    } else if (key === 'luhansk') {
      r = luhanskRussian;
    }
    const u = round2(Math.max(0, total - r - d));
    return {
      oblast: key,
      russian_controlled_km2: round2(r),
      ukrainian_controlled_km2: u,
      disputed_controlled_km2: d,
      total_area_km2: total,
      russian_change_km2: 0,
      ukrainian_change_km2: 0,
      disputed_change_km2: 0
    };
  });

  let totalArea = 0;
  for (const row of oblasts) totalArea += row.total_area_km2;

  const data = {
    date: anchorDate,
    source: 'deepstate',
    total_russian_controlled_km2: 0,
    total_ukrainian_controlled_km2: 0,
    total_disputed_km2: 0,
    total_area_km2: round2(totalArea),
    russian_change_km2: 0,
    ukrainian_change_km2: 0,
    disputed_change_km2: 0,
    oblasts,
    last_updated: new Date().toISOString(),
    granularity: 'weekly',
    snapshot_source: 'preinvasion_baseline',
    preinvasion_baseline_note: PREINVASION_SOURCE_NOTE,
    preinvasion_baseline_total_russian_km2: PREINVASION_TOTAL_RUSSIAN_KM2
  };

  recalculateTopLevelTotals(data);
  return data;
}
