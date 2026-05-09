/**
 * Legacy: writes raw Wayback-shaped JSON into data/history/ (conflicts with daily JSON).
 * For 2026+ frontend-compatible weekly series use: build-weekly-history.js
 *   → data/history/weekly/YYYY-MM-DD.json (same schema as daily-extract-v2).
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
const HISTORY_DIR = './data/history';

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// Use global fetch (available in Node 18+)
const fetch = globalThis.fetch;
const TARGET_URL = 'https://deepstatemap.live/api/history/last';

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  return await Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Generate weekly dates from start to end
 */
function generateWeeklyDates(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

/**
 * Generate all dates in a range (for filling gaps)
 */
function generateDailyDates(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function toDateStamp(date) {
  return date.replace(/-/g, '');
}

function parseWindowDays() {
  const raw = process.env.WINDOW_DAYS || '7,14,30';
  const parsed = raw
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : [7, 14, 30];
}

function buildCdxUrl(fromDate, toDate, limit = 20) {
  const params = new URLSearchParams({
    url: TARGET_URL,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype',
    filter: 'statuscode:200',
    from: fromDate,
    to: toDate,
    limit: String(limit)
  });
  return `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
}

function sortByDistanceFromDate(candidates, date) {
  const targetEpoch = Date.parse(`${date}T12:00:00Z`);
  return [...candidates].sort((a, b) => {
    const aEpoch = Date.parse(
      `${a.timestamp.slice(0, 4)}-${a.timestamp.slice(4, 6)}-${a.timestamp.slice(6, 8)}T${a.timestamp.slice(8, 10)}:${a.timestamp.slice(10, 12)}:${a.timestamp.slice(12, 14)}Z`
    );
    const bEpoch = Date.parse(
      `${b.timestamp.slice(0, 4)}-${b.timestamp.slice(4, 6)}-${b.timestamp.slice(6, 8)}T${b.timestamp.slice(8, 10)}:${b.timestamp.slice(10, 12)}:${b.timestamp.slice(12, 14)}Z`
    );
    return Math.abs(aEpoch - targetEpoch) - Math.abs(bEpoch - targetEpoch);
  });
}

async function queryCdxSnapshots(date, windowDays = 7) {
  const dateObj = new Date(`${date}T00:00:00Z`);
  const from = new Date(dateObj);
  const to = new Date(dateObj);
  from.setDate(from.getDate() - windowDays);
  to.setDate(to.getDate() + windowDays);
  const fromDate = from.toISOString().slice(0, 10).replace(/-/g, '');
  const toDate = to.toISOString().slice(0, 10).replace(/-/g, '');

  const cdxUrl = buildCdxUrl(fromDate, toDate, 30);
  let rows = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchWithTimeout(cdxUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, 15000);

      if (!response.ok) {
        if (response.status >= 500 && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
          continue;
        }
        throw new Error(`CDX query failed (${response.status})`);
      }

      rows = await response.json();
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
    }
  }

  if (!rows) {
    throw lastError || new Error('CDX query failed');
  }
  if (!Array.isArray(rows) || rows.length <= 1) {
    return [];
  }

  // rows[0] is header
  const parsed = rows.slice(1).map((r) => ({
    timestamp: r[0],
    original: r[1],
    statuscode: r[2],
    mimetype: r[3]
  }));

  return sortByDistanceFromDate(parsed, date);
}

async function fetchWaybackRawSnapshot(timestamp) {
  const rawUrl = `https://web.archive.org/web/${timestamp}id_/${TARGET_URL}`;
  const response = await fetchWithTimeout(rawUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    },
    redirect: 'follow'
  }, 20000);

  if (!response.ok) {
    const preview = (await response.text()).slice(0, 200);
    throw new Error(`Snapshot ${timestamp} failed (${response.status}): ${preview}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    const preview = (await response.text()).slice(0, 200);
    throw new Error(`Snapshot ${timestamp} not JSON (${contentType}): ${preview}`);
  }

  const data = await response.json();
  if (!data?.map?.features || data.map.features.length === 0) {
    throw new Error(`Snapshot ${timestamp} missing map features`);
  }

  return data;
}

/**
 * Try to fetch a snapshot from Wayback Machine
 */
async function fetchWaybackSnapshot(date) {
  const windowDaysList = parseWindowDays();
  for (const windowDays of windowDaysList) {
    console.log(`   Querying CDX index around ${date} (+/-${windowDays} days)...`);

    let candidates = [];
    try {
      candidates = await queryCdxSnapshots(date, windowDays);
    } catch (error) {
      console.log(`   CDX lookup failed: ${error.message}`);
      continue;
    }

    if (candidates.length === 0) {
      console.log(`   No archived captures found in +/-${windowDays} day window`);
      continue;
    }

    console.log(`   Found ${candidates.length} candidate snapshots`);

    for (const candidate of candidates.slice(0, 8)) {
      console.log(`   Trying snapshot ${candidate.timestamp}...`);
      try {
        const data = await fetchWaybackRawSnapshot(candidate.timestamp);
        return {
          success: true,
          data,
          timestamp: candidate.timestamp,
          window_days: windowDays
        };
      } catch (error) {
        console.log(`   Snapshot rejected: ${error.message}`);
      }
    }
  }

  return { success: false };
}

/**
 * Alternative: Try to scrape from the main page if API doesn't work
 */
async function scrapeMainPage(date) {
  const dateStr = date.replace(/-/g, '');
  const waybackUrl = `https://web.archive.org/web/${dateStr}000000/https://deepstatemap.live/`;
  
  console.log(`   Trying main page scraping...`);
  
  try {
    const response = await fetchWithTimeout(waybackUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, 15000);
    
    if (response.ok) {
      const html = await response.text();
      
      // Look for embedded GeoJSON data in the page
      const geojsonMatch = html.match(/var\s+geojson\s*=\s*(\{.*?\});/s) ||
                           html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\});/s) ||
                           html.match(/"features"\s*:\s*(\[.*?\])/s);
      
      if (geojsonMatch) {
        try {
          const data = JSON.parse(geojsonMatch[1]);
          if (data.features || data.map?.features) {
            return { 
              success: true, 
              data: data.features ? { map: { features: data.features } } : data 
            };
          }
        } catch (e) {
          // Not valid JSON
        }
      }
    }
  } catch (error) {
    // Silent fail
  }
  
  return { success: false };
}

/**
 * Process and save a snapshot
 */
function saveSnapshot(date, data) {
  // Add metadata
  const snapshot = {
    date: date,
    source: 'wayback_machine',
    extracted_at: new Date().toISOString(),
    id: data.id || Date.parse(date) / 1000,
    datetime: data.datetime || new Date(date).toISOString(),
    map: data.map || data
  };
  
  // Save to history directory
  const fileName = path.join(HISTORY_DIR, `${date}.json`);
  fs.writeFileSync(fileName, JSON.stringify(snapshot, null, 2));
  
  return fileName;
}

/**
 * Main extraction function
 */
async function extractWeeklyHistory() {
  console.log('='.repeat(60));
  console.log('Weekly Historical Data Extraction');
  console.log('='.repeat(60));
  console.log('');
  
  // Generate weekly dates from week before invasion to end of April 2026
  const startDate = process.env.START_DATE || '2022-02-17';
  const endDate = process.env.END_DATE || '2026-04-30';
  const weeklyDates = generateWeeklyDates(startDate, endDate);
  const maxDates = Number(process.env.MAX_DATES || 0);
  const datesToProcess = maxDates > 0 ? weeklyDates.slice(0, maxDates) : weeklyDates;
  console.log(`Total weeks to process: ${weeklyDates.length}`);
  console.log(`From: ${weeklyDates[0]} To: ${weeklyDates[weeklyDates.length - 1]}`);
  console.log(`Search windows: ${parseWindowDays().map((d) => `+/-${d}`).join(', ')} days`);
  if (maxDates > 0) {
    console.log(`Test mode enabled: processing first ${datesToProcess.length} dates`);
  }
  console.log('');
  
  const results = {
    success: [],
    failed: [],
    skipped: []
  };
  
  for (let i = 0; i < datesToProcess.length; i++) {
    const date = datesToProcess[i];
    
    console.log(`[${i + 1}/${datesToProcess.length}] Processing ${date}...`);
    
    // Check if we already have this date
    const existingFile = path.join(HISTORY_DIR, `${date}.json`);
    if (fs.existsSync(existingFile)) {
      console.log('   ✓ Already exists, skipping');
      results.skipped.push(date);
      continue;
    }
    
    // Try to fetch from Wayback Machine
    const waybackResult = await fetchWaybackSnapshot(date);
    
    if (waybackResult.success) {
      const fileName = saveSnapshot(date, waybackResult.data);
      console.log(`   ✓ SUCCESS - Saved to ${fileName}`);
      results.success.push({
        date,
        timestamp: waybackResult.timestamp,
        window_days: waybackResult.window_days,
        features: waybackResult.data.map?.features?.length
      });
    } else {
      // Try alternative scraping method
      const scrapeResult = await scrapeMainPage(date);
      
      if (scrapeResult.success) {
        const fileName = saveSnapshot(date, scrapeResult.data);
        console.log(`   ✓ SUCCESS (scraped) - Saved to ${fileName}`);
        results.success.push({ date, method: 'scraped' });
      } else {
        console.log('   ✗ Not available');
        results.failed.push(date);
      }
    }
    
    // Rate limiting - be respectful to Wayback Machine
    if (i < datesToProcess.length - 1) {
      console.log('   Waiting 3 seconds...');
      await new Promise(r => setTimeout(r, 3000));
    }
    
    // Save progress report every 10 dates
    if ((i + 1) % 10 === 0) {
      saveProgressReport(results, datesToProcess.length);
    }
  }
  
  // Final summary
  saveProgressReport(results, datesToProcess.length, true);
  
  return results;
}

/**
 * Save progress report
 */
function saveProgressReport(results, total, isFinal = false) {
  const attempted = total - results.skipped.length;
  const successRate = attempted > 0
    ? ((results.success.length / attempted) * 100).toFixed(1) + '%'
    : '0.0%';

  const report = {
    timestamp: new Date().toISOString(),
    total_dates: total,
    processed: results.success.length + results.failed.length + results.skipped.length,
    successful: results.success.length,
    failed: results.failed.length,
    skipped: results.skipped.length,
    success_rate: successRate,
    successful_dates: results.success,
    failed_dates: results.failed,
    remaining_dates: results.failed
  };
  
  const fileName = isFinal ? './extraction_report_final.json' : './extraction_report_progress.json';
  fs.writeFileSync(fileName, JSON.stringify(report, null, 2));
  
  if (isFinal) {
    console.log('\n' + '='.repeat(60));
    console.log('EXTRACTION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total dates: ${total}`);
    console.log(`Successful: ${results.success.length} (${report.success_rate})`);
    console.log(`Failed: ${results.failed.length}`);
    console.log(`Skipped (already had): ${results.skipped.length}`);
    console.log(`\nReport saved to: ${fileName}`);
    console.log('\nData saved in: ./data/history/');
  }
}

// Run the extraction
extractWeeklyHistory().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
