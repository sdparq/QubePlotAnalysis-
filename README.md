# Qube Plot Analysis

Web app to analyze residential plots in Dubai, replacing the static Excel.
Reproduces every calculation from `Analysis_Production City .xlsx` and lets any team member do the same analysis on any plot.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Calculations: pure TS modules in `lib/calc/`
- State: Zustand with `localStorage` persistence
- Export: ExcelJS — produces a workbook with the same 5 sheets as the source Excel
- Tests: Vitest with parity test against the Production City sample

## Scripts

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run start
npm test         # parity test vs Production City Excel
```

## Project structure

```
app/                 # Next.js routes
components/          # tab UIs (setup, typologies, program, …)
lib/
  types.ts           # data model
  store.ts           # Zustand store + localStorage persistence
  sample.ts          # Production City seed
  format.ts          # number formatting
  export-xlsx.ts     # multi-sheet Excel export
  standards/dubai.ts # Dubai DCD/DM constants (parking, waste, lifts, fire)
  calc/
    program.ts       # GFA, units, mix, common areas, efficiency
    parking.ts       # required vs available, PRM
    lifts.ts         # CIBSE Guide D + practical checks
    garbage.ts       # Dubai DM waste room
    parity.test.ts   # ✅ matches the Excel cell-by-cell
```

## Workflow

1. **Setup** — name, zone, plot area, floors, height
2. **Typologies** — define each unit type (interior + balcony, occupancy, parking ratio)
3. **Program** — matrix of typologies × floors
4. **Common areas** — lobbies, corridors, lifts, MEP, amenities (mark whether each counts as GFA)
5. **Parking** — inventory by level + other uses (retail, F&B)
6. **Lifts** — cabin, speed, handling parameters
7. **Results** — dashboard with KPIs and compliance checks
8. **Export Excel** — recreates the 5-sheet workbook for sharing

State auto-saves to localStorage. Use *Export JSON* / *Import JSON* to share analyses between users.

## Deploy to Netlify

The app is configured as a fully static export — works on any static host, no server needed.

1. In Netlify: **Add new site → Import from Git** → pick this repo and the `claude/site-analysis-web-app-pGKod` branch (or `main` once merged).
2. Netlify reads `netlify.toml` automatically:
   - Build command: `npm run build`
   - Publish directory: `out`
   - Node 20
3. Click *Deploy*.

That's it — no plugin needed, no env vars.

## Urban-context 3D view (optional)

The Massing tab has a *Studio / In context* toggle. The In-context view drops the project building onto a Mapbox satellite tile and surrounds it with the neighbouring buildings extruded from OpenStreetMap data — like a SimCity-style block of the actual streetscape.

To enable it:

1. **Get a Mapbox public token** at [account.mapbox.com](https://account.mapbox.com/access-tokens/) (free tier covers 50 k requests / month, plenty for internal feasibility studies).
2. **Restrict the token** to your Netlify domain (URL restriction).
3. In **Netlify → Site configuration → Environment variables** add:
   - `NEXT_PUBLIC_MAPBOX_TOKEN` = the token
4. **Trigger a redeploy** so the variable is picked up at build time.
5. In the app, fill **Latitude** and **Longitude** in Setup (and *North heading* if the plot's +Y axis isn't aligned to true north).
6. Open Massing → click **In context** in the top-right of the 3D viewer.

The OSM building footprints are fetched from the public Overpass API on the fly (no key, no setup), and extruded with default 9 m height when the OSM record doesn't carry a `height` or `building:levels` tag. Within ~350 m of the plot.

## Adding new normatives

Standards live in `lib/standards/dubai.ts`. Add new emirates as separate files (e.g. `sharjah.ts`) and inject via the active project — no further changes needed in calc modules if rules follow the same shape.
