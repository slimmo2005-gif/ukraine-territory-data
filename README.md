# Ukraine War Map Data Investigator

Investigates whether frontline geometry can be reliably extracted from public Ukraine war maps.

## Targets

- **DeepStateMap** (`deepstatemap.live`) - Real-time frontline map
- **ISW (Institute for the Study of War)** - Strategic analysis
- **Liveuamap** - Live conflict reporting

## Quick Start

```bash
npm install
npm run investigate      # Capture network traffic
npm run parse-tiles      # Decode vector tiles
npm run analyze          # Assess data sufficiency
```

## Architecture

### investigator.js
Uses Playwright to:
- Open map sites in headless browser
- Capture all network requests
- Save GeoJSON and vector tiles
- Generate endpoint report

### tile-parser.js
Decodes Mapbox Vector Tiles (MVT):
- Extracts layer names
- Parses feature properties
- Exports sample geometry

### analyze-structure.js
Assesses feasibility:
- Territorial data indicators
- Geometry types available
- Daily extraction viability

## Key Findings (TBD)

See `discovered_data/investigation_report.json` after running.

## Data Formats Explained

| Format | Pros | Cons | Extraction Difficulty |
|--------|------|------|---------------------|
| GeoJSON | Human-readable, full properties | Large file sizes | Easy - direct API |
| Vector Tiles | Compact, fast rendering | Binary, needs decoding | Medium - use @mapbox/vector-tile |
| Raster Tiles | Easy to render | No extractable geometry | Hard - computer vision required |
