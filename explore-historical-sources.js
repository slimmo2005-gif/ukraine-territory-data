/**
 * Explore Alternative Historical Data Sources
 * Search for Ukraine war territorial data from Feb 2022 onwards
 */

import fs from 'fs';

// Potential data sources to investigate
const HISTORICAL_SOURCES = [
  {
    name: 'DeepStateMap GitHub',
    type: 'github',
    url: 'https://github.com/search?q=deepstatemap+ukraine+geojson&type=repositories',
    description: 'Community forks or data dumps'
  },
  {
    name: 'Kaggle Ukraine Conflict',
    type: 'kaggle',
    url: 'https://www.kaggle.com/datasets?search=ukraine+war',
    description: 'Machine learning datasets'
  },
  {
    name: 'Internet Archive Wayback',
    type: 'wayback',
    url: 'https://web.archive.org/web/*/https://deepstatemap.live/',
    description: 'Historical snapshots of the website'
  },
  {
    name: 'ISW (Institute for the Study of War)',
    type: 'api',
    url: 'https://storymaps.arcgis.com/stories/86b2b69dfd5446c7b331cf933deee4f2',
    description: 'Daily updates, may have GeoJSON'
  },
  {
    name: 'ACLED (Armed Conflict Location)',
    type: 'api',
    url: 'https://acleddata.com/ukraine-crisis/',
    description: 'Event data, not territorial control'
  },
  {
    name: 'Humanitarian Data Exchange',
    type: 'hdx',
    url: 'https://data.humdata.org/dataset?groups=ukraine',
    description: 'UN OCHA data repository'
  },
  {
    name: 'Liveuamap API',
    type: 'api',
    url: 'https://liveuamap.com/api',
    description: 'Event-based data'
  },
  {
    name: 'Ukraine Conflict Tracker (Crisis24)',
    type: 'scraping',
    url: 'https://www.garda.com/crisis24',
    description: 'May have historical reports'
  },
  {
    name: 'Bellingcat OSINT',
    type: 'github',
    url: 'https://github.com/bellingcat',
    description: 'Investigative data'
  },
  {
    name: 'Crisis Group Ukraine',
    type: 'scraping',
    url: 'https://www.crisisgroup.org/program/ukraine',
    description: 'Maps and reports'
  },
  {
    name: 'NASA SEDAC / Socioeconomic Data',
    type: 'academic',
    url: 'https://sedac.ciesin.columbia.edu/',
    description: 'Academic datasets'
  },
  {
    name: 'OpenStreetMap History',
    type: 'osm',
    url: 'https://wiki.openstreetmap.org/wiki/Ukraine',
    description: 'Changeset history may show control'
  },
  {
    name: 'Ukraine Control Map (Twitter)',
    type: 'social',
    url: 'https://twitter.com/search?q=ukraine%20control%20map',
    description: 'Community-created maps'
  },
  {
    name: 'Substack OSINT Archives',
    type: 'archives',
    url: 'https://substack.com/search?q=ukraine%20map',
    description: 'Blogger-generated control maps'
  },
  {
    name: 'r/Ukraine Reddit Archives',
    type: 'reddit',
    url: 'https://www.reddit.com/r/ukraine/search/?q=map&type=posts',
    description: 'Community map posts'
  }
];

// Direct API endpoints to test for historical data
const API_ENDPOINTS_TO_TEST = [
  'https://deepstatemap.live/api/history/all',
  'https://deepstatemap.live/api/snapshots',
  'https://deepstatemap.live/api/timeline',
  'https://deepstatemap.live/api/archive',
  'https://deepstatemap.live/api/export',
  'https://deepstatemap.live/api/dump',
  'https://deepstatemap.live/api/backup',
  'https://deepstatemap.live/api/v1/history',
  'https://deepstatemap.live/api/v2/history',
  'https://deepstatemap.live/api/data/history'
];

async function testEndpoints() {
  console.log('='.repeat(70));
  console.log('Testing DeepStateMap Historical Endpoints');
  console.log('='.repeat(70));
  
  const results = [];
  
  for (const endpoint of API_ENDPOINTS_TO_TEST) {
    try {
      console.log(`\nTesting: ${endpoint}`);
      const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000
      });
      
      console.log(`  Status: ${response.status}`);
      
      if (response.ok) {
        const data = await response.json();
        console.log(`  ✓ SUCCESS! Type: ${typeof data}`);
        if (Array.isArray(data)) {
          console.log(`  Array length: ${data.length}`);
        } else {
          console.log(`  Keys: ${Object.keys(data).join(', ')}`);
        }
        results.push({ endpoint, status: response.status, found: true, type: typeof data });
      } else {
        results.push({ endpoint, status: response.status, found: false });
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
      results.push({ endpoint, status: 'error', found: false, error: error.message });
    }
    
    // Delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

async function searchWaybackMachine() {
  console.log('\n' + '='.repeat(70));
  console.log('Checking Internet Archive Wayback Machine');
  console.log('='.repeat(70));
  
  // Wayback CDX API to list available snapshots
  const waybackUrl = 'http://web.archive.org/cdx/search/cdx?url=deepstatemap.live&output=json&collapse=digest';
  
  try {
    console.log(`\nQuerying: ${waybackUrl.substring(0, 60)}...`);
    const response = await fetch(waybackUrl);
    
    if (!response.ok) {
      console.log(`  Status: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    console.log(`  ✓ Found ${data.length - 1} snapshots (excluding header)`);
    
    if (data.length > 1) {
      // First row is header, skip it
      const snapshots = data.slice(1);
      
      // Group by year
      const byYear = {};
      snapshots.forEach(snap => {
        const year = snap[1].substring(0, 4);
        byYear[year] = (byYear[year] || 0) + 1;
      });
      
      console.log('\n  Snapshots by year:');
      Object.entries(byYear)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .forEach(([year, count]) => {
          console.log(`    ${year}: ${count} snapshots`);
        });
      
      // Sample recent snapshots
      console.log('\n  Recent snapshots (last 5):');
      snapshots.slice(-5).forEach(snap => {
        const timestamp = snap[1];
        const date = `${timestamp.substring(0, 4)}-${timestamp.substring(4, 6)}-${timestamp.substring(6, 8)}`;
        const url = `https://web.archive.org/web/${timestamp}/https://deepstatemap.live/`;
        console.log(`    ${date}: ${url}`);
      });
      
      return snapshots;
    }
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`);
    return [];
  }
}

async function checkGitHubRepos() {
  console.log('\n' + '='.repeat(70));
  console.log('Searching GitHub for Ukraine Territorial Data');
  console.log('='.repeat(70));
  
  // GitHub Search API (no auth - limited requests)
  const searchQueries = [
    'ukraine territory control geojson',
    'ukraine war map data',
    'deepstatemap data',
    'ukraine oblast control json'
  ];
  
  for (const query of searchQueries.slice(0, 2)) { // Limit to avoid rate limits
    try {
      console.log(`\nSearching: "${query}"`);
      const encodedQuery = encodeURIComponent(query);
      const url = `https://api.github.com/search/repositories?q=${encodedQuery}&sort=updated&order=desc`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'UkraineDataResearch',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (response.status === 403) {
        console.log('  ⚠ Rate limited by GitHub API');
        continue;
      }
      
      if (response.ok) {
        const data = await response.json();
        console.log(`  ✓ Found ${data.total_count} repositories`);
        
        if (data.items && data.items.length > 0) {
          console.log('\n  Top results:');
          data.items.slice(0, 3).forEach(repo => {
            console.log(`    - ${repo.full_name}`);
            console.log(`      ${repo.description || 'No description'}`);
            console.log(`      URL: ${repo.html_url}`);
            console.log(`      Updated: ${repo.updated_at}`);
            console.log('');
          });
        }
      }
    } catch (error) {
      console.log(`  ✗ Error: ${error.message}`);
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function checkKaggle() {
  console.log('\n' + '='.repeat(70));
  console.log('Checking Kaggle for Ukraine Datasets');
  console.log('='.repeat(70));
  
  // Kaggle doesn't have a public search API without authentication
  // Provide manual search guidance
  console.log(`
Kaggle requires authentication for API access.

Manual search recommended:
1. Visit: https://www.kaggle.com/datasets?search=ukraine+war
2. Look for:
   - "Ukraine Conflict Data"
   - "Russia-Ukraine War" 
   - "Ukraine Territorial Control"
   - "DeepStateMap" exports

3. Check dataset descriptions for:
   - Date ranges (2022-present)
   - GeoJSON/Shapefile formats
   - Daily/historical snapshots

Note: Many Kaggle datasets are user-contributed and may have gaps.
  `);
}

function generateReport(allResults) {
  console.log('\n' + '='.repeat(70));
  console.log('HISTORICAL DATA SOURCES - SUMMARY REPORT');
  console.log('='.repeat(70));
  
  console.log(`
SUMMARY OF FINDINGS
====================

1. DEEPSTATEMAP OFFICIAL API
   ✗ Historical endpoint requires authentication
   ✗ No public access to previous days
   ✓ Current data available at /api/history/last

2. INTERNET ARCHIVE (WAYBACK MACHINE)
   ? Status: Check above for snapshot availability
   ? Can capture rendered maps but not raw GeoJSON API responses
   ? Would need to scrape visual maps (hard)

3. GITHUB COMMUNITY DATA
   ? Repositories may exist with scraped historical data
   ? Recommend manual search for "ukraine-territory-data"

4. KAGGLE DATASETS
   ? User-contributed datasets may have time-series
   ? Requires manual browsing

5. ACADEMIC/NGO SOURCES
   ? ISW (understandingwar.org) - PDF maps daily
   ? Crisis Group - periodic reports
   ? Humanitarian Data Exchange - possible admin boundaries

RECOMMENDED ACTIONS FOR HISTORICAL DATA
=======================================

OPTION A: Wayback Machine Scraping (Hard)
   - Use Wayback CDX API to find all snapshots
   - Visit each snapshot, extract API calls from browser dev tools
   - Time-consuming but technically possible

OPTION B: Community Data Hunt
   - Search GitHub for "ukraine control map json"
   - Check r/datasets, r/ukraine for shared data
   - Contact OSINT Twitter accounts that track control

OPTION C: ISW Data Extraction
   - ISW publishes daily PDF with control maps
   - Would need OCR/image processing to extract boundaries
   - More reliable but labor-intensive

OPTION D: Hybrid Approach (RECOMMENDED)
   1. START daily collection NOW (using daily-extract.js)
   2. Search for community datasets covering 2022-2026
   3. Backfill gaps with ISW/Crisis Group manual data
   4. Build time-series from available sources

IMMEDIATE NEXT STEPS
====================
1. Run daily-extract.js to start collecting today
2. Search GitHub: https://github.com/search?q=ukraine+territory+geojson
3. Check Kaggle manually
4. Set up Wayback scraping if desperate for historical
  `);
  
  // Save report
  const reportFile = './explore-historical-report.txt';
  // Note: Console output serves as report
}

async function main() {
  console.log('='.repeat(70));
  console.log('EXPLORING HISTORICAL UKRAINE TERRITORIAL DATA SOURCES');
  console.log('='.repeat(70));
  console.log(`Start time: ${new Date().toISOString()}\n`);
  
  const allResults = {
    apiTests: [],
    wayback: [],
    github: [],
    kaggle: null
  };
  
  // 1. Test DeepStateMap historical endpoints
  allResults.apiTests = await testEndpoints();
  
  // 2. Check Wayback Machine
  allResults.wayback = await searchWaybackMachine();
  
  // 3. Search GitHub
  await checkGitHubRepos();
  
  // 4. Kaggle guidance
  await checkKaggle();
  
  // 5. Generate summary
  generateReport(allResults);
  
  console.log('\n' + '='.repeat(70));
  console.log('Exploration complete');
  console.log('='.repeat(70));
}

main().catch(console.error);
