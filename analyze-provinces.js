/**
 * Analyze Province-Level Data from DeepStateMap
 * Check if we can extract oblast-level statistics
 */

import fs from 'fs';

// Ukraine oblasts (provinces) with approximate boundaries
const UKRAINE_OBLASTS = [
  { name: 'Cherkasy', center: [32.0, 49.4] },
  { name: 'Chernihiv', center: [31.3, 51.5] },
  { name: 'Chernivtsi', center: [25.9, 48.3] },
  { name: 'Dnipropetrovsk', center: [35.0, 48.5] },
  { name: 'Donetsk', center: [37.8, 48.0] },
  { name: 'Ivano-Frankivsk', center: [24.7, 48.9] },
  { name: 'Kharkiv', center: [36.2, 49.9] },
  { name: 'Kherson', center: [33.3, 46.6] },
  { name: 'Khmelnytskyi', center: [27.0, 49.4] },
  { name: 'Kyiv', center: [30.5, 50.4] },
  { name: 'Kirovohrad', center: [32.3, 48.5] },
  { name: 'Luhansk', center: [39.3, 48.9] },
  { name: 'Lviv', center: [24.0, 49.8] },
  { name: 'Mykolaiv', center: [31.9, 47.0] },
  { name: 'Odesa', center: [30.7, 46.5] },
  { name: 'Poltava', center: [34.5, 49.6] },
  { name: 'Rivne', center: [26.2, 50.6] },
  { name: 'Sumy', center: [34.8, 50.9] },
  { name: 'Ternopil', center: [25.6, 49.6] },
  { name: 'Vinnytsia', center: [28.5, 49.2] },
  { name: 'Volyn', center: [25.1, 50.7] },
  { name: 'Zakarpattia', center: [22.3, 48.6] },
  { name: 'Zaporizhzhia', center: [35.2, 47.8] },
  { name: 'Zhytomyr', center: [28.7, 50.3] },
  { name: 'Crimea', center: [34.4, 45.3] },
  { name: 'Sevastopol', center: [33.5, 44.6] },
  { name: 'Kyiv City', center: [30.5, 50.4] }
];

function pointInPolygon(point, polygon) {
  // Ray casting algorithm
  const x = point[0], y = point[1];
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    
    const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
}

function getPolygonCentroid(coordinates) {
  const ring = coordinates[0];
  let x = 0, y = 0;
  
  for (const point of ring) {
    x += point[0];
    y += point[1];
  }
  
  return [x / ring.length, y / ring.length];
}

function parseControlStatus(properties) {
  const styleUrl = properties.styleUrl || '';
  const name = properties.name || '';
  
  if (name.includes('Звільнено') || name.includes('Liberated')) return 'ukrainian';
  if (name.includes('окуповано') || name.includes('occupied')) {
    if (name.includes('до') || name.includes('to') || name.includes('before')) return 'russian_pre2022';
    return 'russian';
  }
  if (name.includes('невідомий') || name.includes('unknown')) return 'contested';
  return 'unknown';
}

function analyzeProvinces() {
  console.log('='.repeat(60));
  console.log('Province-Level Analysis');
  console.log('='.repeat(60));
  
  // Load data
  const dataFile = './discovered_data/geojson_DeepStateMap_1777725794447.json';
  const rawData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const features = rawData.map.features;
  
  console.log(`\nAnalyzing ${features.length} features...`);
  
  // Analyze what province information is available
  const provinceIndicators = [];
  const sampleProperties = [];
  
  features.forEach((f, i) => {
    const props = f.properties;
    
    // Look for province/oblast references
    const propStr = JSON.stringify(props).toLowerCase();
    
    UKRAINE_OBLASTS.forEach(oblast => {
      if (propStr.includes(oblast.name.toLowerCase())) {
        provinceIndicators.push({
          feature: i,
          oblast: oblast.name,
          properties: props
        });
      }
    });
    
    // Save sample properties for analysis
    if (i < 10) {
      sampleProperties.push({ index: i, properties: props });
    }
  });
  
  console.log(`\nFeatures with explicit province names: ${provinceIndicators.length}`);
  
  if (provinceIndicators.length > 0) {
    console.log('\nSample matches:');
    provinceIndicators.slice(0, 5).forEach(p => {
      console.log(`  Feature ${p.feature}: ${p.oblast}`);
    });
  } else {
    console.log('\n⚠ No explicit province names found in properties.');
    console.log('  DeepStateMap polygons do NOT include oblast-level metadata.');
  }
  
  // Alternative: Calculate by geographic location
  console.log('\n' + '='.repeat(60));
  console.log('Alternative: Geographic Province Assignment');
  console.log('='.repeat(60));
  console.log('Assigning polygons to provinces by centroid location...\n');
  
  const provinceStats = {};
  
  UKRAINE_OBLASTS.forEach(oblast => {
    provinceStats[oblast.name] = {
      ukrainian: { count: 0, area: 0 },
      russian: { count: 0, area: 0 },
      russian_pre2022: { count: 0, area: 0 },
      contested: { count: 0, area: 0 },
      unknown: { count: 0, area: 0 }
    };
  });
  
  let assignedCount = 0;
  let unassignedCount = 0;
  
  features.forEach(f => {
    if (f.geometry.type !== 'Polygon') return;
    
    const centroid = getPolygonCentroid(f.geometry.coordinates);
    const status = parseControlStatus(f.properties);
    
    // Find nearest oblast center (simple distance-based assignment)
    let nearestOblast = null;
    let minDistance = Infinity;
    
    UKRAINE_OBLASTS.forEach(oblast => {
      const dx = centroid[0] - oblast.center[0];
      const dy = centroid[1] - oblast.center[1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < minDistance) {
        minDistance = distance;
        nearestOblast = oblast.name;
      }
    });
    
    // Only assign if within reasonable distance (degrees)
    if (nearestOblast && minDistance < 3.0) {
      provinceStats[nearestOblast][status].count++;
      assignedCount++;
    } else {
      unassignedCount++;
    }
  });
  
  console.log(`Features assigned to provinces: ${assignedCount}`);
  console.log(`Features outside province bounds: ${unassignedCount}`);
  
  // Display province-level summary
  console.log('\n' + '='.repeat(60));
  console.log('Province-Level Control Summary (by feature count)');
  console.log('='.repeat(60));
  
  const sortedProvinces = Object.entries(provinceStats)
    .filter(([_, stats]) => 
      stats.ukrainian.count > 0 || 
      stats.russian.count > 0 || 
      stats.russian_pre2022.count > 0 || 
      stats.contested.count > 0
    )
    .sort((a, b) => {
      const totalA = a[1].ukrainian.count + a[1].russian.count + a[1].russian_pre2022.count + a[1].contested.count;
      const totalB = b[1].ukrainian.count + b[1].russian.count + b[1].russian_pre2022.count + b[1].contested.count;
      return totalB - totalA;
    });
  
  sortedProvinces.forEach(([province, stats]) => {
    const total = stats.ukrainian.count + stats.russian.count + stats.russian_pre2022.count + stats.contested.count;
    if (total === 0) return;
    
    console.log(`\n${province}:`);
    if (stats.ukrainian.count > 0) console.log(`  Ukrainian: ${stats.ukrainian.count} zones`);
    if (stats.russian.count > 0) console.log(`  Russian (post-2022): ${stats.russian.count} zones`);
    if (stats.russian_pre2022.count > 0) console.log(`  Russian (pre-2022/Crimea): ${stats.russian_pre2022.count} zones`);
    if (stats.contested.count > 0) console.log(`  Contested: ${stats.contested.count} zones`);
  });
  
  // Sample properties for understanding structure
  console.log('\n' + '='.repeat(60));
  console.log('Sample Feature Properties:');
  console.log('='.repeat(60));
  sampleProperties.forEach(s => {
    console.log(`\nFeature ${s.index}:`);
    console.log(`  Name: ${s.properties.name || 'N/A'}`);
    console.log(`  StyleUrl: ${s.properties.styleUrl || 'N/A'}`);
  });
  
  // Recommendations
  console.log('\n' + '='.repeat(60));
  console.log('ASSESSMENT: Province-Level Breakdown');
  console.log('='.repeat(60));
  console.log('\n✗ Direct API province field: NOT AVAILABLE');
  console.log('  DeepStateMap polygons do not include oblast/admin level metadata.');
  console.log('\n✓ Geographic assignment: POSSIBLE');
  console.log('  Can assign polygons to provinces by centroid location.');
  console.log('  Accuracy: Medium (depends on polygon size/proximity to borders)');
  console.log('\n✓ Better approach: Join with official Ukraine admin boundaries');
  console.log('  1. Download Ukraine oblast boundaries (GeoJSON)');
  console.log('  2. Perform spatial intersection with DeepStateMap data');
  console.log('  3. Calculate proportional area for polygons crossing boundaries');
  console.log('\n  Recommended source: Natural Earth or GADM admin boundaries');
}

analyzeProvinces();
