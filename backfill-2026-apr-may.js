#!/usr/bin/env node
/**
 * Backfill daily DeepState snapshots for April/May 2026.
 * - Fetches closest Wayback snapshot per target day
 * - Converts raw snapshot into frontend schema via daily-extract-v2 processor
 * - Writes both data/ and data/history/ (processData reads yesterday from data/ only)
 * - FORCE_REBACKFILL=1 overwrite; ONLY_MISSING=1 fetch gaps only; RETRY_ROUNDS=3
 */

import fs from 'fs';
import path from 'path';
import { fetchDeepStateData, processData, saveData } from './daily-extract-v2.js';

const HISTORY_DIR = './data/history';
const RAW_DIR = './data/raw-history';
const TARGET_URL = 'https://deepstatemap.live/api/history/last';

if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

function dateToStamp(date) {
  return date.replace(/-/g, '');
}

function dateFromStamp(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

function generateDates(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function parseTimestampToEpoch(timestamp) {
  const iso = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`;
  return Date.parse(iso);
}

function sortByDistance(targetDate, rows) {
  const targetEpoch = Date.parse(`${targetDate}T12:00:00Z`);
  return [...rows].sort((a, b) => {
    return Math.abs(parseTimestampToEpoch(a.timestamp) - targetEpoch) - Math.abs(parseTimestampToEpoch(b.timestamp) - targetEpoch);
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  return await Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs))
  ]);
}

async function cdxLookup(date, windowDays) {
  const center = new Date(`${date}T00:00:00Z`);
  const from = new Date(center);
  const to = new Date(center);
  from.setUTCDate(from.getUTCDate() - windowDays);
  to.setUTCDate(to.getUTCDate() + windowDays);

  const params = new URLSearchParams({
    url: TARGET_URL,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype',
    filter: 'statuscode:200',
    from: dateToStamp(from.toISOString().slice(0, 10)),
    to: dateToStamp(to.toISOString().slice(0, 10)),
    limit: '100'
  });

  const url = `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 15000);
  if (!res.ok) throw new Error(`CDX ${res.status}`);

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length <= 1) return [];
  const parsed = rows.slice(1).map((row) => ({
    timestamp: row[0],
    original: row[1],
    statuscode: row[2],
    mimetype: row[3]
  }));
  return sortByDistance(date, parsed);
}

async function fetchSnapshot(timestamp) {
  const url = `https://web.archive.org/web/${timestamp}id_/${TARGET_URL}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept': 'application/json'
    }
  }, 45000);

  if (!res.ok) throw new Error(`Snapshot ${timestamp} HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();
  let data;
  if (contentType.includes('json')) {
    data = JSON.parse(text);
  } else {
    const t = text.trim();
    if (!t.startsWith('{')) throw new Error(`Snapshot ${timestamp} non-json (${contentType}): ${t.slice(0, 120)}`);
    data = JSON.parse(t);
  }
  if (!data?.map?.features?.length) throw new Error(`Snapshot ${timestamp} empty features`);
  return data;
}

async function fetchBestSnapshotForDate(date) {
  for (const windowDays of [0, 1, 3, 7, 14, 30]) {
    let candidates = [];
    try {
      candidates = await cdxLookup(date, windowDays);
    } catch (error) {
      continue;
    }
    if (candidates.length === 0) continue;

    for (const c of candidates.slice(0, 16)) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const raw = await fetchSnapshot(c.timestamp);
          return { raw, timestamp: c.timestamp, sourceDate: dateFromStamp(c.timestamp.slice(0, 8)) };
        } catch (error) {
          if (attempt === 3) break;
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    }
  }
  return null;
}

async function runPass(dates, today, opts) {
  const { force, onlyMissing } = opts;
  const summary = {
    attempted: dates.length,
    success: [],
    failed: [],
    skipped: []
  };

  for (const date of dates) {
    console.log(`Processing ${date}...`);
    const mainDataPath = path.join('./data', `${date}.json`);

    if (onlyMissing && fs.existsSync(mainDataPath)) {
      summary.skipped.push(date);
      continue;
    }
    if (!onlyMissing && fs.existsSync(mainDataPath) && date !== today && !force) {
      summary.skipped.push(date);
      continue;
    }

    let result;
    if (date === today && process.env.WAYBACK_TODAY !== '1') {
      const live = await fetchDeepStateData();
      result = { raw: live, timestamp: 'live', sourceDate: today };
    } else {
      result = await fetchBestSnapshotForDate(date);
    }
    if (!result) {
      console.warn(`  No Wayback/live snapshot for ${date}`);
      summary.failed.push(date);
      continue;
    }

    const rawPath = path.join(RAW_DIR, `${date}.raw.json`);
    fs.writeFileSync(rawPath, JSON.stringify(result.raw, null, 2));

    let normalized;
    const originalLog = console.log;
    console.log = () => {};
    try {
      normalized = processData(result.raw, date);
    } catch (e) {
      console.log = originalLog;
      console.warn(`  processData failed ${date}: ${e.message}`);
      summary.failed.push(date);
      continue;
    }
    console.log = originalLog;
    saveData(normalized);

    summary.success.push({
      date,
      snapshot_timestamp: result.timestamp,
      source_date: result.sourceDate
    });
  }

  return summary;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = process.env.START_DATE || '2026-04-01';
  const endDate = process.env.END_DATE || today;
  const force =
    process.env.FORCE_REBACKFILL === '1' ||
    process.env.FORCE === '1' ||
    process.env.FORCE_REBACKFILL === 'true';
  // Avoid ONLY_MISSING sticking in the shell from an earlier run when forcing a redo.
  const onlyMissing =
    !force &&
    (process.env.ONLY_MISSING === '1' || process.env.ONLY_MISSING === 'true');
  const dates = generateDates(startDate, endDate);

  let merged = await runPass(dates, today, { force, onlyMissing });
  const maxRetries = Number(process.env.RETRY_ROUNDS || '3');
  for (let r = 0; r < maxRetries && merged.failed.length > 0; r++) {
    console.log(`\nRetry round ${r + 1} for ${merged.failed.length} failed dates...`);
    await new Promise((res) => setTimeout(res, 3000));
    const failedSet = new Set(merged.failed);
    merged.failed = [];
    const retryDates = dates.filter((d) => failedSet.has(d));
    const round = await runPass(retryDates, today, { force: true, onlyMissing: false });
    merged.success.push(...round.success);
    merged.failed = round.failed;
    merged.skipped.push(...round.skipped);
  }

  const reportPath = `./backfill_2026_apr_may_report_${startDate}_to_${endDate}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(merged, null, 2));

  console.log('Backfill complete');
  console.log(`Attempted: ${merged.attempted}`);
  console.log(`Success: ${merged.success.length}`);
  console.log(`Failed: ${merged.failed.length}`);
  console.log(`Skipped: ${merged.skipped.length}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});

