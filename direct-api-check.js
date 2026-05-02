/**
 * Direct API Endpoint Checker
 * Tests known/suspected API endpoints without browser automation
 */

import fetch from 'node-fetch';
import fs from 'fs';

// Known/suspected endpoints for Ukraine war data
const ENDPOINTS = [
  // DeepStateMap - suspected patterns based on common GIS architectures
  { name: 'DeepState_GeoJSON', url: 'https://deepstatemap.live/api/v1/map.geojson' },
  { name: 'DeepState_API', url: 'https://api.deepstatemap.live/v1/features' },
  { name: 'DeepState_Tiles', url: 'https://tiles.deepstatemap.live/10/576/352.pbf' },
  
  // OSM/Mapbox data that might include conflict layers
  { name: 'OSM_Overpass', url: 'https://overpass-api.de/api/interpreter?data=[out:json];area[name="Ukraine"]->.ua;node[place](area.ua);out;' },
  
  // Liveuamap suspected
  { name: 'Liveuamap_API', url: 'https://liveuamap.com/api/v2/markers' },
  { name: 'Liveuamap_Data', url: 'https://cdn.liveuamap.com/data.json' },
  
  // ISW/ArcGIS
  { name: 'ISW_ArcGIS', url: 'https://services1.arcgis.com/xxx/arcgis/rest/services/Ukraine/FeatureServer' },
];

const OUTPUT_DIR = './discovered_data';

async function checkEndpoint(endpoint) {
  console.log(`\nChecking: ${endpoint.name}`);
  console.log(`URL: ${endpoint.url}`);
  
  try {
    const response = await fetch(endpoint.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    console.log(`Status: ${response.status}`);
    console.log(`Content-Type: ${response.headers.get('content-type')}`);
    
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('json')) {
        const data = await response.json();
        const fileName = `api_${endpoint.name}.json`;
        fs.writeFileSync(`${OUTPUT_DIR}/${fileName}`, JSON.stringify(data, null, 2));
        console.log(`SAVED: ${fileName}`);
        console.log(`Data type: ${data.type || typeof data}`);
        if (data.features) console.log(`Features: ${data.features.length}`);
        return { found: true, type: 'json', file: fileName };
      } else if (contentType.includes('protobuf') || endpoint.url.includes('.pbf')) {
        const buffer = await response.arrayBuffer();
        const fileName = `api_${endpoint.name}.pbf`;
        fs.writeFileSync(`${OUTPUT_DIR}/${fileName}`, Buffer.from(buffer));
        console.log(`SAVED: ${fileName} (${buffer.byteLength} bytes)`);
        return { found: true, type: 'pbf', file: fileName, size: buffer.byteLength };
      } else {
        const text = await response.text();
        console.log(`Response preview: ${text.substring(0, 200)}`);
      }
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
  
  return { found: false };
}

async function main() {
  console.log('Direct API Endpoint Checker');
  console.log('Testing suspected Ukraine map endpoints...\n');
  
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  const results = [];
  for (const endpoint of ENDPOINTS) {
    const result = await checkEndpoint(endpoint);
    results.push({ ...endpoint, ...result });
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  
  const found = results.filter(r => r.found);
  console.log(`\nFound ${found.length}/${results.length} accessible endpoints:`);
  found.forEach(r => console.log(`  ✓ ${r.name}: ${r.file}`));
}

main().catch(console.error);
