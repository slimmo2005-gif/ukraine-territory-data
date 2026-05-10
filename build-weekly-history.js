#!/usr/bin/env node
/**
 * Weekly territory snapshots (same JSON schema as daily-extract-v2), from Wayback Machine.
 * - Anchors: every 7 days UTC starting START_DATE (default 2026-01-01) through END_DATE (default today).
 * - Output: data/history/weekly/YYYY-MM-DD.json only (does not touch daily data/history/*.json).
 * - FORCE_WEEKLY=1 overwrite; ONLY_MISSING=1 skip existing weekly files; MAX_WEEKS=N test cap
 * After a successful run, week-over-week deltas are recomputed across consecutive weekly files.
 */

import fs from 'fs';
import path from 'path';
import { processData } from './daily-extract-v2.js';
import { recomputeWeeklyDeltasForDir } from './recompute-weekly-deltas.js';

const WEEKLY_DIR = './data/history/weekly';
const RAW_DIR = './data/raw-history/weekly';
const TARGET_URL = 'https://deepstatemap.live/api/history/last';

if (!fs.existsSync(WEEKLY_DIR)) fs.mkdirSync(WEEKLY_DIR, { recursive: true });
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

function dateToStamp(date) {
  return date.replace(/-/g, '');
}

function dateFromStamp(stamp) {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

/** Inclusive of start; each anchor is 00:00 UTC; +7 days until > end */
function generateWeeklyAnchorsUTC(startDate, endDate) {
  const dates = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let d = new Date(`${startDate}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
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
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        Accept: 'application/json'
      }
    },
    45000
  );

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
    } catch {
      continue;
    }
    if (candidates.length === 0) continue;

    for (const c of candidates.slice(0, 16)) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const raw = await fetchSnapshot(c.timestamp);
          return { raw, timestamp: c.timestamp, sourceDate: dateFromStamp(c.timestamp.slice(0, 8)) };
        } catch {
          if (attempt === 3) break;
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
      }
    }
  }
  return null;
}

/** Last resort: any CDX capture in the anchor year, closest in time to `date`. */
async function cdxLookupWholeYear(date, limit = 2500) {
  const y = date.slice(0, 4);
  const params = new URLSearchParams({
    url: TARGET_URL,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype',
    filter: 'statuscode:200',
    from: `${y}0101`,
    to: `${y}1231`,
    limit: String(limit)
  });
  const url = `https://web.archive.org/cdx/search/cdx?${params.toString()}`;
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, 25000);
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

async function fetchBestSnapshotWholeYear(date) {
  let candidates = [];
  try {
    candidates = await cdxLookupWholeYear(date);
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;
  for (const c of candidates.slice(0, 24)) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const raw = await fetchSnapshot(c.timestamp);
        return { raw, timestamp: c.timestamp, sourceDate: dateFromStamp(c.timestamp.slice(0, 8)) };
      } catch {
        if (attempt === 3) break;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }
  return null;
}

function findNearestDailyJson(anchorDate, dataDir, maxDays) {
  const target = Date.parse(`${anchorDate}T12:00:00Z`);
  const maxMs = maxDays * 86400000;
  let bestPath = null;
  let bestDiff = Infinity;
  let bestName = null;
  if (!fs.existsSync(dataDir)) return null;
  for (const name of fs.readdirSync(dataDir)) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const t = Date.parse(`${m[1]}T12:00:00Z`);
    const diff = Math.abs(t - target);
    if (diff <= maxMs && diff < bestDiff) {
      bestDiff = diff;
      bestPath = path.join(dataDir, name);
      bestName = m[1];
    }
  }
  if (!bestPath) return null;
  return { path: bestPath, dailyDate: bestName, dayOffset: Math.round(bestDiff / 86400000) };
}

function weeklySnapshotFromNearestDaily(anchorDate, bridge) {
  const cloned = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(bridge.path, 'utf8'))));
  cloned.date = anchorDate;
  cloned.granularity = 'weekly';
  cloned.snapshot_source = 'daily_nearest';
  cloned.derived_from_daily = bridge.dailyDate;
  cloned.daily_bridge_day_offset = bridge.dayOffset;
  delete cloned.wayback_timestamp;
  delete cloned.wayback_capture_date;
  delete cloned.derived_from_weekly;
  cloned.last_updated = new Date().toISOString();
  return cloned;
}

function findNearestWeeklyJson(anchorDate, weeklyDir, maxDays) {
  const target = Date.parse(`${anchorDate}T12:00:00Z`);
  const maxMs = maxDays * 86400000;
  let bestPath = null;
  let bestDiff = Infinity;
  let bestName = null;
  if (!fs.existsSync(weeklyDir)) return null;
  for (const name of fs.readdirSync(weeklyDir)) {
    const m = name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m || m[1] === anchorDate) continue;
    const t = Date.parse(`${m[1]}T12:00:00Z`);
    const diff = Math.abs(t - target);
    if (diff <= maxMs && diff < bestDiff) {
      bestDiff = diff;
      bestPath = path.join(weeklyDir, name);
      bestName = m[1];
    }
  }
  if (!bestPath) return null;
  return { path: bestPath, weeklyDate: bestName, dayOffset: Math.round(bestDiff / 86400000) };
}

function weeklySnapshotFromNearestWeekly(anchorDate, bridge) {
  const cloned = JSON.parse(JSON.stringify(JSON.parse(fs.readFileSync(bridge.path, 'utf8'))));
  cloned.date = anchorDate;
  cloned.granularity = 'weekly';
  cloned.snapshot_source = 'weekly_nearest';
  cloned.derived_from_weekly = bridge.weeklyDate;
  cloned.weekly_bridge_day_offset = bridge.dayOffset;
  delete cloned.wayback_timestamp;
  delete cloned.wayback_capture_date;
  delete cloned.derived_from_daily;
  delete cloned.daily_bridge_day_offset;
  cloned.last_updated = new Date().toISOString();
  return cloned;
}

function saveWeeklyJson(data) {
  const file = path.join(WEEKLY_DIR, `${data.date}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

async function main() {
  const startDate = process.env.START_DATE || '2026-01-01';
  let endDate = process.env.END_DATE || new Date().toISOString().slice(0, 10);
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (process.env.ALLOW_FUTURE_WEEKLY !== '1' && process.env.ALLOW_FUTURE_WEEKLY !== 'true') {
    if (endDate > todayUtc) {
      console.log(`Clamping END_DATE ${endDate} to today (${todayUtc}) — set ALLOW_FUTURE_WEEKLY=1 to override.`);
      endDate = todayUtc;
    }
  }
  const force = process.env.FORCE_WEEKLY === '1' || process.env.FORCE_WEEKLY === 'true';
  const onlyMissing =
    !force && (process.env.ONLY_MISSING === '1' || process.env.ONLY_MISSING === 'true');
  const maxWeeks = Number(process.env.MAX_WEEKS || '0');
  const delayMs = Number(process.env.WEEKLY_DELAY_MS || '2000');
  const maxBridgeDays = Number(process.env.MAX_DAILY_BRIDGE_DAYS || '7');
  const maxWeeklyBridgeDays = Number(process.env.MAX_WEEKLY_BRIDGE_DAYS || '10');
  const useDailyBridge = process.env.USE_DAILY_BRIDGE !== '0' && process.env.USE_DAILY_BRIDGE !== 'false';
  const useWeeklyBridge = process.env.USE_WEEKLY_BRIDGE !== '0' && process.env.USE_WEEKLY_BRIDGE !== 'false';
  const dataDir = path.resolve(process.env.DAILY_DATA_DIR || './data');

  let anchors = generateWeeklyAnchorsUTC(startDate, endDate);
  if (maxWeeks > 0) anchors = anchors.slice(0, maxWeeks);

  const summary = { attempted: anchors.length, success: [], failed: [], skipped: [] };

  console.log(`Weekly anchors: ${anchors.length} (${anchors[0]} … ${anchors[anchors.length - 1]})`);
  console.log(`Output: ${WEEKLY_DIR}`);

  for (let i = 0; i < anchors.length; i++) {
    const date = anchors[i];
    const outPath = path.join(WEEKLY_DIR, `${date}.json`);
    console.log(`[${i + 1}/${anchors.length}] ${date}`);

    if (onlyMissing && fs.existsSync(outPath)) {
      summary.skipped.push(date);
      continue;
    }
    if (!force && fs.existsSync(outPath)) {
      summary.skipped.push(date);
      continue;
    }

    let result = await fetchBestSnapshotForDate(date);
    if (!result) {
      console.log('  Trying whole-year CDX window…');
      result = await fetchBestSnapshotWholeYear(date);
    }

    if (result) {
      fs.writeFileSync(path.join(RAW_DIR, `${date}.raw.json`), JSON.stringify(result.raw, null, 2));

      const originalLog = console.log;
      console.log = () => {};
      let normalized;
      try {
        normalized = processData(result.raw, date);
      } catch (e) {
        console.log = originalLog;
        console.warn(`  processData failed: ${e.message}`);
        result = null;
      }
      console.log = originalLog;

      if (normalized) {
        normalized.granularity = 'weekly';
        normalized.snapshot_source = 'wayback';
        normalized.wayback_timestamp = result.timestamp;
        normalized.wayback_capture_date = result.sourceDate;

        saveWeeklyJson(normalized);
        console.log(`  ✓ wayback ${result.timestamp} (capture ~${result.sourceDate})`);
        summary.success.push({ date, wayback_timestamp: result.timestamp });
      }
    }

    if (!result && useDailyBridge) {
      const bridge = findNearestDailyJson(date, dataDir, maxBridgeDays);
      if (bridge) {
        const normalized = weeklySnapshotFromNearestDaily(date, bridge);
        saveWeeklyJson(normalized);
        console.log(`  ✓ daily bridge ${bridge.dailyDate} (±${bridge.dayOffset}d) → weekly anchor`);
        summary.success.push({ date, derived_from_daily: bridge.dailyDate });
      } else if (useWeeklyBridge) {
        const wk = findNearestWeeklyJson(date, WEEKLY_DIR, maxWeeklyBridgeDays);
        if (wk) {
          saveWeeklyJson(weeklySnapshotFromNearestWeekly(date, wk));
          console.log(`  ✓ weekly bridge ${wk.weeklyDate} (±${wk.dayOffset}d) → anchor`);
          summary.success.push({ date, derived_from_weekly: wk.weeklyDate });
        } else {
          console.warn(`  No Wayback / daily / weekly bridge for ${date}`);
          summary.failed.push(date);
        }
      } else {
        console.warn(`  No Wayback or daily bridge for ${date}`);
        summary.failed.push(date);
      }
    } else if (!result) {
      console.warn(`  No snapshot for ${date}`);
      summary.failed.push(date);
    }

    if (i < anchors.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // Re-run failed anchors once (Wayback can be flaky). Process newest→oldest so
  // weekly_nearest bridges can copy from an already-retried neighbor week.
  const failedOnce = [...summary.failed].sort((a, b) => b.localeCompare(a));
  summary.failed = [];
  for (const date of failedOnce) {
    const outPath = path.join(WEEKLY_DIR, `${date}.json`);
    if (fs.existsSync(outPath)) continue;
    console.log(`Retry ${date}…`);
    let result = await fetchBestSnapshotForDate(date);
    if (!result) result = await fetchBestSnapshotWholeYear(date);
    if (result) {
      const originalLog = console.log;
      console.log = () => {};
      let normalized;
      try {
        normalized = processData(result.raw, date);
      } catch {
        normalized = null;
      }
      console.log = originalLog;
      if (normalized) {
        normalized.granularity = 'weekly';
        normalized.snapshot_source = 'wayback';
        normalized.wayback_timestamp = result.timestamp;
        normalized.wayback_capture_date = result.sourceDate;
        saveWeeklyJson(normalized);
        summary.success.push({ date, wayback_timestamp: result.timestamp, retry: true });
        continue;
      }
    }
    if (useDailyBridge) {
      const bridge = findNearestDailyJson(date, dataDir, maxBridgeDays);
      if (bridge) {
        saveWeeklyJson(weeklySnapshotFromNearestDaily(date, bridge));
        summary.success.push({ date, derived_from_daily: bridge.dailyDate, retry: true });
        continue;
      }
    }
    if (useWeeklyBridge) {
      const wk = findNearestWeeklyJson(date, WEEKLY_DIR, maxWeeklyBridgeDays);
      if (wk) {
        saveWeeklyJson(weeklySnapshotFromNearestWeekly(date, wk));
        summary.success.push({ date, derived_from_weekly: wk.weeklyDate, retry: true });
        continue;
      }
    }
    summary.failed.push(date);
  }

  if (anchors.length > 0) {
    const deltaEnd = endDate > todayUtc ? endDate : todayUtc;
    const updated = recomputeWeeklyDeltasForDir(path.resolve(WEEKLY_DIR), startDate, deltaEnd);
    console.log(`Recomputed week-over-week deltas for ${updated} weekly files (${startDate}…${deltaEnd}).`);
  }

  const reportPath = './weekly_build_report.json';
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log('\nDone.');
  console.log(`Success: ${summary.success.length}, failed: ${summary.failed.length}, skipped: ${summary.skipped.length}`);
  console.log(`Report: ${reportPath}`);
  if (summary.failed.length) console.log('Failed dates:', summary.failed.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
