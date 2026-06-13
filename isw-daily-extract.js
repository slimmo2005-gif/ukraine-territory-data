#!/usr/bin/env node
/**
 * Daily ISW territory snapshot via public ArcGIS FeatureServer layers.
 * Writes data/isw/YYYY-MM-DD.json (+ duplicate under data/isw/history/).
 *
 * ISW map data is for private/research use unless you obtain approval from ISW
 * (maps@understandingwar.org) before public redistribution.
 *
 * Env:
 *   FORCE=1           overwrite today's file if it already exists
 *   ONLY_MISSING=1    skip when today's file exists
 *   DATE=YYYY-MM-DD   backdate output filename (still fetches live geometry)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as turf from '@turf/turf';

const ISW_ASSESSED_RUSSIAN_CONTROL =
  'https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/VIEW_RussiaCoTinUkraine_V3/FeatureServer/49/query';
const ISW_INFILTRATION =
  'https://services5.arcgis.com/SaBe5HMtmnbqSWlu/arcgis/rest/services/View_AssessedRussianInfiltrationAreasinUkraine_V4/FeatureServer/0/query';

const DATA_DIR = 'data/isw';
const HISTORY_DIR = 'data/isw/history';
const OBLAST_BOUNDARIES_FILE = 'data/ukraine_oblast_boundaries.geojson';

const OBLAST_ISO = {
  donetsk: 'UA-14',
  luhansk: 'UA-09',
  kharkiv: 'UA-63',
  zaporizhzhia: 'UA-23',
  kherson: 'UA-65',
  sumy: 'UA-59',
  mykolaiv: 'UA-48',
  crimea: ['UA-43', 'UA-40'],
  dnipropetrovsk: 'UA-12',
  kyiv: 'UA-32',
  odesa: 'UA-51',
  lviv: 'UA-46',
  vinnytsia: 'UA-05',
  poltava: 'UA-53',
  cherkasy: 'UA-71',
  zhytomyr: 'UA-18',
  rivne: 'UA-56',
  'ivano-frankivsk': 'UA-26',
  ternopil: 'UA-61',
  khmelnytskyi: 'UA-68',
  volyn: 'UA-07',
  zakarpattia: 'UA-21',
  chernivtsi: 'UA-77',
  kirovohrad: 'UA-35',
  chernihiv: 'UA-74'
};

function round2(x) {
  return Math.round(x * 100) / 100;
}

function todayUtcYmd() {
  return new Date().toISOString().slice(0, 10);
}

function previousDayYmd(dateYmd) {
  const d = new Date(`${dateYmd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function loadOblastBoundaries() {
  const geo = JSON.parse(fs.readFileSync(OBLAST_BOUNDARIES_FILE, 'utf8'));
  const byIso = new Map((geo.features || []).map((f) => [f.properties?.iso_3166_2, f]));
  const mapped = {};
  for (const [oblastKey, isoOrList] of Object.entries(OBLAST_ISO)) {
    const isoList = Array.isArray(isoOrList) ? isoOrList : [isoOrList];
    const features = isoList.map((iso) => byIso.get(iso)).filter(Boolean);
    if (features.length) mapped[oblastKey] = features;
  }
  return mapped;
}

async function fetchLayerGeoJSON(baseQueryUrl) {
  const pageSize = 2000;
  let offset = 0;
  const features = [];
  for (;;) {
    const u = new URL(baseQueryUrl);
    u.searchParams.set('f', 'geojson');
    u.searchParams.set('where', '1=1');
    u.searchParams.set('outSR', '4326');
    u.searchParams.set('outFields', '*');
    u.searchParams.set('returnGeometry', 'true');
    u.searchParams.set('resultRecordCount', String(pageSize));
    u.searchParams.set('resultOffset', String(offset));

    const r = await fetch(u.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ukraine-investigator/1.0)' }
    });
    if (!r.ok) throw new Error(`ISW query failed ${r.status}: ${u}`);

    const gj = await r.json();
    const batch = gj.features || [];
    features.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return turf.featureCollection(features);
}

function polygonFeatures(fc) {
  return (fc.features || []).filter(
    (f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
  );
}

function mergePolygons(fc) {
  const polys = polygonFeatures(fc);
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];
  return turf.union(turf.featureCollection(polys));
}

function areaKm2(feature) {
  if (!feature || !feature.geometry) return 0;
  return turf.area(feature) / 1e6;
}

function intersectOblastKm2(merged, boundaries) {
  const keys = Object.keys(OBLAST_ISO);
  const out = {};
  if (!merged || !merged.geometry) {
    for (const k of keys) out[k] = 0;
    return out;
  }
  for (const key of keys) {
    let sum = 0;
    for (const b of boundaries[key] || []) {
      try {
        const x = turf.intersect(turf.featureCollection([merged, b]));
        if (x) sum += turf.area(x) / 1e6;
      } catch {
        /* non-fatal geometry edge case */
      }
    }
    out[key] = round2(sum);
  }
  return out;
}

function mergeControlAndInfiltration(baseMerged, infMerged) {
  if (baseMerged?.geometry && infMerged?.geometry) {
    try {
      return turf.union(turf.featureCollection([baseMerged, infMerged]));
    } catch {
      return null;
    }
  }
  if (baseMerged?.geometry) return baseMerged;
  if (infMerged?.geometry) return infMerged;
  return null;
}

function readPreviousSnapshot(dateYmd) {
  const prevDate = previousDayYmd(dateYmd);
  const prevFile = path.join(DATA_DIR, `${prevDate}.json`);
  if (!fs.existsSync(prevFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(prevFile, 'utf8'));
  } catch {
    return null;
  }
}

export async function fetchIswLayers() {
  const [baseFc, infFc] = await Promise.all([
    fetchLayerGeoJSON(ISW_ASSESSED_RUSSIAN_CONTROL),
    fetchLayerGeoJSON(ISW_INFILTRATION)
  ]);
  return { baseFc, infFc };
}

export function buildIswSnapshot({ baseFc, infFc, dateYmd = todayUtcYmd(), fetchedAt = new Date().toISOString() }) {
  const boundaries = loadOblastBoundaries();
  const baseMerged = mergePolygons(baseFc);
  const infMerged = mergePolygons(infFc);
  const combinedMerged = mergeControlAndInfiltration(baseMerged, infMerged);

  const oblastBase = intersectOblastKm2(baseMerged, boundaries);
  const oblastCombined = intersectOblastKm2(combinedMerged, boundaries);
  const previous = readPreviousSnapshot(dateYmd);

  const oblastKeys = Object.keys(OBLAST_ISO);
  const oblasts = oblastKeys.map((k) => {
    const prevRow = previous?.oblasts?.find((o) => o.oblast === k);
    const assessed = oblastBase[k];
    const plusInf = oblastCombined[k];
    return {
      oblast: k,
      assessed_russian_control_km2: assessed,
      assessed_russian_plus_infiltration_km2: plusInf,
      assessed_russian_change_km2: prevRow
        ? round2(assessed - (prevRow.assessed_russian_control_km2 || 0))
        : null,
      assessed_russian_plus_infiltration_change_km2: prevRow
        ? round2(plusInf - (prevRow.assessed_russian_plus_infiltration_km2 || 0))
        : null
    };
  });

  const totalAssessed = round2(areaKm2(baseMerged));
  const totalInf = round2(areaKm2(infMerged));
  const totalCombined = round2(areaKm2(combinedMerged));

  return {
    date: dateYmd,
    source: 'isw',
    fetched_at: fetchedAt,
    license_note:
      'ISW map data via public ArcGIS FeatureServer. Contact maps@understandingwar.org before public redistribution.',
    layers: {
      assessed_russian_control: {
        title: 'Assessed Russian-controlled Ukrainian Territory',
        url: ISW_ASSESSED_RUSSIAN_CONTROL.replace(/\/query$/, ''),
        feature_count: baseFc.features?.length || 0
      },
      infiltration: {
        title: 'Assessed Russian Infiltration Areas in Ukraine',
        url: ISW_INFILTRATION.replace(/\/query$/, ''),
        feature_count: infFc.features?.length || 0
      }
    },
    total_assessed_russian_control_km2: totalAssessed,
    total_infiltration_areas_km2: totalInf,
    total_assessed_russian_plus_infiltration_km2: totalCombined,
    assessed_russian_change_km2: previous
      ? round2(totalAssessed - (previous.total_assessed_russian_control_km2 || 0))
      : null,
    assessed_russian_plus_infiltration_change_km2: previous
      ? round2(totalCombined - (previous.total_assessed_russian_plus_infiltration_km2 || 0))
      : null,
    oblasts: oblasts.sort((a, b) => b.assessed_russian_control_km2 - a.assessed_russian_control_km2)
  };
}

export function saveIswSnapshot(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

  const mainFile = path.join(DATA_DIR, `${data.date}.json`);
  const historyFile = path.join(HISTORY_DIR, `${data.date}.json`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  fs.writeFileSync(mainFile, payload);
  fs.writeFileSync(historyFile, payload);
  return { mainFile, historyFile };
}

export async function runIswDailyExtract(options = {}) {
  const dateYmd = options.dateYmd || process.env.DATE || todayUtcYmd();
  const mainFile = path.join(DATA_DIR, `${dateYmd}.json`);
  const force = options.force ?? process.env.FORCE === '1';
  const onlyMissing = options.onlyMissing ?? process.env.ONLY_MISSING === '1';

  if (onlyMissing && fs.existsSync(mainFile)) {
    return { skipped: true, reason: 'already exists', mainFile };
  }
  if (!force && fs.existsSync(mainFile)) {
    throw new Error(`${mainFile} already exists (set FORCE=1 to overwrite)`);
  }

  const layers = await fetchIswLayers();
  const snapshot = buildIswSnapshot({ ...layers, dateYmd });
  const files = saveIswSnapshot(snapshot);
  return { skipped: false, snapshot, ...files };
}

async function main() {
  console.log('='.repeat(60));
  console.log('ISW Daily Territory Extract');
  console.log('='.repeat(60));
  console.log(`Run time: ${new Date().toISOString()}\n`);

  try {
    const result = await runIswDailyExtract();
    if (result.skipped) {
      console.log(`Skipped: ${result.mainFile} (${result.reason})`);
      process.exit(0);
    }

    const { snapshot, mainFile, historyFile } = result;
    console.log(`Assessed Russian control: ${snapshot.total_assessed_russian_control_km2} km²`);
    console.log(`With infiltration:        ${snapshot.total_assessed_russian_plus_infiltration_km2} km²`);
    if (snapshot.assessed_russian_change_km2 != null) {
      console.log(`Day-over-day change:      ${snapshot.assessed_russian_change_km2} km²`);
    }
    console.log(`\n✓ Saved: ${mainFile}`);
    console.log(`✓ Saved: ${historyFile}`);
    console.log('\n' + '='.repeat(60));
    console.log('✓ ISW daily extraction complete');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (error) {
    console.error('\n✗ ISW extraction failed:', error.message);
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main();
}
