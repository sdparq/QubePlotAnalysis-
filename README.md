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

## Adding new normatives

Standards live in `lib/standards/dubai.ts`. Add new emirates as separate files (e.g. `sharjah.ts`) and inject via the active project — no further changes needed in calc modules if rules follow the same shape.
