# Province-Level & Historical Data Analysis

**Date**: 2026-05-02  
**Questions Addressed**:
1. Can we get province (oblast)-level breakdowns?
2. Can we access historical data (1 day ago, 2 days ago, back to war start)?

---

## 1. PROVINCE (OBLAST) LEVEL BREAKDOWN

### Direct API Support: ✗ NOT AVAILABLE

The DeepStateMap API **does not** include province/oblast metadata in the polygon features:

```json
{
  "properties": {
    "name": "Статус невідомий /// Unknown status",
    "styleUrl": "#poly-BCAAA4-2000-77-nodesc"
    // ❌ No "oblast", "province", or "admin_region" field
  }
}
```

**Found**: Only 9/527 features mention a province name (like "Sumy", "Kharkiv") in their label - not structured data.

---

### Workaround: Geographic Assignment ✓ POSSIBLE

**Approach**: Assign polygons to provinces by centroid location

**Results from analysis**:

| Province | Ukrainian Zones | Russian (post-2022) | Russian (pre-2022) | Contested |
|----------|-------------------|---------------------|-------------------|-----------|
| **Sumy** | 10 | 10 | 0 | 11 |
| **Kharkiv** | 4 | 7 | 0 | 7 |
| **Kherson** | 14 | 0 | 0 | 2 |
| **Donetsk** | 6 | 2 | 0 | 5 |
| **Mykolaiv** | 9 | 1 | 0 | 1 |
| **Zaporizhzhia** | 3 | 1 | 0 | 4 |
| **Crimea** | 0 | 0 | 4 | 0 |
| **Chernihiv** | 3 | 0 | 0 | 0 |
| **Kyiv** | 3 | 0 | 0 | 0 |
| **Luhansk** | 0 | 1 | 0 | 0 |

**Accuracy**: Medium
- Works for large, clear polygons
- Border regions may be misassigned
- No proportional allocation for polygons crossing oblast boundaries

---

### Better Solution: Spatial Join with Admin Boundaries

**Recommended approach**:

1. **Download Ukraine oblast boundaries** (GeoJSON)
   - Source: [Natural Earth](https://www.naturalearthdata.com/) or [GADM](https://gadm.org/)
   - Or: OpenStreetMap administrative boundaries

2. **Perform spatial intersection**
   ```javascript
   // Using Turf.js
   const intersection = turf.intersect(deepstatePolygon, oblastBoundary);
   const area = turf.area(intersection);
   ```

3. **Calculate province statistics**
   ```javascript
   provinceStats = {
     "Donetsk": {
       ukrainian_km2: 1250.5,
       russian_km2: 8900.3,
       contested_km2: 340.2
     }
   }
   ```

**Benefits**:
- ✓ Accurate area calculations
- ✓ Handles polygons crossing boundaries
- ✓ Standard GIS approach
- ✓ Reproducible and verifiable

---

## 2. HISTORICAL DATA ACCESS

### Direct API History: ✗ RESTRICTED

**Tested endpoints**:
```
GET /api/history              → 401 Unauthorized
GET /api/history/{id}         → 404 (tested with calculated IDs)
GET /api/history/list         → 404
GET /api/snapshots            → 404
```

**Finding**: Historical snapshots exist but require authentication. The public API only provides `/api/history/last` (current snapshot).

---

### Snapshot ID Analysis

**Current snapshot**: ID `1777665002`
- When treated as Unix timestamp: **2026-05-01T19:50:02Z**
- Days since war start (Feb 24 2022): **1,527 days**
- Hex representation: `69f503ea`

**Calculated historical IDs** (assuming daily snapshots):
| Days Ago | Calculated ID | API Result |
|----------|---------------|------------|
| 1 day | 1777578602 | 404 Not Found |
| 2 days | 1777492202 | Not tested |
| 7 days | 1777062602 | Not tested |
| 30 days | 1775070602 | Not tested |

**Conclusion**: Either:
1. Historical access requires authentication (API key/cookie)
2. IDs don't follow simple timestamp pattern for history
3. Historical data is intentionally restricted

---

### Workarounds for Historical Data

#### Option A: Daily Collection (Forward-Looking)
**Feasibility**: ✓ HIGH

Since we have access to current data, we can:
1. **Start collecting daily snapshots NOW**
2. Store each day's `/api/history/last` response
3. Build time-series from today forward

**Implementation**:
```javascript
// Daily cron job
const data = await fetch('https://deepstatemap.live/api/history/last').then(r => r.json());
fs.writeFileSync(`snapshots/${Date.now()}.json`, JSON.stringify(data));
```

**Limitation**: Cannot get data from before you start collecting

---

#### Option B: Reverse Timeline Discovery
**Feasibility**: ? UNCERTAIN

Hypothesis: The `id` field might not be sequential. DeepStateMap may use:
- Internal database IDs
- Timestamp with encoding
- Version control system IDs

**Test**: Try discovering valid historical IDs by:
1. Monitoring the website over multiple days
2. Capturing the `id` value each day
3. Building a mapping of id → date

**Example**:
```javascript
// If we collect for a week
const idMapping = {
  1777665002: '2026-05-01',
  // Tomorrow we get new ID
  1777751402: '2026-05-02', // Hypothetical
};

// Pattern might emerge: IDs increment by ~86400 (seconds per day)
```

**Note**: Requires ongoing monitoring for pattern discovery

---

#### Option C: Frontend State Analysis
**Feasibility**: ? POSSIBLE

DeepStateMap website may store previous days in browser:
1. **Check LocalStorage/IndexedDB** when loading the site
2. **Inspect JavaScript** for history management
3. **Check if history slider** loads data from server or client cache

**Not tested yet** - would require deeper browser inspection

---

#### Option D: Alternative Sources for Historical Data
**Feasibility**: ✓ POSSIBLE (but fragmented)

| Source | Historical Data | Format | Access |
|--------|-----------------|--------|--------|
| **ISW Reports** | Daily since 2022 | PDF/Images | Public, manual |
| **Crisis Group** | Periodic | PDF/Static maps | Public, manual |
| **Liveuamap** | Event-based | Not territorial | API available? |
| **Kaggle datasets** | Community aggregated | GeoJSON | Varies |

**Recommendation**: For historical territorial control prior to your start date, these sources may require manual data entry or community datasets.

---

## 3. IMPLEMENTATION RECOMMENDATIONS

### For Province-Level Dashboard

**Architecture**:
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ DeepStateMap    │────▶│ Spatial Join     │────▶│ Province Stats  │
│ API (current)   │     │ (Turf.js/PostGIS)│     │ (area by oblast)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                       │
         │              ┌────────┴────────┐
         │              │ Ukraine Admin   │
         │              │ Boundaries      │
         │              │ (Natural Earth) │
         │              └─────────────────┘
         │
         ▼
┌─────────────────┐
│ Daily Snapshot  │
│ Database        │
└─────────────────┘
```

**Code outline**:
```javascript
import * as turf from '@turf/turf';

// 1. Load Ukraine oblast boundaries
const oblasts = await fetch('ukraine_oblasts.geojson').then(r => r.json());

// 2. Load DeepStateMap data
const dsData = await fetch('https://deepstatemap.live/api/history/last').then(r => r.json());

// 3. Calculate province stats
const provinceStats = {};

for (const oblast of oblasts.features) {
  provinceStats[oblast.properties.name] = {
    ukrainian_km2: 0,
    russian_km2: 0,
    contested_km2: 0
  };
  
  for (const zone of dsData.map.features) {
    const intersection = turf.intersect(zone.geometry, oblast.geometry);
    if (intersection) {
      const area = turf.area(intersection) / 1000000; // km²
      const status = parseControlStatus(zone.properties);
      provinceStats[oblast.properties.name][`${status}_km2`] += area;
    }
  }
}
```

---

### For Historical Timeline

**Immediate**: Start daily collection
```bash
# Cron job: Run at 20:00 UTC daily
curl -s https://deepstatemap.live/api/history/last > "snapshots/ukraine_$(date +%Y%m%d).json"
```

**Future**: If historical API becomes available or pattern discovered, backfill data.

---

## 4. SUMMARY TABLE

| Capability | Direct API | Workaround | Status |
|------------|------------|------------|--------|
| **Province breakdown** | ✗ No field | ✓ Spatial join | **FEASIBLE** |
| **Area by control type** | ✓ Yes | N/A | **AVAILABLE** |
| **Current snapshot** | ✓ `/history/last` | N/A | **AVAILABLE** |
| **Yesterday's data** | ✗ Auth required | ✗ None found | **NOT AVAILABLE** |
| **War-start data** | ✗ Auth required | ? External sources | **REQUIRES ALTERNATIVE** |
| **Daily collection** | ✓ Forward only | N/A | **START NOW** |

---

## 5. NEXT STEPS

### Immediate Actions
1. ✓ **Start daily data collection** (cron job or scheduled function)
2. ✓ **Download Ukraine admin boundaries** (Natural Earth/GADM)
3. ✓ **Implement spatial join** for province-level breakdown
4. ✓ **Build area calculation** pipeline

### Short-term Research
1. ? **Monitor ID pattern** for history discovery (collect IDs for 7+ days)
2. ? **Check browser storage** when visiting site (may have recent history)
3. ? **Search for community datasets** (Kaggle, GitHub, OSINT)

### If Historical Data Critical
- Contact DeepStateMap for API access
- Search academic/NGO datasets
- Consider manual digitization for key dates

---

**Bottom Line**:
- ✓ Province-level: Possible with spatial analysis (not direct API)
- ✓ Current data: Available now
- ✗ Historical API: Restricted, but forward collection works
- ? Past data: May need alternative sources
