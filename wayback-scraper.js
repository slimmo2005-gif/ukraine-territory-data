/**
 * Wayback Machine Historical Data Scraper
 * Attempts to extract DeepStateMap data from archived snapshots
 */

import fs from 'fs';
import path from 'path';

const WAYBACK_CDX_API = 'http://web.archive.org/cdx/search/cdx';
const TARGET_URL = 'deepstatemap.live';

async function fetchWaybackSnapshots() {
  console.log('='.repeat(70));
  console.log('Fetching Wayback Machine Snapshots');
  console.log('='.repeat(70));
  
  const params = new URLSearchParams({
    url: TARGET_URL,
    output: 'json',
    collapse: 'timestamp:8', // One per day
    fl: 'timestamp,original,statuscode,digest'
  });
  
  const url = `${WAYBACK_CDX_API}?${params.toString()}`;
  console.log(`\nQuerying: ${url.substring(0, 60)}...`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data) || data.length === 0) {
      console.log('No snapshots found');
      return [];
    }
    
    // First row is header
    const header = data[0];
    const snapshots = data.slice(1);
    
    console.log(`\n✓ Found ${snapshots.length} daily snapshots`);
    console.log(`Columns: ${header.join(', ')}`);
    
    // Parse snapshots
    const parsedSnapshots = snapshots.map(row => ({
      timestamp: row[0],
      date: `${row[0].substring(0, 4)}-${row[0].substring(4, 6)}-${row[0].substring(6, 8)}`,
      time: `${row[0].substring(8, 10)}:${row[0].substring(10, 12)}:${row[0].substring(12, 14)}`,
      originalUrl: row[1],
      statusCode: row[2],
      digest: row[3],
      waybackUrl: `https://web.archive.org/web/${row[0]}/${row[1]}`
    }));
    
    // Group by year
    const byYear = {};
    parsedSnapshots.forEach(snap => {
      const year = snap.date.substring(0, 4);
      byYear[year] = (byYear[year] || 0) + 1;
    });
    
    console.log('\nSnapshots by year:');
    Object.entries(byYear)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([year, count]) => {
        console.log(`  ${year}: ${count} snapshots`);
      });
    
    return parsedSnapshots;
    
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    return [];
  }
}

async function tryExtractFromSnapshot(snapshot) {
  console.log(`\nTrying snapshot: ${snapshot.date}`);
  console.log(`  URL: ${snapshot.waybackUrl}`);
  
  // The challenge: Wayback archives the rendered HTML/JS, not the API response
  // The API call happens client-side and isn't captured
  
  // What we CAN try:
  // 1. Check if the Wayback archived the API response directly
  // 2. Look for cached data in the page
  
  const apiUrl = `https://web.archive.org/web/${snapshot.timestamp}/https://deepstatemap.live/api/history/last`;
  
  try {
    console.log(`  Trying API archive: ${apiUrl.substring(0, 70)}...`);
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });
    
    console.log(`  Status: ${response.status}`);
    
    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      console.log(`  Content-Type: ${contentType}`);
      
      if (contentType.includes('json')) {
        const data = await response.json();
        
        if (data.map && data.map.features) {
          console.log(`  ✓✓✓ SUCCESS! Found GeoJSON with ${data.map.features.length} features`);
          return { success: true, data, type: 'api_geojson' };
        }
      }
      
      // If not JSON, might be HTML wrapper
      const text = await response.text();
      console.log(`  Response preview: ${text.substring(0, 100)}`);
    }
    
  } catch (error) {
    console.log(`  ✗ Fetch error: ${error.message}`);
  }
  
  return { success: false };
}

async function tryMultipleSnapshots(snapshots, sampleSize = 10) {
  console.log('\n' + '='.repeat(70));
  console.log(`Testing ${sampleSize} random snapshots for API data`);
  console.log('='.repeat(70));
  
  // Sample random snapshots from different time periods
  const sampled = [];
  const step = Math.floor(snapshots.length / sampleSize);
  
  for (let i = 0; i < snapshots.length; i += step) {
    sampled.push(snapshots[i]);
    if (sampled.length >= sampleSize) break;
  }
  
  const results = [];
  
  for (const snapshot of sampled) {
    const result = await tryExtractFromSnapshot(snapshot);
    results.push({ ...snapshot, ...result });
    
    // Delay between requests
    await new Promise(r => setTimeout(r, 2000));
  }
  
  return results;
}

function saveSuccessfulSnapshots(results) {
  const successful = results.filter(r => r.success);
  
  if (successful.length === 0) {
    console.log('\n✗ No successful API extractions from Wayback');
    return;
  }
  
  console.log(`\n✓ Found ${successful.length} snapshots with extractable data`);
  
  const outputDir = './wayback_extracted';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  successful.forEach((result, index) => {
    const filename = path.join(outputDir, `wayback_${result.date}_${result.timestamp}.json`);
    fs.writeFileSync(filename, JSON.stringify(result.data, null, 2));
    console.log(`  Saved: ${filename}`);
  });
}

async function generateHistoricalReport(snapshots) {
  console.log('\n' + '='.repeat(70));
  console.log('HISTORICAL DATA AVAILABILITY REPORT');
  console.log('='.repeat(70));
  
  // Timeline analysis
  const warStart = new Date('2022-02-24');
  const today = new Date();
  const daysSinceWarStart = Math.floor((today - warStart) / (1000 * 60 * 60 * 24));
  
  console.log(`
Timeline:
  War start: 2022-02-24
  Days since start: ${daysSinceWarStart}
  Wayback snapshots: ${snapshots.length} days
  Coverage: ${((snapshots.length / daysSinceWarStart) * 100).toFixed(1)}% of days
  `);
  
  // Check date range of snapshots
  const dates = snapshots.map(s => new Date(s.date));
  const earliest = new Date(Math.min(...dates));
  const latest = new Date(Math.max(...dates));
  
  console.log(`Snapshot date range:`);
  console.log(`  Earliest: ${earliest.toISOString().split('T')[0]}`);
  console.log(`  Latest: ${latest.toISOString().split('T')[0]}`);
  
  // Check if war period is covered
  if (earliest <= warStart) {
    console.log('  ✓ Covers war start period');
  } else {
    console.log(`  ⚠ Missing first ${Math.floor((earliest - warStart) / (1000 * 60 * 60 * 24))} days of war`);
  }
  
  // Gaps analysis
  console.log('\nGap Analysis:');
  let gaps = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = new Date(snapshots[i-1].date);
    const curr = new Date(snapshots[i].date);
    const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
    
    if (diffDays > 7) {
      gaps.push({
        start: snapshots[i-1].date,
        end: snapshots[i].date,
        days: diffDays
      });
    }
  }
  
  if (gaps.length > 0) {
    console.log(`  Found ${gaps.length} gaps > 7 days:`);
    gaps.slice(0, 5).forEach(g => {
      console.log(`    ${g.start} to ${g.end}: ${Math.floor(g.days)} days`);
    });
  } else {
    console.log('  ✓ No major gaps (>7 days) found');
  }
  
  // Recommendations
  console.log(`
RECOMMENDATIONS FOR HISTORICAL DATA:
====================================

1. WAYBACK MACHINE API EXTRACTION
   Status: Testing required
   - Wayback archives HTML/JS, not necessarily API responses
   - Need to test if /api/history/last was archived
   - If yes: can extract historical snapshots
   - If no: only have visual maps (hard to process)

2. RECOMMENDED APPROACH (Hybrid):
   
   A. Start daily collection NOW with daily-extract.js
      - From today forward, you'll have complete data
   
   B. For backfilling 2022-2026:
      - Try Wayback extraction (this script)
      - Search GitHub for community datasets
      - Check Kaggle for uploaded time-series
      - Consider purchasing/acquiring from OSINT aggregators
   
   C. For gaps where no data exists:
      - ISW PDF maps (manual or OCR)
      - Crisis Group reports
      - Liveuamap event aggregation

3. IMMEDIATE ACTION:
   Run this script with more samples to confirm if Wayback has API data.
   If successful, can extract full history programmatically.
  `);
}

async function main() {
  console.log('='.repeat(70));
  console.log('WAYBACK MACHINE HISTORICAL DATA SCRAPER');
  console.log('='.repeat(70));
  console.log(`Target: ${TARGET_URL}`);
  console.log(`Start: ${new Date().toISOString()}\n`);
  
  // Step 1: Get all snapshots
  const snapshots = await fetchWaybackSnapshots();
  
  if (snapshots.length === 0) {
    console.log('\n✗ No snapshots available');
    return;
  }
  
  // Step 2: Generate coverage report
  await generateHistoricalReport(snapshots);
  
  // Step 3: Test sample snapshots for API data
  console.log('\n' + '='.repeat(70));
  console.log('TESTING SNAPSHOTS FOR EXTRACTABLE API DATA');
  console.log('='.repeat(70));
  console.log('Sampling 5 snapshots from different periods...\n');
  
  const results = await tryMultipleSnapshots(snapshots, 5);
  
  // Step 4: Save any successful extractions
  saveSuccessfulSnapshots(results);
  
  // Step 5: Summary
  const successful = results.filter(r => r.success).length;
  console.log('\n' + '='.repeat(70));
  console.log('EXTRACTION TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total tested: ${results.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Success rate: ${(successful / results.length * 100).toFixed(1)}%`);
  
  if (successful === 0) {
    console.log(`
⚠ Wayback Machine does NOT appear to archive the API responses.
The Wayback saves the rendered webpage, not the dynamic API calls.

ALTERNATIVE APPROACHES FOR HISTORICAL DATA:
1. GitHub community datasets (search "ukraine territory geojson")
2. Kaggle datasets (manual search)
3. ISW PDF archive + OCR
4. Purchase from OSINT data providers
5. Manual digitization of key dates
    `);
  } else {
    console.log(`
✓ Wayback Machine DOES archive API responses!
You can extract historical data by iterating through all snapshots.
    `);
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('Script complete');
  console.log('='.repeat(70));
}

main().catch(console.error);
