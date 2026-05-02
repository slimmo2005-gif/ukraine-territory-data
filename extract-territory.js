/**
 * Proof-of-Concept: Ukraine Territory Data Extractor
 * Fetches current territorial control from DeepStateMap API
 * Calculates area statistics by control type
 */

import fs from 'fs';

// Using native fetch (Node 18+)
const API_URL = 'https://deepstatemap.live/api/history/last';

function parseControlStatus(properties) {
  // Parse status from styleUrl or name field
  const styleUrl = properties.styleUrl || '';
  const name = properties.name || '';
  
  // Style hash mapping (observed patterns)
  if (styleUrl.includes('BCAAA4')) return 'unknown/contested';
  if (styleUrl.includes('FF0000')) return 'russian_control';  // Hypothesis: red
  if (styleUrl.includes('00FF00')) return 'ukrainian_control'; // Hypothesis: green
  if (styleUrl.includes('FFFF00')) return 'liberated'; // Hypothesis: yellow
  
  // Parse from name field (contains Ukrainian status)
  if (name.includes('окуповано') || name.includes('occupied')) {
    if (name.includes('після') || name.includes('after')) return 'occupied_after_2022';
    if (name.includes('до') || name.includes('to') || name.includes('before')) return 'occupied_pre_2022';
    return 'occupied';
  }
  if (name.includes('Звільнено') || name.includes('liberated')) return 'liberated';
  if (name.includes('невідомий') || name.includes('unknown')) return 'unknown';
  
  return 'unspecified';
}

function calculatePolygonArea(coords) {
  // Simple planar approximation (not geodetic, sufficient for relative comparison)
  // Uses shoelace formula on lon/lat (degrees)
  let area = 0;
  const ring = coords[0]; // Outer ring
  
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    area += (lon1 * lat2 - lon2 * lat1);
  }
  
  return Math.abs(area) / 2;
}

function extractAndAnalyze() {
  console.log('='.repeat(60));
  console.log('Ukraine Territory Data Extractor - PoC');
  console.log('='.repeat(60));
  
  // Read the captured data file
  const dataFile = './discovered_data/geojson_DeepStateMap_1777725794447.json';
  
  if (!fs.existsSync(dataFile)) {
    console.error('No data file found. Run: npm run investigate');
    return;
  }
  
  console.log(`\nLoading: ${dataFile}`);
  const rawData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  
  console.log(`Snapshot ID: ${rawData.id}`);
  console.log(`Timestamp: ${new Date(rawData.id * 1000).toISOString()} (if Unix epoch)`);
  
  const features = rawData.map.features;
  console.log(`\nTotal features: ${features.length}`);
  
  // Analyze features
  const stats = {
    byStatus: {},
    byGeometryType: {},
    sampleFeatures: []
  };
  
  features.forEach((f, i) => {
    const geomType = f.geometry.type;
    const status = parseControlStatus(f.properties);
    
    stats.byGeometryType[geomType] = (stats.byGeometryType[geomType] || 0) + 1;
    
    if (!stats.byStatus[status]) {
      stats.byStatus[status] = { count: 0, area: 0 };
    }
    stats.byStatus[status].count++;
    
    // Calculate area for polygons
    if (geomType === 'Polygon' && f.geometry.coordinates) {
      const area = calculatePolygonArea(f.geometry.coordinates);
      stats.byStatus[status].area += area;
    }
    
    // Save first 3 samples
    if (stats.sampleFeatures.length < 3) {
      stats.sampleFeatures.push({
        index: i,
        type: geomType,
        status: status,
        properties: f.properties,
        coordinateCount: f.geometry.coordinates?.[0]?.length || 0
      });
    }
  });
  
  // Output results
  console.log('\n' + '='.repeat(60));
  console.log('ANALYSIS RESULTS');
  console.log('='.repeat(60));
  
  console.log('\nGeometry Types:');
  Object.entries(stats.byGeometryType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count} features`);
  });
  
  console.log('\nControl Status Distribution:');
  Object.entries(stats.byStatus)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([status, data]) => {
      const areaStr = data.area > 0 
        ? `(approx area: ${(data.area * 111 * 111).toFixed(2)} km²)` // Rough conversion
        : '';
      console.log(`  ${status}: ${data.count} features ${areaStr}`);
    });
  
  console.log('\nSample Features:');
  stats.sampleFeatures.forEach(f => {
    console.log(`\n  Feature #${f.index}:`);
    console.log(`    Type: ${f.type}`);
    console.log(`    Status: ${f.status}`);
    console.log(`    Points: ${f.coordinateCount}`);
    console.log(`    Name: ${f.properties.name?.substring(0, 60)}...`);
  });
  
  // Save processed results
  const outputFile = './discovered_data/analysis_results.json';
  fs.writeFileSync(outputFile, JSON.stringify(stats, null, 2));
  console.log(`\n✓ Analysis saved to: ${outputFile}`);
  
  // Generate extraction code snippet
  console.log('\n' + '='.repeat(60));
  console.log('DAILY EXTRACTION CODE');
  console.log('='.repeat(60));
  console.log(`
// Daily automated extraction
const fetch = require('node-fetch');
const fs = require('fs');

async function extractDaily() {
  const response = await fetch('${API_URL}');
  const data = await response.json();
  
  const date = new Date().toISOString().split('T')[0];
  const filename = \`ukraine_territory_\${date}_\${data.id}.geojson\`;
  
  fs.writeFileSync(filename, JSON.stringify(data.map, null, 2));
  console.log(\`Saved: \${filename}\`);
  
  return data;
}

// Run daily via cron or scheduler
extractDaily().catch(console.error);
  `);
}

extractAndAnalyze();
