#!/usr/bin/env node
/**
 * Daily Ukraine Territory Data Extraction - V2
 * Fetches DeepStateMap data, calculates territory control by oblast,
 * and outputs JSON matching the React frontend schema.
 */

import fs from 'fs';
import path from 'path';

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

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

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
  
  return closest;
}

function parseControlStatus(feature) {
  // Get properties from feature
  const props = feature.properties || feature;
  const name = props.name || props.description || '';
  const styleUrl = props.styleUrl || props.style || '';
  
  // Debug: log what we're checking
  const hasUnknown = name.includes('невідомий') || name.includes('Unknown') || name.includes('unknown');
  const hasYellow = styleUrl.includes('FFFF00') || styleUrl.includes('yellow');
  
  // Parse status from name (Ukrainian/English bilingual)
  if (name.includes('Звільнено') || name.includes('Liberated')) {
    return 'ukrainian';
  }
  if (name.includes('окуповано') || name.includes('occupied')) {
    return 'russian';
  }
  if (hasUnknown || hasYellow || name.includes('проникнення')) {
    console.log(`  -> Detected DISPUTED: name="${name.substring(0,30)}..." style="${styleUrl.substring(0,20)}..."`);
    return 'disputed';
  }
  
  // Fallback: try to infer from style color
  if (styleUrl.includes('00FF00')) return 'ukrainian'; // Green
  if (styleUrl.includes('FF0000')) return 'russian'; // Red
  if (styleUrl.includes('FFFF00')) {
    console.log(`  -> Detected DISPUTED (color): style="${styleUrl}"`);
    return 'disputed';
  }
  
  // Default to ukrainian if unclear
  return 'ukrainian';
}

function processData(data) {
  const date = new Date().toISOString().split('T')[0];
  const oblastData = {};
  
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
  if (items.length === 0) {
    console.log('WARNING: No features found! Data structure:');
    console.log(JSON.stringify(data).substring(0, 200));
  }
  
  // Debug: check first few features for disputed/contested markers
  let disputedCount = 0;
  if (items.length > 0) {
    console.log('First feature properties:', Object.keys(items[0].properties || {}));
    console.log('First feature sample:', JSON.stringify(items[0].properties || {}).substring(0, 150));
  }
  for (let i = 0; i < Math.min(20, items.length); i++) {
    const props = items[i].properties || {};
    const name = props.name || props.description || '';
    const style = props.styleUrl || props.style || '';
    if (name.includes('невідомий') || name.includes('unknown') || name.includes('проникнення') || name.includes('окуповано') ||
        style.includes('FFFF00') || style.includes('yellow') || style.includes('red') || style.includes('FF0000')) {
      console.log(`Feature ${i}: name="${name}", style="${style}"`);
      disputedCount++;
    }
  }
  console.log(`Found ${disputedCount} potentially disputed/occupied features in sample`);
  
  let totalPolygons = 0;
  let debugDisputedCount = 0;
  
  for (const item of items) {
    const geometry = item.geometry || item;
    if (!geometry || !geometry.coordinates) continue;
    
    // Handle different geometry types
    let coords = geometry.coordinates;
    if (geometry.type === 'Polygon') {
      coords = coords[0]; // Outer ring
    } else if (geometry.type === 'MultiPolygon') {
      // Use first polygon for simplicity
      coords = coords[0][0];
    }
    
    const area = calculatePolygonArea(coords);
    const center = getPolygonCenter(coords);
    const oblast = determineOblast(center);
    const status = parseControlStatus(item.properties || item);
    
    // Debug: log disputed features
    if (status === 'disputed') {
      debugDisputedCount++;
      if (debugDisputedCount <= 5) {
        console.log(`Disputed feature ${debugDisputedCount}: oblast=${oblast}, area=${area.toFixed(2)}km²`);
      }
    }
    
    if (oblast && oblastData[oblast]) {
      oblastData[oblast][`${status}_controlled_km2`] += area;
      totalPolygons++;
    }
  }
  console.log(`Total disputed features processed: ${debugDisputedCount}`);
  
  // Debug: Check oblast disputed totals
  for (const [key, data] of Object.entries(oblastData)) {
    if (data.disputed_controlled_km2 > 0) {
      console.log(`Oblast ${key}: disputed = ${data.disputed_controlled_km2.toFixed(2)} km²`);
    }
  }
  
  // Calculate totals
  let totalRussian = 0, totalUkrainian = 0, totalDisputed = 0, totalArea = 0;
  for (const data of Object.values(oblastData)) {
    totalRussian += data.russian_controlled_km2;
    totalUkrainian += data.ukrainian_controlled_km2;
    totalDisputed += data.disputed_controlled_km2;
    totalArea += data.total_area_km2;
  }
  
  // Load previous day for change calculation
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayFile = path.join(DATA_DIR, `${yesterday.toISOString().split('T')[0]}.json`);
  
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
          oblastData[key].disputed_change_km2 = oblastData[key].disputed_km2 - yesterdayOblast.disputed_km2;
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
    total_russian_controlled_km2: Math.round(totalRussian * 100) / 100,
    total_ukrainian_controlled_km2: Math.round(totalUkrainian * 100) / 100,
    total_disputed_km2: Math.round(totalDisputed * 100) / 100,
    total_area_km2: Math.round(totalArea * 100) / 100,
    russian_change_km2: Math.round(russianChange * 100) / 100,
    ukrainian_change_km2: Math.round(ukrainianChange * 100) / 100,
    disputed_change_km2: Math.round(disputedChange * 100) / 100,
    oblasts: Object.values(oblastData),
    last_updated: new Date().toISOString()
  };
  
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

main();
