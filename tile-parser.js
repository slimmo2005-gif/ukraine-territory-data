/**
 * Vector Tile Parser
 * Decodes Mapbox Vector Tiles (MVT) to extract geometry
 */

import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import fs from 'fs';
import path from 'path';

const DATA_DIR = './discovered_data';
const OUTPUT_DIR = './parsed_data';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function parseVectorTile(buffer, tileName) {
  try {
    const tile = new VectorTile(new Protobuf(buffer));
    const layers = Object.keys(tile.layers);
    
    console.log(`\nParsing: ${tileName}`);
    console.log(`Layers found: ${layers.join(', ') || 'none'}`);
    
    const extractedData = {};
    
    for (const layerName of layers) {
      const layer = tile.layers[layerName];
      const featureCount = layer.length;
      
      console.log(`\n  Layer "${layerName}": ${featureCount} features`);
      
      const features = [];
      
      for (let i = 0; i < Math.min(featureCount, 5); i++) {
        const feature = layer.feature(i);
        const geojson = feature.toGeoJSON(0, 0, 0); // z, x, y
        
        features.push({
          type: feature.type,
          properties: feature.properties,
          geometry_type: geojson.geometry?.type,
          coordinates_sample: JSON.stringify(geojson.geometry?.coordinates).substring(0, 200)
        });
      }
      
      extractedData[layerName] = {
        featureCount,
        sampleFeatures: features
      };
    }
    
    return {
      tileName,
      layers,
      data: extractedData,
      bufferSize: buffer.length
    };
    
  } catch (error) {
    console.error(`  Error parsing ${tileName}: ${error.message}`);
    return null;
  }
}

function parseAllTiles() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.pbf'));
  
  if (files.length === 0) {
    console.log('No vector tile files found in discovered_data/');
    console.log('Run: npm run investigate');
    return;
  }
  
  const allResults = [];
  
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(DATA_DIR, file));
    const result = parseVectorTile(buffer, file);
    if (result) {
      allResults.push(result);
      
      // Save parsed structure
      const outputFile = file.replace('.pbf', '_parsed.json');
      fs.writeFileSync(
        path.join(OUTPUT_DIR, outputFile),
        JSON.stringify(result, null, 2)
      );
    }
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Parsing Summary');
  console.log(`${'='.repeat(60)}`);
  allResults.forEach(r => {
    console.log(`\n${r.tileName}:`);
    console.log(`  Size: ${r.bufferSize} bytes`);
    console.log(`  Layers: ${r.layers.join(', ')}`);
    r.layers.forEach(layer => {
      console.log(`    - ${layer}: ${r.data[layer].featureCount} features`);
    });
  });
}

parseAllTiles();
