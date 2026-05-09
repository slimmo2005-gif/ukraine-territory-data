#!/usr/bin/env node
/**
 * Daily Ukraine Territory Data Extraction - V2
 * Fetches DeepStateMap data, calculates territory control by oblast,
 * and outputs JSON matching the React frontend schema.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as turf from '@turf/turf';
import {
  applyPlausibilityCorrections,
  enforceOccupiedEnclaveCompletion,
  normalizeOblastRow,
  validateDailyData,
  recalculateTopLevelTotals,
  round2
} from './territory-validation.js';

const OBLASTS = {
  'donetsk': { name: 'Donetsk Oblast', totalArea: 26517.0 },
  'luhansk': { name: 'Luhansk Oblast', totalArea: 26684.0 },
  'kharkiv': { name: 'Kharkiv Oblast', totalArea: 31415.0 },
  'zaporizhzhia': { name: 'Zaporizhzhia Oblast', totalArea: 27180.0 },
  'kherson': { name: 'Kherson Oblast', totalArea: 28461.0 },
  'sumy': { name: 'Sumy Oblast', totalArea: 23834.0 },
  'mykolaiv': { name: 'Mykolaiv Oblast', totalArea: 24598.0 },
  'crimea': { name: 'Republic of Crimea', totalArea: 27000.0 },
  'sevastopol': { name: 'Sevastopol', totalArea: 864.0 },
  'dnipro': { name: 'Dnipro Oblast', totalArea: 31923.0 },
  'kyiv': { name: 'Kyiv Oblast', totalArea: 28131.0 },
  'odesa': { name: 'Odesa Oblast', totalArea: 33310.0 },
  'lviv': { name: 'Lviv Oblast', totalArea: 21833.0 },
  'vinnytsia': { name: 'Vinnytsia Oblast', totalArea: 26513.0 },
  'poltava': { name: 'Poltava Oblast', totalArea: 28748.0 },
  'cherkasy': { name: 'Cherkasy Oblast', totalArea: 20900.0 },
  'zhytomyr': { name: 'Zhytomyr Oblast', totalArea: 29832.0 },
  'rivne': { name: 'Rivne Oblast', totalArea: 20047.0 },
  'ivano-frankivsk': { name: 'Ivano-Frankivsk Oblast', totalArea: 13928.0 },
  'ternopil': { name: 'Ternopil Oblast', totalArea: 13823.0 },
  'khmelnytskyi': { name: 'Khmelnytskyi Oblast', totalArea: 20645.0 },
  'volyn': { name: 'Volyn Oblast', totalArea: 20144.0 },
  'zakarpattia': { name: 'Zakarpattia Oblast', totalArea: 12877.0 },
  'chernivtsi': { name: 'Chernivtsi Oblast', totalArea: 8097.0 },
  'kirovohrad': { name: 'Kirovohrad Oblast', totalArea: 24588.0 },
  'chernihiv': { name: 'Chernihiv Oblast', totalArea: 31865.0 }
};

const DATA_DIR = 'data';
const HISTORY_DIR = 'data/history';
const OBLAST_BOUNDARIES_FILE = 'data/ukraine_oblast_boundaries.geojson';

const OBLAST_ISO = {
  donetsk: 'UA-14',
  luhansk: 'UA-09',
  kharkiv: 'UA-63',
  zaporizhzhia: 'UA-23',
  kherson: 'UA-65',
  sumy: 'UA-59',
  mykolaiv: 'UA-48',
  crimea: 'UA-43',
  sevastopol: 'UA-40',
  dnipro: 'UA-12',
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

let cachedBoundaries = null;

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

function loadOblastBoundaries() {
  if (cachedBoundaries) return cachedBoundaries;
  if (!fs.existsSync(OBLAST_BOUNDARIES_FILE)) {
    throw new Error(`Missing boundary file: ${OBLAST_BOUNDARIES_FILE}`);
  }
  const geo = JSON.parse(fs.readFileSync(OBLAST_BOUNDARIES_FILE, 'utf8'));
  const byIso = new Map((geo.features || []).map((f) => [f.properties?.iso_3166_2, f]));
  const mapped = {};
  for (const [oblastKey, iso] of Object.entries(OBLAST_ISO)) {
    const feature = byIso.get(iso);
    if (feature) mapped[oblastKey] = feature;
  }
  cachedBoundaries = mapped;
  return mapped;
}

async function fetchDeepStateData() {
  console.log('Fetching DeepStateMap data...');
  
  try {
    const response = await fetch('https://deepstatemap.live/api/history/last', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    const featureCount = data?.map?.features?.length || data?.features?.length || 0;
    console.log(`✓ Fetched data with ${featureCount} features`);
    console.log(`  Data keys: ${Object.keys(data).join(', ')}`);
    if (data.map) {
      console.log(`  Map keys: ${Object.keys(data.map).join(', ')}`);
    }
    return data;
  } catch (error) {
    console.error('Error fetching data:', error.message);
    throw error;
  }
}

function calculatePolygonArea(coords) {
  if (!coords || !Array.isArray(coords) || coords.length < 3) return 0;
  
  // Ensure coords is array of [lon, lat] pairs, not flat array
  if (typeof coords[0] === 'number') {
    // Flat array - need to pair them up
    const paired = [];
    for (let i = 0; i < coords.length; i += 2) {
      if (i + 1 < coords.length) {
        paired.push([coords[i], coords[i + 1]]);
      }
    }
    coords = paired;
  }
  
  if (coords.length < 3) return 0;
  
  // Simple planar area calculation (approximate for small areas)
  let area = 0;
  const R = 6371; // Earth radius in km
  
  for (let i = 0; i < coords.length - 1; i++) {
    const point1 = coords[i];
    const point2 = coords[i + 1];
    
    if (!Array.isArray(point1) || !Array.isArray(point2)) continue;
    
    const [lon1, lat1] = point1;
    const [lon2, lat2] = point2;
    
    // Convert to radians
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const lon1Rad = lon1 * Math.PI / 180;
    const lon2Rad = lon2 * Math.PI / 180;
    
    // Spherical excess approximation
    area += (lon2Rad - lon1Rad) * (Math.sin(lat2Rad) + Math.sin(lat1Rad)) / 2;
  }
  
  return Math.abs(area * R * R);
}

function getPolygonCenter(coords) {
  if (!coords || !Array.isArray(coords) || coords.length === 0) return null;
  
  // Ensure coords is array of [lon, lat] pairs
  if (typeof coords[0] === 'number') {
    const paired = [];
    for (let i = 0; i < coords.length; i += 2) {
      if (i + 1 < coords.length) {
        paired.push([coords[i], coords[i + 1]]);
      }
    }
    coords = paired;
  }
  
  if (coords.length === 0) return null;
  
  let sumLat = 0, sumLon = 0;
  let validPoints = 0;
  
  coords.forEach(point => {
    if (Array.isArray(point) && point.length >= 2) {
      sumLon += point[0];
      sumLat += point[1];
      validPoints++;
    }
  });
  
  if (validPoints === 0) return null;
  
  return {
    lat: sumLat / validPoints,
    lon: sumLon / validPoints
  };
}

function determineOblast(center) {
  if (!center) return null;
  
  // Simple centroid matching - oblast capitals approximate
  const oblastCenters = {
    'donetsk': { lat: 48.0, lon: 37.8 },
    'luhansk': { lat: 48.9, lon: 39.3 },
    'kharkiv': { lat: 50.0, lon: 36.2 },
    'zaporizhzhia': { lat: 47.8, lon: 35.1 },
    'kherson': { lat: 46.6, lon: 32.6 },
    'sumy': { lat: 50.9, lon: 34.8 },
    'mykolaiv': { lat: 46.9, lon: 32.0 },
    'crimea': { lat: 45.3, lon: 34.4 },
    'sevastopol': { lat: 44.6, lon: 33.5 },
    'dnipro': { lat: 48.5, lon: 35.0 },
    'kyiv': { lat: 50.4, lon: 30.5 },
    'odesa': { lat: 46.5, lon: 30.7 },
    'lviv': { lat: 49.8, lon: 24.0 },
    'vinnytsia': { lat: 49.2, lon: 28.5 },
    'poltava': { lat: 49.6, lon: 34.5 },
    'cherkasy': { lat: 49.4, lon: 32.0 },
    'zhytomyr': { lat: 50.3, lon: 28.7 },
    'rivne': { lat: 50.6, lon: 26.2 },
    'ivano-frankivsk': { lat: 48.9, lon: 24.7 },
    'ternopil': { lat: 49.6, lon: 25.6 },
    'khmelnytskyi': { lat: 49.4, lon: 27.0 },
    'volyn': { lat: 50.7, lon: 25.3 },
    'zakarpattia': { lat: 48.6, lon: 22.3 },
    'chernivtsi': { lat: 48.3, lon: 25.9 },
    'kirovohrad': { lat: 48.5, lon: 32.3 },
    'chernihiv': { lat: 51.5, lon: 31.3 }
  };
  
  let closest = null;
  let minDist = Infinity;
  
  for (const [key, oblastCenter] of Object.entries(oblastCenters)) {
    const dist = Math.sqrt(
      Math.pow(center.lat - oblastCenter.lat, 2) + 
      Math.pow(center.lon - oblastCenter.lon, 2)
    );
    
    if (dist < minDist) {
      minDist = dist;
      closest = key;
    }
  }

  // Do not force-assign distant polygons to random oblasts.
  // This removes a lot of spillover from non-oblast map layers.
  if (minDist > 3.0) {
    return null;
  }
  
  return closest;
}

function isLikelyInUkraine(center) {
  if (!center) return false;
  // Broad bounding box including Crimea and frontline waters.
  return center.lat >= 44.0 && center.lat <= 53.5 && center.lon >= 22.0 && center.lon <= 41.5;
}

function parseControlStatus(feature) {
  // Get properties from feature
  const props = feature.properties || feature;
  const name = props.name || props.description || '';
  const styleUrl = props.styleUrl || props.style || '';
  const normalizedName = name.toLowerCase();
  const normalizedStyle = styleUrl.toLowerCase();
  const isTerritoryOverlay = normalizedName.includes('geojson.territories.');
  
  const hasUnknown = normalizedName.includes('невідом') || normalizedName.includes('unknown');
  const hasOccupied = normalizedName.includes('окупован') || normalizedName.includes('occupied');
  const hasOrdlo = normalizedName.includes('ордло') || normalizedName.includes('ordlo') || normalizedName.includes('territories.ordlo');
  const hasCrimeaOverlay = normalizedName.includes('territories.crimea');
  const hasLiberated = normalizedName.includes('звільн') || normalizedName.includes('liberat');
  const hasIncursion = normalizedName.includes('проникнен') || normalizedName.includes('incursion');
  const hasDisputedColor = normalizedStyle.includes('bcaaa4') || normalizedStyle.includes('ffff00') || normalizedStyle.includes('yellow');
  const hasRussianColor = normalizedStyle.includes('a52714') || normalizedStyle.includes('ff5252') || normalizedStyle.includes('ff0000') || normalizedStyle.includes('880e4f');
  const hasUkrainianColor = normalizedStyle.includes('0f9d58') || normalizedStyle.includes('00ff00');
  
  // Ignore non-Ukraine geopolitical overlays (e.g., Transnistria) so they do not
  // pollute oblast control metrics. Keep Crimea/ORDLO overlays as occupied context.
  if (isTerritoryOverlay && !hasCrimeaOverlay && !hasOrdlo) {
    return 'ignore';
  }

  // Parse status from bilingual labels first.
  if (hasLiberated) {
    return 'ukrainian';
  }
  if (hasOccupied || hasOrdlo) {
    return 'russian';
  }
  if (hasUnknown || hasDisputedColor || hasIncursion) {
    return 'disputed';
  }
  
  // Fallback: infer from style palette codes.
  if (hasUkrainianColor) return 'ukrainian';
  if (hasRussianColor) return 'russian';
  if (hasDisputedColor) return 'disputed';
  
  return 'unknown';
}

function processData(data, dateOverride = null) {
  const date = dateOverride || new Date().toISOString().split('T')[0];
  const oblastData = {};
  const boundaries = loadOblastBoundaries();
  
  // Initialize all oblasts
  for (const key of Object.keys(OBLASTS)) {
    oblastData[key] = {
      oblast: key,
      russian_controlled_km2: 0,
      ukrainian_controlled_km2: 0,
      disputed_controlled_km2: 0,
      total_area_km2: OBLASTS[key].totalArea,
      russian_change_km2: 0,
      ukrainian_change_km2: 0,
      disputed_change_km2: 0
    };
  }
  
  // Process items from DeepStateMap GeoJSON structure
  const items = data?.map?.features || data?.features || [];
  console.log(`Processing ${items.length} features from DeepStateMap...`);
  
  let totalPolygons = 0;
  
  for (const item of items) {
    const geometry = item.geometry || item;
    if (!geometry || !geometry.coordinates) continue;
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue;
    
    let feature;
    try {
      feature = turf.feature(geometry);
    } catch {
      continue;
    }
    const area = turf.area(feature) / 1_000_000;
    if (!Number.isFinite(area) || area <= 0) continue;

    // Handle different geometry types
    let coords = geometry.coordinates;
    if (geometry.type === 'Polygon') coords = coords[0];
    else if (geometry.type === 'MultiPolygon') coords = coords[0][0];

    const center = getPolygonCenter(coords);
    if (!isLikelyInUkraine(center)) continue;
    const status = parseControlStatus(item.properties || item);
    if (status === 'unknown' || status === 'ignore') continue;

    let allocated = 0;
    for (const [oblastKey, boundary] of Object.entries(boundaries)) {
      try {
        if (!turf.booleanIntersects(feature, boundary)) continue;
        const intersection = turf.intersect(turf.featureCollection([feature, boundary]));
        if (!intersection) continue;
        const intersectArea = turf.area(intersection) / 1_000_000;
        if (!Number.isFinite(intersectArea) || intersectArea <= 0) continue;
        oblastData[oblastKey][`${status}_controlled_km2`] += intersectArea;
        allocated += intersectArea;
      } catch {
        continue;
      }
    }

    if (allocated <= 0) {
      const fallbackOblast = determineOblast(center);
      if (fallbackOblast && oblastData[fallbackOblast]) {
        oblastData[fallbackOblast][`${status}_controlled_km2`] += area;
      }
    }
    totalPolygons++;
  }
  
  // Calculate totals
  let totalRussian = 0, totalUkrainian = 0, totalDisputed = 0, totalArea = 0;
  for (const oblast of Object.values(oblastData)) {
    normalizeOblastRow(oblast);
    const sum = oblast.russian_controlled_km2 + oblast.ukrainian_controlled_km2 + oblast.disputed_controlled_km2;
    if (sum > oblast.total_area_km2 && sum > 0) {
      const scale = oblast.total_area_km2 / sum;
      oblast.russian_controlled_km2 *= scale;
      oblast.ukrainian_controlled_km2 *= scale;
      oblast.disputed_controlled_km2 *= scale;
    }
    totalRussian += oblast.russian_controlled_km2;
    totalUkrainian += oblast.ukrainian_controlled_km2;
    totalDisputed += oblast.disputed_controlled_km2;
    totalArea += oblast.total_area_km2;
  }
  
  // Load previous day for change calculation
  const baseDate = new Date(`${date}T00:00:00Z`);
  baseDate.setUTCDate(baseDate.getUTCDate() - 1);
  const yesterdayDate = baseDate.toISOString().split('T')[0];
  const yesterdayFile = path.join(DATA_DIR, `${yesterdayDate}.json`);
  
  let russianChange = 0, ukrainianChange = 0, disputedChange = 0;
  
  if (fs.existsSync(yesterdayFile)) {
    try {
      const yesterdayData = JSON.parse(fs.readFileSync(yesterdayFile, 'utf8'));
      russianChange = totalRussian - (yesterdayData.total_russian_controlled_km2 || 0);
      ukrainianChange = totalUkrainian - (yesterdayData.total_ukrainian_controlled_km2 || 0);
      disputedChange = totalDisputed - (yesterdayData.total_disputed_km2 || 0);
      
      // Calculate per-oblast changes
      for (const key of Object.keys(OBLASTS)) {
        const yesterdayOblast = yesterdayData.oblasts?.find(o => o.oblast === key);
        if (yesterdayOblast) {
          oblastData[key].russian_change_km2 = oblastData[key].russian_controlled_km2 - yesterdayOblast.russian_controlled_km2;
          oblastData[key].ukrainian_change_km2 = oblastData[key].ukrainian_controlled_km2 - yesterdayOblast.ukrainian_controlled_km2;
          oblastData[key].disputed_change_km2 = oblastData[key].disputed_controlled_km2 - (yesterdayOblast.disputed_controlled_km2 || 0);
        }
      }
    } catch (e) {
      console.log('Could not load yesterday\'s data for comparison');
    }
  }
  
  // Build output
  const output = {
    date: date,
    source: 'deepstate',
    total_russian_controlled_km2: round2(totalRussian),
    total_ukrainian_controlled_km2: round2(totalUkrainian),
    total_disputed_km2: round2(totalDisputed),
    total_area_km2: round2(totalArea),
    russian_change_km2: round2(russianChange),
    ukrainian_change_km2: round2(ukrainianChange),
    disputed_change_km2: round2(disputedChange),
    oblasts: Object.values(oblastData),
    last_updated: new Date().toISOString()
  };

  const corrections = applyPlausibilityCorrections(output);
  enforceOccupiedEnclaveCompletion(output);
  recalculateTopLevelTotals(output);

  const previousDayData = fs.existsSync(yesterdayFile)
    ? JSON.parse(fs.readFileSync(yesterdayFile, 'utf8'))
    : null;
  const validation = validateDailyData(output, previousDayData);
  if (validation.hardFailures.length > 0) {
    const preview = validation.hardFailures.slice(0, 5);
    throw new Error(`Validation failed for ${date}: ${JSON.stringify(preview)}`);
  }
  if (validation.warnings.length > 0) {
    console.warn(`Validation warnings for ${date}: ${validation.warnings.length}`);
  }
  
  console.log(`\nProcessed ${totalPolygons} polygons across ${Object.keys(oblastData).length} oblasts`);
  console.log(`Russian: ${output.total_russian_controlled_km2.toFixed(2)} km²`);
  console.log(`Ukrainian: ${output.total_ukrainian_controlled_km2.toFixed(2)} km²`);
  console.log(`Disputed: ${output.total_disputed_km2.toFixed(2)} km²`);
  
  return output;
}

function saveData(data) {
  const date = data.date;
  const mainFile = path.join(DATA_DIR, `${date}.json`);
  const historyFile = path.join(HISTORY_DIR, `${date}.json`);
  
  // Save main file
  fs.writeFileSync(mainFile, JSON.stringify(data, null, 2));
  console.log(`✓ Saved: ${mainFile}`);
  
  // Save to history
  fs.writeFileSync(historyFile, JSON.stringify(data, null, 2));
  console.log(`✓ Saved: ${historyFile}`);
  
  return { mainFile, historyFile };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Ukraine Territory Daily Extractor - V2');
  console.log('='.repeat(60));
  console.log(`Run time: ${new Date().toISOString()}`);
  console.log('');
  
  try {
    const rawData = await fetchDeepStateData();
    const processedData = processData(rawData);
    const files = saveData(processedData);
    
    console.log('\n' + '='.repeat(60));
    console.log('✓ Daily extraction complete');
    console.log('='.repeat(60));
    
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Extraction failed:', error.message);
    process.exit(1);
  }
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile && path.resolve(thisFile) === invokedFile) {
  main();
}

export { fetchDeepStateData, processData, saveData, main };
