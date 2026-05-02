/**
 * Ukraine War Map Data Investigator
 * Uses Playwright to capture network traffic and extract geographic data
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Target sources to investigate
const TARGETS = [
  {
    name: 'DeepStateMap',
    url: 'https://deepstatemap.live/',
    description: 'Real-time Ukraine war map with frontlines'
  },
  {
    name: 'ISW_Ukraine', 
    url: 'https://storymaps.arcgis.com/stories/86b2b69dfd5446c7b331cf933deee4f2',
    description: 'ISW Ukraine story map'
  },
  {
    name: 'Liveuamap',
    url: 'https://liveuamap.com/',
    description: 'Live Ukraine conflict map'
  }
];

const OUTPUT_DIR = './discovered_data';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Store captured requests
const capturedRequests = [];
const capturedData = [];

async function investigateTarget(target) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Investigating: ${target.name}`);
  console.log(`URL: ${target.url}`);
  console.log(`${'='.repeat(60)}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture all network requests
  page.on('request', request => {
    const url = request.url();
    const resourceType = request.resourceType();
    
    if (isGeographicEndpoint(url)) {
      console.log(`[REQUEST] ${resourceType}: ${url.substring(0, 120)}`);
      capturedRequests.push({
        target: target.name,
        url: url,
        method: request.method(),
        resourceType: resourceType,
        headers: request.headers()
      });
    }
  });

  // Capture responses
  page.on('response', async response => {
    const url = response.url();
    
    if (isGeographicEndpoint(url)) {
      try {
        const contentType = response.headers()['content-type'] || '';
        console.log(`[RESPONSE] ${response.status()} - ${contentType}`);
        
        // Capture data based on content type
        if (contentType.includes('json')) {
          const data = await response.json().catch(() => null);
          if (data) {
            const fileName = `geojson_${target.name}_${Date.now()}.json`;
            fs.writeFileSync(path.join(OUTPUT_DIR, fileName), JSON.stringify(data, null, 2));
            console.log(`  -> Saved JSON: ${fileName}`);
            capturedData.push({ type: 'json', source: url, file: fileName, target: target.name });
          }
        } else if (isVectorTile(url, contentType)) {
          const buffer = await response.body();
          const fileName = `tile_${target.name}_${Date.now()}.pbf`;
          fs.writeFileSync(path.join(OUTPUT_DIR, fileName), buffer);
          console.log(`  -> Saved Vector Tile: ${fileName} (${buffer.length} bytes)`);
          capturedData.push({ type: 'vector_tile', source: url, file: fileName, size: buffer.length, target: target.name });
        }
      } catch (e) {
        // Silent fail for non-critical responses
      }
    }
  });

  try {
    await page.goto(target.url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(8000);
    
    console.log('  Exploring map to trigger data loads...');
    
    // Scroll/pan to trigger more tile loads
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(400, 300);
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(2000);
    }
    
  } catch (error) {
    console.error(`  Error: ${error.message}`);
  }

  await browser.close();
}

function isGeographicEndpoint(url) {
  const geoPatterns = [
    /geojson/i, /\.json$/i, /api\/map/i, /tiles?\//i, /vector/i,
    /mvt/i, /\.pbf/i, /frontline/i, /boundary/i, /occupation/i,
    /control/i, /ukraine.*data/i, /war.*map/i, /deepstate/i,
    /mapbox/i, /tileserver/i, /features/i
  ];
  return geoPatterns.some(pattern => pattern.test(url));
}

function isVectorTile(url, contentType) {
  return contentType.includes('protobuf') || 
         contentType.includes('vector-tile') ||
         url.includes('.pbf') || 
         url.includes('.mvt') ||
         url.includes('/vector/');
}

async function main() {
  console.log('Ukraine War Map Data Investigator');
  console.log('Inspecting network traffic for geographic data\n');
  
  for (const target of TARGETS) {
    await investigateTarget(target);
  }

  // Save summary report
  const report = {
    timestamp: new Date().toISOString(),
    totalRequests: capturedRequests.length,
    totalDataFiles: capturedData.length,
    requests: capturedRequests,
    dataFiles: capturedData
  };
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'investigation_report.json'),
    JSON.stringify(report, null, 2)
  );
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('Investigation Complete');
  console.log(`${'='.repeat(60)}`);
  console.log(`Total requests captured: ${capturedRequests.length}`);
  console.log(`Data files saved: ${capturedData.length}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

main().catch(console.error);
