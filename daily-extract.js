/**
 * Daily Ukraine Territory Extraction Script
 * Fetches current control data and breaks down by oblast
 * Outputs JSON file for downstream processing
 */

import fs from 'fs';
import path from 'path';

// Configuration
const CONFIG = {
  apiUrl: 'https://deepstatemap.live/api/history/last',
  outputDir: './daily_output',
  oblastBoundariesFile: './ukraine_oblasts.geojson', // You'll need to download this
  backupDir: './snapshots' // Keep raw data for history
};

// Ukraine oblasts with approximate centers for nearest-neighbor assignment
// Replace with actual GeoJSON boundaries for spatial intersection
const UKRAINE_OBLASTS = [
  { name: 'Cherkasy', code: 'UA-71', center: [32.0, 49.4] },
  { name: 'Chernihiv', code: 'UA-74', center: [31.3, 51.5] },
  { name: 'Chernivtsi', code: 'UA-77', center: [25.9, 48.3] },
  { name: 'Dnipropetrovsk', code: 'UA-12', center: [35.0, 48.5] },
  { name: 'Donetsk', code: 'UA-14', center: [37.8, 48.0] },
  { name: 'Ivano-Frankivsk', code: 'UA-26', center: [24.7, 48.9] },
  { name: 'Kharkiv', code: 'UA-63', center: [36.2, 49.9] },
  { name: 'Kherson', code: 'UA-65', center: [33.3, 46.6] },
  { name: 'Khmelnytskyi', code: 'UA-68', center: [27.0, 49.4] },
  { name: 'Kyiv', code: 'UA-32', center: [30.5, 50.4] },
  { name: 'Kirovohrad', code: 'UA-35', center: [32.3, 48.5] },
  { name: 'Luhansk', code: 'UA-09', center: [39.3, 48.9] },
  { name: 'Lviv', code: 'UA-46', center: [24.0, 49.8] },
  { name: 'Mykolaiv', code: 'UA-48', center: [31.9, 47.0] },
  { name: 'Odesa', code: 'UA-51', center: [30.7, 46.5] },
  { name: 'Poltava', code: 'UA-53', center: [34.5, 49.6] },
  { name: 'Rivne', code: 'UA-56', center: [26.2, 50.6] },
  { name: 'Sumy', code: 'UA-59', center: [34.8, 50.9] },
  { name: 'Ternopil', code: 'UA-61', center: [25.6, 49.6] },
  { name: 'Vinnytsia', code: 'UA-05', center: [28.5, 49.2] },
  { name: 'Volyn', code: 'UA-07', center: [25.1, 50.7] },
  { name: 'Zakarpattia', code: 'UA-21', center: [22.3, 48.6] },
  { name: 'Zaporizhzhia', code: 'UA-23', center: [35.2, 47.8] },
  { name: 'Zhytomyr', code: 'UA-18', center: [28.7, 50.3] },
  { name: 'Crimea', code: 'UA-43', center: [34.4, 45.3] },
  { name: 'Sevastopol', code: 'UA-40', center: [33.5, 44.6] }
];

// Ensure directories exist
[CONFIG.outputDir, CONFIG.backupDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function parseControlStatus(properties) {
  const name = properties.name || '';
  const styleUrl = properties.styleUrl || '';
  
  // Parse status from name (Ukrainian/English bilingual)
  if (name.includes('Звільнено') || name.includes('Liberated')) {
    return 'ukrainian';
  }
  if (name.includes('окуповано') || name.includes('occupied')) {
    if (name.includes('до') || name.includes('to') || name.includes('before')) {
      return 'russian_pre2022';
    }
    return 'russian';
  }
  if (name.includes('невідомий') || name.includes('unknown') || name.includes('проникнення')) {
    return 'contested';
  }
  if (name.includes('Звільнено')) return 'ukrainian';
  
  // Fallback: try to infer from style color
  if (styleUrl.includes('00FF00')) return 'ukrainian'; // Green
  if (styleUrl.includes('FF0000')) return 'russian'; // Red
  if (styleUrl.includes('FFFF00')) return 'liberated'; // Yellow
  
  return 'unknown';
}

function getPolygonCentroid(coordinates) {
  const ring = coordinates[0]; // Outer ring
  let x = 0, y = 0;
  
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  
  return [x / ring.length, y / ring.length];
}

function calculatePolygonArea(coordinates) {
  // Shoelace formula for planar approximation
  // Note: This is approximate. For accurate geodetic area, use Turf.js
  let area = 0;
  const ring = coordinates[0];
  
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    area += (lon1 * lat2 - lon2 * lat1);
  }
  
  // Convert to approximate km² (rough conversion at Ukraine's latitude ~49°N)
  const kmPerDegreeLat = 111;
  const kmPerDegreeLon = 111 * Math.cos(49 * Math.PI / 180);
  
  return Math.abs(area) / 2 * kmPerDegreeLat * kmPerDegreeLon;
}

function assignToOblast(feature) {
  if (!feature.geometry || feature.geometry.type !== 'Polygon') {
    return null;
  }
  
  const centroid = getPolygonCentroid(feature.geometry.coordinates);
  
  // Find nearest oblast center
  let nearestOblast = null;
  let minDistance = Infinity;
  
  for (const oblast of UKRAINE_OBLASTS) {
    const dx = centroid[0] - oblast.center[0]; // Longitude difference
    const dy = centroid[1] - oblast.center[1]; // Latitude difference
    
    // Approximate distance (in degrees)
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestOblast = oblast;
    }
  }
  
  // Only assign if within reasonable distance (3 degrees ~ 300km)
  if (minDistance > 3.0) {
    return null;
  }
  
  return nearestOblast;
}

async function fetchTerritoryData() {
  console.log('Fetching territory data from DeepStateMap...');
  
  try {
    const response = await fetch(CONFIG.apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch data:', error.message);
    throw error;
  }
}

function processByOblast(rawData) {
  const snapshotId = rawData.id;
  const features = rawData.map.features;
  const extractionDate = new Date().toISOString();
  
  // Initialize stats for all oblasts
  const oblastStats = {};
  UKRAINE_OBLASTS.forEach(oblast => {
    oblastStats[oblast.name] = {
      code: oblast.code,
      center: oblast.center,
      ukrainian_km2: 0,
      russian_km2: 0,
      russian_pre2022_km2: 0,
      contested_km2: 0,
      unknown_km2: 0,
      total_polygons: 0
    };
  });
  
  // Process each feature
  let processedCount = 0;
  let skippedCount = 0;
  
  for (const feature of features) {
    if (feature.geometry.type !== 'Polygon') {
      skippedCount++;
      continue;
    }
    
    const oblast = assignToOblast(feature);
    if (!oblast) {
      skippedCount++;
      continue;
    }
    
    const status = parseControlStatus(feature.properties);
    const area = calculatePolygonArea(feature.geometry.coordinates);
    
    oblastStats[oblast.name][`${status}_km2`] += area;
    oblastStats[oblast.name].total_polygons++;
    processedCount++;
  }
  
  // Calculate totals per oblast and overall
  let grandTotal = {
    ukrainian_km2: 0,
    russian_km2: 0,
    russian_pre2022_km2: 0,
    contested_km2: 0,
    unknown_km2: 0,
    total_area_km2: 0
  };
  
  const activeOblasts = {};
  
  for (const [oblastName, stats] of Object.entries(oblastStats)) {
    const oblastTotal = 
      stats.ukrainian_km2 + 
      stats.russian_km2 + 
      stats.russian_pre2022_km2 + 
      stats.contested_km2 + 
      stats.unknown_km2;
    
    if (oblastTotal > 0) {
      stats.total_area_km2 = oblastTotal;
      stats.ukrainian_percent = (stats.ukrainian_km2 / oblastTotal * 100).toFixed(2);
      stats.russian_percent = (stats.russian_km2 / oblastTotal * 100).toFixed(2);
      stats.contested_percent = (stats.contested_km2 / oblastTotal * 100).toFixed(2);
      
      activeOblasts[oblastName] = stats;
      
      // Add to grand totals
      grandTotal.ukrainian_km2 += stats.ukrainian_km2;
      grandTotal.russian_km2 += stats.russian_km2;
      grandTotal.russian_pre2022_km2 += stats.russian_pre2022_km2;
      grandTotal.contested_km2 += stats.contested_km2;
      grandTotal.unknown_km2 += stats.unknown_km2;
    }
  }
  
  grandTotal.total_area_km2 = 
    grandTotal.ukrainian_km2 + 
    grandTotal.russian_km2 + 
    grandTotal.russian_pre2022_km2 + 
    grandTotal.contested_km2 + 
    grandTotal.unknown_km2;
  
  return {
    metadata: {
      snapshot_id: snapshotId,
      extraction_date: extractionDate,
      data_date: new Date(snapshotId * 1000).toISOString(),
      source: 'deepstatemap.live',
      version: '1.0',
      processed_polygons: processedCount,
      skipped_features: skippedCount
    },
    summary: {
      grand_total_km2: grandTotal,
      oblast_count: Object.keys(activeOblasts).length
    },
    oblasts: activeOblasts
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('Ukraine Territory Daily Extractor');
  console.log('='.repeat(70));
  console.log(`Run time: ${new Date().toISOString()}`);
  console.log('');
  
  try {
    // Step 1: Fetch raw data
    const rawData = await fetchTerritoryData();
    console.log(`✓ Fetched snapshot ID: ${rawData.id}`);
    console.log(`✓ Features: ${rawData.map.features.length}`);
    console.log('');
    
    // Step 2: Save raw backup
    const dateStr = new Date().toISOString().split('T')[0];
    const rawFile = path.join(CONFIG.backupDir, `raw_${dateStr}_${rawData.id}.json`);
    fs.writeFileSync(rawFile, JSON.stringify(rawData, null, 2));
    console.log(`✓ Raw backup saved: ${rawFile}`);
    
    // Step 3: Process by oblast
    console.log('\nProcessing by oblast...');
    const processedData = processByOblast(rawData);
    
    // Step 4: Save processed output
    const outputFile = path.join(CONFIG.outputDir, `ukraine_oblast_control_${dateStr}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(processedData, null, 2));
    console.log(`✓ Processed data saved: ${outputFile}`);
    
    // Step 5: Print summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Date: ${dateStr}`);
    console.log(`Snapshot ID: ${processedData.metadata.snapshot_id}`);
    console.log(`Oblasts with data: ${processedData.summary.oblast_count}`);
    console.log(`Total polygons processed: ${processedData.metadata.processed_polygons}`);
    console.log('');
    console.log('GRAND TOTALS (km²):');
    const gt = processedData.summary.grand_total_km2;
    console.log(`  Ukrainian controlled: ${gt.ukrainian_km2.toFixed(2)}`);
    console.log(`  Russian controlled (post-2022): ${gt.russian_km2.toFixed(2)}`);
    console.log(`  Russian controlled (pre-2022/Crimea): ${gt.russian_pre2022_km2.toFixed(2)}`);
    console.log(`  Contested/Unknown: ${gt.contested_km2.toFixed(2)}`);
    console.log(`  TOTAL: ${gt.total_area_km2.toFixed(2)}`);
    console.log('');
    console.log('TOP 5 OBLASTS BY TOTAL AREA:');
    const sortedOblasts = Object.entries(processedData.oblasts)
      .sort((a, b) => b[1].total_area_km2 - a[1].total_area_km2)
      .slice(0, 5);
    
    for (const [name, stats] of sortedOblasts) {
      console.log(`  ${name}: ${stats.total_area_km2.toFixed(2)} km² ` +
        `(U:${stats.ukrainian_percent}%, R:${stats.russian_percent}%, C:${stats.contested_percent}%)`);
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✓ Daily extraction complete');
    console.log('='.repeat(70));
    
    // Return data for programmatic use
    return processedData;
    
  } catch (error) {
    console.error('\n✗ Extraction failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(data => {
    // Success - exit cleanly
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

export { main, fetchTerritoryData, processByOblast };
