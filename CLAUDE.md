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
- The project's Site URL is localhost:3000 (shared project, do not change it), so the emailed link lands on a dead page. The sign-in panel has "הדבקת הקישור מהמייל": it accepts the email link (`verify?token=` then `verifyOtp`) or the dead-end address (`#access_token=` then `setSession`). After sign-in a banner shows "מחוברת", email and role.

## Stack
- Vite + React + TypeScript + framer-motion. MapLibre GL for the map (no API key; OSM raster or a free vector style).
- Supabase (tables prefixed `mt_`, schema in `supabase/schema.sql`), Google sign-in via Supabase. Check `/auth/v1/settings` early; if Google is off, show a clear message, no password form.
- Vercel deploy from `main`. Create project with `gitRepository`, no `teamId`, `ssoProtection: null`.
- PWA: manifest, sw.js (network-first for pages, cache for assets), text-free icon, "התקנת האפליקציה" button on `beforeinstallprompt`.
- Run `uipro init --ai claude` at project start.

## Fixed UI components
- Fixed top bar on every page (drawers open below it): app name links home, content navigation, and on the left ONE button "מערכת" that opens a panel with all technical buttons: "העתקת קישור" (copies current state incl. district, layers, theme, background), "שיחת הפיתוח", "פרויקט המחקר", "התקנת האפליקציה", and account (sign-in / sign-out).
- Opening page `/` = "איך זה עובד" (input, computation, output, topics, sources, what is missing), first item in the top nav; the app name links to it. City overview (gauge, topics, district map) is `/overview` ("תמונת העיר"), second in the nav.

## Design language
Architectural, minimal, greys, depth (shadows, layers, gradients, subtle motion), never flat. IBM Plex Sans Hebrew (thin only at large headings), IBM Plex Mono for labels and numbers. Meaningful colors kept: gate status (pass / near / over / missing) must be distinguishable without color too (text label). Body text contrast ≥ 4.5:1.

## Testing (required before merge)
- Vitest: rules engine vs `data/test_expected.json`.
- Playwright vs `vite preview` with mocked Supabase and a fake admin session: click every button, tab and item; verify requests. Mobile: no horizontal scroll. Check `Page.getInstallabilityErrors` is empty. Take and inspect screenshots.

## Git
Commit and push. If a work branch is required: PR, then merge to `main` immediately after green tests. Anat has given standing approval to merge.

## Map layers
- Background maps, free and keyless, switchable in the map (`?base=`): `streets` OpenFreeMap positron vector (default; background labels in Latin names, see below), `sat` Esri World Imagery, `plain` CARTO light (also the automatic fallback). Hebrew shaping plugin (`public/vendor/mapbox-gl-rtl-text-0.2.3.min.js`) is OFF by default: on production it blanked the map canvas (0.2.3 and 0.3.0 alike, verified with remote screenshots). Opt in with `?rtl=1`. Background labels use `name:en`/`name:latin`; Hebrew names come from our HTML labels. Code: `src/lib/basemaps.ts`. The overlay is re-added on every `style.load`.
- City boundary: OSM. Quarters: 35 official polygons from the Ashdod municipal GIS (`gis.ashdod.muni.il/arcgis/rest/services/Map/MapServer/0`, outSR=4326; reach it from SQL `http()`), plus רובע ז from OSM. Certainty label `municipal` ("GIS עירוני").
- District boundaries = union of official quarters. The quarter-to-district assignment is still an assumption (`mt_districts.quarters`), checked against the plan's district areas (1, 2, 4, 6 within 3%). District 8 = בית העלמין.
- Labels sit at the largest-inscribed-circle centre (`label_pt`, `props.label`); compact labels when zoomed out.
- Missing layers shown disabled with "חסר": mass-transit axis and parking zones, official district boundaries (נספח מתחמים).
- When the official GeoJSON arrives: write it to `mt_districts.geom`, set `geom_certainty='plan-draft'`, and update the layer label in `LAYERS`.

## Topics and bill of quantities
- `src/lib/topics.ts` (unit-tested): 8 topics (housing, elementary education, kindergartens, open space, public buildings, commerce, offices/employment, roads). Per district: existing, planned (sum of plan programs), target, gap, progress. Targets: housing = plan's added units; education/kindergarten = target population demand (class size 30 = assumption); open space = 3 m² per person; employment = plan's employment area; public, commerce, roads = "חסר".
- Existing: education from `mt_existing` (municipal GIS, 875 institutions, no personal fields); parks, buildings, shops, public buildings, roads drawn from OpenFreeMap vector tiles (`ofm` source). Counts per district for those are still "חסר" until an OSM import (Overpass was overloaded).
- Plan page step 5 "פרוגרמה" fills `mt_plans.program`; the "כתב כמויות" table compares provided vs required per topic.
- Map: topic picker + "התקדמות ליעד" colouring; plan circles sized by what the plan adds in the chosen topic. `/about` explains input, computation and output.
- Map diagnostics: `?debug=1` shows map errors; `?rtl=0` disables the Hebrew text plugin.
- Verifying the live map: the container cannot reach tile servers. Use the Apify actor `apify/screenshot-url` on the production URL (viewportWidth ~800 keeps the PNG small enough to view).

## Documents
- `/documents`: upload any file type (up to 50MB) with name, document date, optional district/plan and note. Table `mt_documents`, private storage bucket `mt-documents`, opened via 5-minute signed URLs. Read: members. Write/delete: editor/admin.

## Verified fixes (do not regress)
The full registry, with symptom, fix and verification, is in `skills/end-to-end-builder/SKILL.md`, section "רישום תיקונים שאומתו". Every fix that Anat requested and that was verified is added there, here (corrections log), and as an automated test, in the same round of work.

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
- 2026-10-16: the markings did not line up with the map. Fixed with official municipal quarter polygons and a background fallback.
- 2026-10-16: explain input and output (`/about`, plan page note). Goal: per topic show existing vs planned, maps update toward the target, every plan decomposes into a bill of quantities.
- 2026-10-16: the emailed sign-in link did not open (it went to localhost:3000). Sign-in must actually work, and Anat must clearly see that she is connected. Saved in the skill.
- 2026-10-17: blank streets map on production: Hebrew RTL plugin off by default (verified with a live screenshot).
- 2026-10-17: "איך זה עובד" is the opening page and first in the nav.
- 2026-10-17: every verified fix is saved in the skill, in this file and as a test, so it never comes back.
