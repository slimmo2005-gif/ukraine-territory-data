#!/usr/bin/env node
/**
 * Backfill daily DeepState snapshots for April/May 2026.
 * - Fetches closest Wayback snapshot per target day
 * - Converts raw snapshot into frontend schema via daily-extract-v2 processor
 * - Saves normalized files into data/history
 * - If yesterday is backfilled, regenerates today's file so daily deltas are accurate
 */

import fs from 'fs';
import path from 'path';
import { processData, saveData } from './daily-extract-v2.js';

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
    limit: '40'
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
  }, 20000);

  if (!res.ok) throw new Error(`Snapshot ${timestamp} HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    const preview = (await res.text()).slice(0, 120);
    throw new Error(`Snapshot ${timestamp} non-json (${contentType}): ${preview}`);
  }
  const data = await res.json();
  if (!data?.map?.features?.length) throw new Error(`Snapshot ${timestamp} empty features`);
  return data;
}

async function fetchBestSnapshotForDate(date) {
  for (const windowDays of [0, 1, 3, 7]) {
    let candidates = [];
    try {
      candidates = await cdxLookup(date, windowDays);
    } catch (error) {
      continue;
    }
    if (candidates.length === 0) continue;

    for (const c of candidates.slice(0, 8)) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const raw = await fetchSnapshot(c.timestamp);
          return { raw, timestamp: c.timestamp, sourceDate: dateFromStamp(c.timestamp.slice(0, 8)) };
        } catch (error) {
          if (attempt === 2) break;
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
  }
  return null;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = process.env.START_DATE || '2026-04-01';
  const endDate = process.env.END_DATE || today;
  const dates = generateDates(startDate, endDate);

  const summary = {
    attempted: dates.length,
    success: [],
    failed: [],
    skipped: []
  };

  for (const date of dates) {
    console.log(`Processing ${date}...`);
    const historyPath = path.join(HISTORY_DIR, `${date}.json`);
    if (fs.existsSync(historyPath) && date !== today) {
      summary.skipped.push(date);
      continue;
    }

    const result = await fetchBestSnapshotForDate(date);
    if (!result) {
      summary.failed.push(date);
      continue;
    }

    const rawPath = path.join(RAW_DIR, `${date}.raw.json`);
    fs.writeFileSync(rawPath, JSON.stringify(result.raw, null, 2));

    // Keep backfill logs readable while processing many dates.
    const originalLog = console.log;
    console.log = () => {};
    const normalized = processData(result.raw, date);
    console.log = originalLog;
    fs.writeFileSync(historyPath, JSON.stringify(normalized, null, 2));

    summary.success.push({
      date,
      snapshot_timestamp: result.timestamp,
      source_date: result.sourceDate
    });
  }

  // If yesterday was newly backfilled, regenerate today so change fields are based on it.
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const todayStr = today;
  const yesterdayWasAdded = summary.success.some((s) => s.date === yesterdayStr);
  if (yesterdayWasAdded) {
    const yHistory = path.join(HISTORY_DIR, `${yesterdayStr}.json`);
    const yMain = path.join('./data', `${yesterdayStr}.json`);
    if (fs.existsSync(yHistory)) {
      fs.copyFileSync(yHistory, yMain);
    }

    const todayResult = await fetchBestSnapshotForDate(todayStr);
    if (todayResult) {
      const originalLog = console.log;
      console.log = () => {};
      const normalizedToday = processData(todayResult.raw, todayStr);
      console.log = originalLog;
      saveData(normalizedToday);
      summary.success.push({
        date: todayStr,
        snapshot_timestamp: todayResult.timestamp,
        source_date: todayResult.sourceDate,
        regenerated_for_delta: true
      });
    }
  }

  const reportPath = `./backfill_2026_apr_may_report_${startDate}_to_${endDate}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log('Backfill complete');
  console.log(`Attempted: ${summary.attempted}`);
  console.log(`Success: ${summary.success.length}`);
  console.log(`Failed: ${summary.failed.length}`);
  console.log(`Skipped: ${summary.skipped.length}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});

