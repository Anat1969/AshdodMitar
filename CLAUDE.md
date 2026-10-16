# CLAUDE.md: Ashdod Master Plan Twin (תאום מתאר אשדוד)

Read this file before every build. Every correction from Anat is appended to the "Corrections log" at the bottom.

## What this is
An internal decision-support tool for Ashdod's comprehensive plan 603-0528026. Each detailed plan is a delta to the city twin. The app checks policy rules, derives public demand, and shows the cumulative district impact against the plan's own thresholds (clauses 6.1, 6.2, 6.3).
Read first: `docs/SPEC.md`, `docs/RULES.md`, `data/districts.json`, `reference/rules-engine.mjs`.

## Live
- App: see Delivery below. Supabase project: ASHDODMAP (`cbhexpybdggwzyakgagd`), shared with other apps: only `mt_` objects belong here.
- Code: `src/lib/rules.ts` (engine), `src/components/MapView.tsx` (map + layers), `src/pages/*`. Tests: `tests/rules.test.ts` (Vitest), `e2e/app.spec.ts` (Playwright, mocked Supabase from `e2e/fixtures.json`).
- Run e2e here: `PW_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell npx playwright test`.

## Non-negotiables
- Hebrew UI, full RTL. No icons or decorative symbols anywhere, including buttons.
- Every rule output shows source + certainty label (statutory / plan-draft / policy-draft / assumption / missing).
- Missing data returns "חסר"; never invent a value. Assumptions are always labeled.
- Footer line on every results screen: "כלי תומך החלטה. אינו מחליף הוראות דין, תכנית תקפה או שיקול דעת מוסד התכנון."
- Plan 603-0528026 is NOT in force (under renewed preparation). Never label its provisions as binding.
- Rules engine is pure TS in `src/lib/rules.ts`, ported from `reference/rules-engine.mjs`. `data/test_expected.json` must match exactly (unit test).
- Access (updated 2026-10-16): public read for published plan data (mt_city, mt_districts, mt_map_features, mt_rules, mt_policy_register). Members only (mt_members) for plans, checks, decisions, snapshots. Write = editor/admin. Reason: Google provider is off in ASHDODMAP, and the map must be viewable.
- Sign-in: Google button appears automatically when the provider is enabled (checked at runtime via `/auth/v1/settings`). Until then: email magic link, no password form.

## Stack
- Vite + React + TypeScript + framer-motion. MapLibre GL for the map (no API key; OSM raster or a free vector style).
- Supabase (tables prefixed `mt_`, schema in `supabase/schema.sql`), Google sign-in via Supabase. Check `/auth/v1/settings` early; if Google is off, show a clear message, no password form.
- Vercel deploy from `main`. Create project with `gitRepository`, no `teamId`, `ssoProtection: null`.
- PWA: manifest, sw.js (network-first for pages, cache for assets), text-free icon, "התקנת האפליקציה" button on `beforeinstallprompt`.
- Run `uipro init --ai claude` at project start.

## Fixed UI components
- Fixed top bar on every page (drawers open below it): app name links home, content navigation, and on the left ONE button "מערכת" that opens a panel with all technical buttons: "העתקת קישור" (copies current state incl. district, layers, theme, background), "שיחת הפיתוח", "פרויקט המחקר", "התקנת האפליקציה", and account (sign-in / sign-out).
- Real home page that maps the content (city gauge + district map).

## Design language
Architectural, minimal, greys, depth (shadows, layers, gradients, subtle motion), never flat. IBM Plex Sans Hebrew (thin only at large headings), IBM Plex Mono for labels and numbers. Meaningful colors kept: gate status (pass / near / over / missing) must be distinguishable without color too (text label). Body text contrast ≥ 4.5:1.

## Testing (required before merge)
- Vitest: rules engine vs `data/test_expected.json`.
- Playwright vs `vite preview` with mocked Supabase and a fake admin session: click every button, tab and item; verify requests. Mobile: no horizontal scroll. Check `Page.getInstallabilityErrors` is empty. Take and inspect screenshots.

## Git
Commit and push. If a work branch is required: PR, then merge to `main` immediately after green tests. Anat has given standing approval to merge.

## Map layers
- Background maps, free and keyless, switchable in the map (`?base=`): `streets` OpenFreeMap positron vector with Hebrew names (default), `sat` Esri World Imagery, `plain` CARTO light (also the automatic fallback). Hebrew shaping: `public/vendor/mapbox-gl-rtl-text.js`. Code: `src/lib/basemaps.ts`. The overlay is re-added on every `style.load`.
- City boundary: OSM (real). Quarter centres: OSM (real). Quarter cells and district boundaries: schematic, labeled "הנחת עבודה". The quarter-to-district assignment is an assumption and lives in `mt_districts.quarters`.
- District 8 (פארק לכיש מזרח) has no geometry: shown as "גבול חסר".
- Missing layers shown disabled with "חסר": mass-transit axis and parking zones, official district boundaries (נספח מתחמים).
- When the official GeoJSON arrives: write it to `mt_districts.geom`, set `geom_certainty='plan-draft'`, and update the layer label in `LAYERS`.

## Documents
- `/documents`: upload any file type (up to 50MB) with name, document date, optional district/plan and note. Table `mt_documents`, private storage bucket `mt-documents`, opened via 5-minute signed URLs. Read: members. Write/delete: editor/admin.

## Known pitfalls
- RTL horizontal scroll: top grid `grid-template-columns:minmax(0,1fr)`, `min-width:0` on button rows; motion wrappers in flex rows need `flex:0 0 auto`.
- Grid item with `overflow:hidden` inside a scroll container collapses: use `grid-auto-rows:max-content`.
- Environment may not reach supabase.co / vercel.app: seed data via SQL tool, verify deploys via Vercel tool.
- Promoting a preview to production fails (422): merge to main instead.
- MapLibre in an RTL page: the map container must be `direction:ltr` (markers back to rtl), or the canvas renders shifted.
- MapLibre `load` may never fire when tiles fail (tests block tiles): set up sources on `style.load`.
- Map text labels: use HTML markers, not symbol layers (no glyph server needed).
- Hebrew inside IBM Plex Mono: the mono stack must fall back to Plex Sans Hebrew, otherwise Hebrew is spread out.
- Supabase MCP: a single large DDL call, and any call containing `delete`/`drop`, can hang 60s. Split DDL into small calls; overwrite with upsert instead of delete.
- External data for seeding: the container cannot reach OSM, but SQL `http()` from the database can (Nominatim works with a User-Agent; Overpass mirrors were down).

## Delivery
Final URL + one line on what was built. Update this file.
- Production: https://ashdod-mitar-twin.vercel.app (Vercel project `ashdod-mitar-twin`, deploys from `main`).

## Corrections log
- 2026-10-16: show the real Ashdod map under the markings, using a free API (done: OpenFreeMap, Esri imagery, CARTO).
- 2026-10-16: all technical buttons go behind one button on the left of the top bar ("מערכת").
- 2026-10-16: a place to upload documents of any type, with name and date ("מסמכים").
