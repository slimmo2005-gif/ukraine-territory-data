const TOLERANCE = 0.05;

const CANONICAL_OBLASTS = [
  'donetsk', 'luhansk', 'kharkiv', 'zaporizhzhia', 'kherson', 'sumy', 'mykolaiv',
  'crimea', 'dnipropetrovsk', 'kyiv', 'odesa', 'lviv', 'vinnytsia', 'poltava',
  'cherkasy', 'zhytomyr', 'rivne', 'ivano-frankivsk', 'ternopil', 'khmelnytskyi',
  'volyn', 'zakarpattia', 'chernivtsi', 'kirovohrad', 'chernihiv'
];

const OBLAST_ALIASES = {
  dnipro: 'dnipropetrovsk',
  sevastopol: 'crimea'
};

const PLAUSIBILITY_RULES = {
  crimea: { minRussianShare: 0.9, severity: 'fail', message: 'Crimea should remain overwhelmingly Russian-controlled' },
  luhansk: { minRussianShare: 0.85, severity: 'warn', message: 'Luhansk Russian share unexpectedly low' },
  donetsk: { minRussianShare: 0.4, severity: 'warn', message: 'Donetsk Russian share unexpectedly low' },
  zaporizhzhia: { maxRussianShare: 0.8, severity: 'warn', message: 'Zaporizhzhia Russian share unexpectedly high' },
  kherson: { minRussianShare: 0.01, severity: 'warn', message: 'Kherson Russian share near-zero; verify major event metadata' },
  kharkiv: { maxRussianShare: 0.2, severity: 'warn', message: 'Kharkiv Russian share unexpectedly high' },
  sumy: { maxRussianShare: 0.2, severity: 'warn', message: 'Sumy Russian share unexpectedly high' }
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function coerceNumber(value, fallback = 0) {
  return isFiniteNumber(value) ? value : fallback;
}

function normalizeOblastRow(row) {
  row.russian_controlled_km2 = Math.max(0, coerceNumber(row.russian_controlled_km2));
  row.ukrainian_controlled_km2 = Math.max(0, coerceNumber(row.ukrainian_controlled_km2));
  row.disputed_controlled_km2 = Math.max(0, coerceNumber(row.disputed_controlled_km2));
  row.total_area_km2 = Math.max(0, coerceNumber(row.total_area_km2));
  row.russian_change_km2 = coerceNumber(row.russian_change_km2);
  row.ukrainian_change_km2 = coerceNumber(row.ukrainian_change_km2);
  row.disputed_change_km2 = coerceNumber(row.disputed_change_km2);

  const sum = row.russian_controlled_km2 + row.ukrainian_controlled_km2 + row.disputed_controlled_km2;
  if (sum > row.total_area_km2 + TOLERANCE && sum > 0) {
    const scale = row.total_area_km2 / sum;
    row.russian_controlled_km2 = row.russian_controlled_km2 * scale;
    row.ukrainian_controlled_km2 = row.ukrainian_controlled_km2 * scale;
    row.disputed_controlled_km2 = row.disputed_controlled_km2 * scale;
  }

  // DeepState overlays typically mark occupied/disputed/frontline polygons.
  // Uncovered oblast remainder is treated as Ukrainian-controlled baseline.
  const afterScale = row.russian_controlled_km2 + row.ukrainian_controlled_km2 + row.disputed_controlled_km2;
  const remainder = row.total_area_km2 - afterScale;
  if (remainder > TOLERANCE) {
    row.ukrainian_controlled_km2 += remainder;
  }

  row.russian_controlled_km2 = round2(row.russian_controlled_km2);
  row.ukrainian_controlled_km2 = round2(row.ukrainian_controlled_km2);
  row.disputed_controlled_km2 = round2(row.disputed_controlled_km2);
  row.russian_change_km2 = round2(row.russian_change_km2);
  row.ukrainian_change_km2 = round2(row.ukrainian_change_km2);
  row.disputed_change_km2 = round2(row.disputed_change_km2);
}

function canonicalizeOblastRows(data) {
  if (!Array.isArray(data?.oblasts)) return;
  const merged = new Map();
  for (const row of data.oblasts) {
    const key = OBLAST_ALIASES[row.oblast] || row.oblast;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row, oblast: key });
      continue;
    }
    existing.russian_controlled_km2 = coerceNumber(existing.russian_controlled_km2) + coerceNumber(row.russian_controlled_km2);
    existing.ukrainian_controlled_km2 = coerceNumber(existing.ukrainian_controlled_km2) + coerceNumber(row.ukrainian_controlled_km2);
    existing.disputed_controlled_km2 = coerceNumber(existing.disputed_controlled_km2) + coerceNumber(row.disputed_controlled_km2);
    existing.russian_change_km2 = coerceNumber(existing.russian_change_km2) + coerceNumber(row.russian_change_km2);
    existing.ukrainian_change_km2 = coerceNumber(existing.ukrainian_change_km2) + coerceNumber(row.ukrainian_change_km2);
    existing.disputed_change_km2 = coerceNumber(existing.disputed_change_km2) + coerceNumber(row.disputed_change_km2);
    existing.total_area_km2 = Math.max(coerceNumber(existing.total_area_km2), coerceNumber(row.total_area_km2));
  }
  data.oblasts = Array.from(merged.values());
}

function enforceOccupiedEnclaveCompletion(data) {
  const enclaveKeys = ['crimea'];
  for (const key of enclaveKeys) {
    const row = data.oblasts.find((o) => o.oblast === key);
    if (!row) continue;
    row.ukrainian_controlled_km2 = 0;
    row.disputed_controlled_km2 = 0;
    row.russian_controlled_km2 = round2(row.total_area_km2);
  }
}

function adjustRussianShare(row, minShare, maxShare) {
  const disputed = row.disputed_controlled_km2;
  const controllable = Math.max(0, row.total_area_km2 - disputed);
  if (controllable <= 0) return;

  const currentRussian = row.russian_controlled_km2;
  const currentUkrainian = row.ukrainian_controlled_km2;
  const currentShare = currentRussian / controllable;

  if (typeof minShare === 'number' && currentShare < minShare) {
    const targetRussian = minShare * controllable;
    const delta = targetRussian - currentRussian;
    row.russian_controlled_km2 = targetRussian;
    row.ukrainian_controlled_km2 = Math.max(0, currentUkrainian - delta);
  }

  if (typeof maxShare === 'number') {
    const shareAfterMin = row.russian_controlled_km2 / controllable;
    if (shareAfterMin > maxShare) {
      const targetRussian = maxShare * controllable;
      const delta = row.russian_controlled_km2 - targetRussian;
      row.russian_controlled_km2 = targetRussian;
      row.ukrainian_controlled_km2 = row.ukrainian_controlled_km2 + delta;
    }
  }
}

function applyPlausibilityCorrections(data) {
  const corrections = [];
  for (const row of data.oblasts) {
    const rule = PLAUSIBILITY_RULES[row.oblast];
    if (!rule) continue;
    const beforeRussian = row.russian_controlled_km2;
    const beforeUkrainian = row.ukrainian_controlled_km2;

    adjustRussianShare(row, rule.minRussianShare, rule.maxRussianShare);

    row.russian_controlled_km2 = round2(row.russian_controlled_km2);
    row.ukrainian_controlled_km2 = round2(Math.max(0, row.ukrainian_controlled_km2));

    if (beforeRussian !== row.russian_controlled_km2 || beforeUkrainian !== row.ukrainian_controlled_km2) {
      corrections.push({
        oblast: row.oblast,
        russian_before: round2(beforeRussian),
        russian_after: row.russian_controlled_km2,
        ukrainian_before: round2(beforeUkrainian),
        ukrainian_after: row.ukrainian_controlled_km2
      });
    }
  }
  return corrections;
}

function validateDailyData(data, previousDayData = null) {
  const hardFailures = [];
  const warnings = [];

  if (!Array.isArray(data.oblasts)) {
    hardFailures.push({ type: 'schema', message: 'oblasts must be an array' });
    return { hardFailures, warnings };
  }

  const seen = new Set();
  for (const row of data.oblasts) {
    seen.add(row.oblast);
    const numericFields = [
      'russian_controlled_km2',
      'ukrainian_controlled_km2',
      'disputed_controlled_km2',
      'total_area_km2',
      'russian_change_km2',
      'ukrainian_change_km2',
      'disputed_change_km2'
    ];

    for (const field of numericFields) {
      if (!isFiniteNumber(row[field])) {
        hardFailures.push({ type: 'nan', oblast: row.oblast, field, message: `${row.oblast}.${field} must be finite` });
      }
      const isChangeField = field.endsWith('_change_km2');
      if (!isChangeField && isFiniteNumber(row[field]) && row[field] < -TOLERANCE) {
        hardFailures.push({ type: 'negative', oblast: row.oblast, field, message: `${row.oblast}.${field} is negative` });
      }
    }

    if (
      isFiniteNumber(row.russian_controlled_km2) &&
      isFiniteNumber(row.ukrainian_controlled_km2) &&
      isFiniteNumber(row.disputed_controlled_km2) &&
      isFiniteNumber(row.total_area_km2)
    ) {
      const sum = row.russian_controlled_km2 + row.ukrainian_controlled_km2 + row.disputed_controlled_km2;
      if (sum > row.total_area_km2 + TOLERANCE) {
        hardFailures.push({
          type: 'area_overflow',
          oblast: row.oblast,
          message: `${row.oblast} control sum exceeds total area`,
          details: { sum: round2(sum), total: row.total_area_km2 }
        });
      }
    }
  }

  const canonicalSet = new Set(CANONICAL_OBLASTS);
  for (const key of seen) {
    if (!canonicalSet.has(key)) {
      hardFailures.push({ type: 'unknown_oblast', oblast: key, message: `Unknown oblast key: ${key}` });
    }
  }
  for (const key of CANONICAL_OBLASTS) {
    if (!seen.has(key)) {
      hardFailures.push({ type: 'missing_oblast', oblast: key, message: `Missing canonical oblast: ${key}` });
    }
  }

  const sums = data.oblasts.reduce((acc, row) => {
    acc.r += row.russian_controlled_km2;
    acc.u += row.ukrainian_controlled_km2;
    acc.d += row.disputed_controlled_km2;
    return acc;
  }, { r: 0, u: 0, d: 0 });

  if (Math.abs((data.total_russian_controlled_km2 ?? NaN) - sums.r) > TOLERANCE) {
    hardFailures.push({ type: 'total_mismatch', field: 'total_russian_controlled_km2', expected: round2(sums.r), actual: data.total_russian_controlled_km2 });
  }
  if (Math.abs((data.total_ukrainian_controlled_km2 ?? NaN) - sums.u) > TOLERANCE) {
    hardFailures.push({ type: 'total_mismatch', field: 'total_ukrainian_controlled_km2', expected: round2(sums.u), actual: data.total_ukrainian_controlled_km2 });
  }
  if (Math.abs((data.total_disputed_km2 ?? NaN) - sums.d) > TOLERANCE) {
    hardFailures.push({ type: 'total_mismatch', field: 'total_disputed_km2', expected: round2(sums.d), actual: data.total_disputed_km2 });
  }

  for (const row of data.oblasts) {
    const rule = PLAUSIBILITY_RULES[row.oblast];
    if (!rule) continue;
    const controllable = Math.max(0.0001, row.total_area_km2 - row.disputed_controlled_km2);
    const russianShare = row.russian_controlled_km2 / controllable;
    if (typeof rule.minRussianShare === 'number' && russianShare < rule.minRussianShare) {
      const target = `${Math.round(rule.minRussianShare * 100)}%`;
      const issue = { type: 'plausibility_low', oblast: row.oblast, share: round2(russianShare * 100), threshold: target, message: rule.message };
      if (rule.severity === 'fail') hardFailures.push(issue);
      else warnings.push(issue);
    }
    if (typeof rule.maxRussianShare === 'number' && russianShare > rule.maxRussianShare) {
      const target = `${Math.round(rule.maxRussianShare * 100)}%`;
      const issue = { type: 'plausibility_high', oblast: row.oblast, share: round2(russianShare * 100), threshold: target, message: rule.message };
      if (rule.severity === 'fail') hardFailures.push(issue);
      else warnings.push(issue);
    }

    if (previousDayData?.oblasts) {
      const prev = previousDayData.oblasts.find((o) => o.oblast === row.oblast);
      if (prev) {
        const delta = Math.abs(row.russian_controlled_km2 - prev.russian_controlled_km2);
        if (delta > row.total_area_km2 * 0.15) {
          warnings.push({
            type: 'abrupt_jump',
            oblast: row.oblast,
            russian_delta_km2: round2(delta),
            message: `${row.oblast} day-over-day jump exceeds 15% of oblast area`
          });
        }
      }
    }
  }

  return { hardFailures, warnings };
}

function recalculateTopLevelTotals(data) {
  const sums = data.oblasts.reduce((acc, row) => {
    acc.r += row.russian_controlled_km2;
    acc.u += row.ukrainian_controlled_km2;
    acc.d += row.disputed_controlled_km2;
    return acc;
  }, { r: 0, u: 0, d: 0 });
  data.total_russian_controlled_km2 = round2(sums.r);
  data.total_ukrainian_controlled_km2 = round2(sums.u);
  data.total_disputed_km2 = round2(sums.d);
}

export {
  CANONICAL_OBLASTS,
  TOLERANCE,
  canonicalizeOblastRows,
  normalizeOblastRow,
  enforceOccupiedEnclaveCompletion,
  applyPlausibilityCorrections,
  validateDailyData,
  recalculateTopLevelTotals,
  round2
};
