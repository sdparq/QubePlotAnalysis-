# Qube Plot Analysis

Web app to analyze residential plots in Dubai, replacing the static Excel.
Reproduces every calculation from `Analysis_Production City .xlsx` and lets any team member do the same analysis on any plot.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Calculations: pure TS modules in `lib/calc/`
- State: Zustand with `localStorage` persistence (+ optional Supabase cloud sync)
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

State auto-saves to localStorage. Use *Export JSON* / *Import JSON* to share analyses between users — or enable the optional cloud sync below for live collaboration.

## Cloud sync (optional)

The app can sync projects to a shared Supabase database so every team member sees and edits the same set of projects. The whole team enters with a **single password** that you choose — there are no individual user accounts.

1. Create a Supabase project (free tier is enough). Note its `Project URL` and `anon public` key.
2. In the SQL editor, run:

   ```sql
   create table public.projects (
     id uuid primary key default gen_random_uuid(),
     name text not null default 'Untitled project',
     data jsonb not null default '{}'::jsonb,
     created_by uuid references auth.users(id) on delete set null,
     created_at timestamptz default now(),
     updated_by uuid references auth.users(id) on delete set null,
     updated_at timestamptz default now()
   );
   create index projects_updated_at_idx on public.projects (updated_at desc);

   alter table public.projects enable row level security;
   create policy "auth read"   on public.projects for select using (auth.role() = 'authenticated');
   create policy "auth insert" on public.projects for insert with check (auth.role() = 'authenticated');
   create policy "auth update" on public.projects for update using (auth.role() = 'authenticated');
   create policy "auth delete" on public.projects for delete using (auth.role() = 'authenticated');

   create function public.touch_updated_at() returns trigger language plpgsql as $$
   begin new.updated_at = now(); new.updated_by = auth.uid(); return new; end $$;
   create trigger projects_touch before update on public.projects
   for each row execute function public.touch_updated_at();
   ```

3. In **Authentication → Providers → Email**, enable email and turn **off** "Confirm email" (no inboxes are involved).
4. In **Authentication → Users → Add user → Create new user**, create the single shared team account:
   - Email: anything you want, e.g. `team@qubeplot.app` (it does not need to be a real inbox).
   - Password: the team password you'll hand out.
   - Tick **Auto Confirm User**.

   To rotate the password later, edit the same user here and tell the team — old sessions invalidate the next time they load the app.

5. Set the env vars (copy `.env.example` → `.env.local`, and add the same in Netlify → Site settings → Environment):

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   NEXT_PUBLIC_SUPABASE_SHARED_EMAIL=team@qubeplot.app
   ```

6. Redeploy. The header gains a **Team password** input; once unlocked, every change to a cloud-tracked project auto-saves and is visible to the rest of the team on their next load. Without these env vars the app runs unchanged in local-only mode.

## Deploy to Netlify

The app is configured as a fully static export — works on any static host, no server needed.

1. In Netlify: **Add new site → Import from Git** → pick this repo and the `claude/site-analysis-web-app-pGKod` branch (or `main` once merged).
2. Netlify reads `netlify.toml` automatically:
   - Build command: `npm run build`
   - Publish directory: `out`
   - Node 20
3. Click *Deploy*.

That's it — no plugin needed. For cloud sync set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Netlify's environment (see *Cloud sync* above); without them the app stays local-only.

## Urban-context 3D view

The Massing tab has a *Studio / In context* toggle. The In-context view drops the project building onto an Esri satellite tile composite and surrounds it with the neighbouring buildings extruded as **white volumes** from OpenStreetMap data.

**No API keys, no signups.** Both the satellite imagery (Esri World Imagery) and the building footprints (OSM Overpass) are public free services with attribution shown on the viewer.

To use it:

1. Fill **Latitude** and **Longitude** in Setup. Optional **North heading** if the plot's +Y axis isn't aligned to true north.
2. Open Massing → click **In context** in the top-right of the 3D viewer.
3. **Click any white volume** (a surrounding building) to select it. A small editor appears on the top-left of the viewer where you can:
   - Override its height — useful for masterplan plots that aren't built yet but you know the planned tower height.
   - Hide it — useful when OSM has noise / parking shelters / etc. you don't want to see.
   - Reset to OSM default at any time.

Heights default to OSM's `height` tag (or `building:levels × 3.2 m`, fallback 9 m). Edits persist with the project.

Limits: Esri's free tile usage and the Overpass API are rate-limited but sufficient for normal interactive use.

## Adding new normatives

Standards live in `lib/standards/dubai.ts`. Add new emirates as separate files (e.g. `sharjah.ts`) and inject via the active project — no further changes needed in calc modules if rules follow the same shape.
