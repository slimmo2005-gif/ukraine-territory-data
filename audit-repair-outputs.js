#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import {
  applyPlausibilityCorrections,
  canonicalizeOblastRows,
  enforceOccupiedEnclaveCompletion,
  normalizeOblastRow,
  recalculateTopLevelTotals,
  validateDailyData,
  round2
} from './territory-validation.js';

const HISTORY_DIR = './data/history';
const MAIN_DIR = './data';

function dateRange(start, end) {
  const dates = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function diffOblasts(before, after) {
  const changes = [];
  const byKeyBefore = new Map(before.oblasts.map((o) => [o.oblast, o]));
  const byKeyAfter = new Map(after.oblasts.map((o) => [o.oblast, o]));
  for (const [key, a] of byKeyAfter.entries()) {
    const b = byKeyBefore.get(key);
    if (!b) continue;
    const tracked = ['russian_controlled_km2', 'ukrainian_controlled_km2', 'disputed_controlled_km2'];
    const delta = {};
    let touched = false;
    for (const f of tracked) {
      if (round2(b[f]) !== round2(a[f])) {
        touched = true;
        delta[f] = { before: round2(b[f]), after: round2(a[f]) };
      }
    }
    if (touched) changes.push({ oblast: key, fields: delta });
  }
  return changes;
}

function writeReport(report) {
  fs.writeFileSync('./validation_report.json', JSON.stringify(report, null, 2));
  const lines = [];
  lines.push('# Validation Report');
  lines.push('');
  lines.push(`- Dates checked: ${report.dates_checked}`);
  lines.push(`- Hard failures: ${report.hard_failures.length}`);
  lines.push(`- Warnings: ${report.warnings.length}`);
  lines.push(`- Corrected files: ${report.corrected_files.length}`);
  lines.push(`- Final status: ${report.final_status}`);
  lines.push('');
  lines.push('## Corrected Files');
  for (const c of report.corrected_files) {
    lines.push(`- ${c.date}: ${c.file}`);
    for (const oc of c.oblast_changes.slice(0, 8)) {
      lines.push(`  - ${oc.oblast}: ${Object.keys(oc.fields).join(', ')}`);
    }
  }
  fs.writeFileSync('./validation_report.md', lines.join('\n'));
}

async function main() {
  const start = process.env.START_DATE || '2026-04-01';
  const end = process.env.END_DATE || new Date().toISOString().slice(0, 10);
  const dates = dateRange(start, end);

  const report = {
    generated_at: new Date().toISOString(),
    range: { start, end },
    dates_checked: dates.length,
    hard_failures: [],
    warnings: [],
    corrected_files: [],
    final_status: 'PASS'
  };

  for (const date of dates) {
    const historyPath = path.join(HISTORY_DIR, `${date}.json`);
    if (!fs.existsSync(historyPath)) continue;

    const prevDate = new Date(`${date}T00:00:00Z`);
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const prevPath = path.join(HISTORY_DIR, `${prevDate.toISOString().slice(0, 10)}.json`);
    const prevData = fs.existsSync(prevPath) ? loadJson(prevPath) : null;

    const before = loadJson(historyPath);
    const repaired = clone(before);
    canonicalizeOblastRows(repaired);
    repaired.oblasts.forEach((row) => normalizeOblastRow(row));
    recalculateTopLevelTotals(repaired);

    const corrections = applyPlausibilityCorrections(repaired);
    enforceOccupiedEnclaveCompletion(repaired);
    recalculateTopLevelTotals(repaired);
    const validation = validateDailyData(repaired, prevData);

    if (validation.hardFailures.length > 0) {
      report.hard_failures.push({ date, file: historyPath, issues: validation.hardFailures });
      report.final_status = 'FAIL';
    }
    if (validation.warnings.length > 0) {
      report.warnings.push({ date, file: historyPath, issues: validation.warnings });
    }

    const oblastChanges = diffOblasts(before, repaired);
    const topChanged =
      round2(before.total_russian_controlled_km2) !== round2(repaired.total_russian_controlled_km2) ||
      round2(before.total_ukrainian_controlled_km2) !== round2(repaired.total_ukrainian_controlled_km2) ||
      round2(before.total_disputed_km2) !== round2(repaired.total_disputed_km2);

    if (oblastChanges.length > 0 || topChanged) {
      fs.writeFileSync(historyPath, JSON.stringify(repaired, null, 2));
      const mainPath = path.join(MAIN_DIR, `${date}.json`);
      if (fs.existsSync(mainPath)) {
        fs.writeFileSync(mainPath, JSON.stringify(repaired, null, 2));
      }
      report.corrected_files.push({
        date,
        file: historyPath,
        top_level_before: {
          russian: round2(before.total_russian_controlled_km2),
          ukrainian: round2(before.total_ukrainian_controlled_km2),
          disputed: round2(before.total_disputed_km2)
        },
        top_level_after: {
          russian: round2(repaired.total_russian_controlled_km2),
          ukrainian: round2(repaired.total_ukrainian_controlled_km2),
          disputed: round2(repaired.total_disputed_km2)
        },
        oblast_changes: oblastChanges
      });
    }
  }

  writeReport(report);
  console.log(`Validation status: ${report.final_status}`);
  console.log(`Hard failures: ${report.hard_failures.length}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`Corrected files: ${report.corrected_files.length}`);
  console.log('Reports written: validation_report.json, validation_report.md');
  if (report.final_status === 'FAIL') process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

