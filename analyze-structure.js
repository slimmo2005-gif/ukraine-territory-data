/**
 * Analyze Structure of Captured Geographic Data
 * Reports on schema, fields, and data sufficiency
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = './discovered_data';
const PARSED_DIR = './parsed_data';

function analyzeGeoJSON(filePath) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  console.log(`\nAnalyzing: ${path.basename(filePath)}`);
  
  // Determine structure
  if (content.type === 'FeatureCollection' && content.features) {
    console.log(`  Type: FeatureCollection`);
    console.log(`  Features: ${content.features.length}`);
    
    if (content.features.length > 0) {
      const sample = content.features[0];
      console.log(`  Geometry Type: ${sample.geometry?.type}`);
      console.log(`  Properties: ${Object.keys(sample.properties || {}).join(', ')}`);
    }
    
    // Check for territorial data
    const properties = content.features.map(f => Object.keys(f.properties || {})).flat();
    const uniqueProps = [...new Set(properties)];
    
    const territorialIndicators = [
      'territory', 'control', 'occupation', 'front', 'boundary',
      'admin', 'region', 'district', 'area', 'status', 'side'
    ];
    
    const foundTerritorial = uniqueProps.filter(p => 
      territorialIndicators.some(ind => p.toLowerCase().includes(ind))
    );
    
    console.log(`  Territorial Indicators: ${foundTerritorial.join(', ') || 'none found'}`);
    
    return {
      type: 'FeatureCollection',
      featureCount: content.features.length,
      geometryTypes: [...new Set(content.features.map(f => f.geometry?.type).filter(Boolean))],
      properties: uniqueProps,
      territorialFields: foundTerritorial,
      hasTerritorialData: foundTerritorial.length > 0
    };
  }
  
  return { type: 'unknown' };
}

function analyzeParsedTiles(filePath) {
  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  console.log(`\nAnalyzing: ${content.tileName}`);
  console.log(`  Layers: ${content.layers.length}`);
  
  content.layers.forEach(layerName => {
    const layer = content.data[layerName];
    console.log(`\n  Layer: ${layerName}`);
    console.log(`    Features: ${layer.featureCount}`);
    
    if (layer.sampleFeatures.length > 0) {
      const props = Object.keys(layer.sampleFeatures[0].properties || {});
      console.log(`    Properties: ${props.join(', ')}`);
    }
  });
  
  return {
    layers: content.layers,
    layerDetails: content.data
  };
}

function generateAssessment(allData) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('DATA SUFFICIENCY ASSESSMENT');
  console.log(`${'='.repeat(60)}`);
  
  const geojsonData = allData.filter(d => d.type === 'geojson');
  const tileData = allData.filter(d => d.type === 'vector_tiles');
  
  // Territorial data evaluation
  const territorialSources = geojsonData.filter(d => d.analysis?.hasTerritorialData);
  
  console.log(`\n1. FRONTLINE RECONSTRUCTION:`);
  if (territorialSources.length > 0) {
    console.log(`   OK - Found ${territorialSources.length} sources with territorial indicators`);
    territorialSources.forEach(s => {
      console.log(`     - ${s.file}: ${s.analysis.territorialFields.join(', ')}`);
    });
  } else {
    console.log(`   ? UNCERTAIN - No explicit territorial fields found in GeoJSON`);
    console.log(`   Vector tiles may contain rendered frontlines as line features`);
  }
  
  console.log(`\n2. TERRITORIAL POLYGON CALCULATION:`);
  const polygonSources = geojsonData.filter(d => 
    d.analysis?.geometryTypes?.some(gt => gt?.includes('Polygon'))
  );
  if (polygonSources.length > 0) {
    console.log(`   OK - Found polygon geometry sources`);
  } else {
    console.log(`   ? UNCERTAIN - May need to construct from line features or tile boundaries`);
  }
  
  console.log(`\n3. AREA CHANGE MEASUREMENT:`);
  if (territorialSources.length > 0 && polygonSources.length > 0) {
    console.log(`   FEASIBLE - Can calculate polygon areas and compare over time`);
    console.log(`   Requires: Daily snapshots, consistent coordinate system`);
  } else {
    console.log(`   CHALLENGING - Insufficient data structure for automated area calc`);
  }
  
  console.log(`\n4. AUTOMATED DAILY EXTRACTION:`);
  if (geojsonData.length > 0) {
    const hasAPI = geojsonData.some(d => d.file.includes('api') || d.source?.includes('api'));
    if (hasAPI) {
      console.log(`   VIABLE - Direct API endpoints detected`);
    } else {
      console.log(`   MANUAL - No clear API, may require scraping`);
    }
  } else {
    console.log(`   HARD - Vector tiles require reverse engineering layer semantics`);
  }
  
  return {
    canReconstructFrontlines: territorialSources.length > 0 || tileData.length > 0,
    canCalculatePolygons: polygonSources.length > 0,
    canMeasureChanges: territorialSources.length > 0 && polygonSources.length > 0,
    dailyExtractionViable: geojsonData.some(d => d.source?.includes('api'))
  };
}

function main() {
  console.log('Geographic Data Structure Analysis\n');
  
  const allData = [];
  
  // Analyze GeoJSON files
  if (fs.existsSync(DATA_DIR)) {
    const geojsonFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    for (const file of geojsonFiles) {
      try {
        const analysis = analyzeGeoJSON(path.join(DATA_DIR, file));
        allData.push({ type: 'geojson', file, analysis });
      } catch (e) {
        console.error(`Error analyzing ${file}: ${e.message}`);
      }
    }
  }
  
  // Analyze parsed tiles
  if (fs.existsSync(PARSED_DIR)) {
    const parsedFiles = fs.readdirSync(PARSED_DIR).filter(f => f.endsWith('_parsed.json'));
    for (const file of parsedFiles) {
      try {
        const analysis = analyzeParsedTiles(path.join(PARSED_DIR, file));
        allData.push({ type: 'vector_tiles', file, analysis });
      } catch (e) {
        console.error(`Error analyzing ${file}: ${e.message}`);
      }
    }
  }
  
  if (allData.length === 0) {
    console.log('No data files found. Run: npm run investigate');
    return;
  }
  
  generateAssessment(allData);
}

main();
