# CLAUDE.md: Ashdod Master Plan Twin (תאום מתאר אשדוד)

Read this file before every build. Every correction from Anat is appended to the "Corrections log" at the bottom.

## What this is
An internal decision-support tool for Ashdod's comprehensive plan 603-0528026. Each detailed plan is a delta to the city twin. The app checks policy rules, derives public demand, and shows the cumulative district impact against the plan's own thresholds (clauses 6.1, 6.2, 6.3).
Read first: `docs/SPEC.md`, `docs/RULES.md`, `data/districts.json`, `reference/rules-engine.mjs`.

## Non-negotiables
- Hebrew UI, full RTL. No icons or decorative symbols anywhere, including buttons.
- Every rule output shows source + certainty label (statutory / plan-draft / policy-draft / assumption / missing).
- Missing data returns "חסר"; never invent a value. Assumptions are always labeled.
- Footer line on every results screen: "כלי תומך החלטה. אינו מחליף הוראות דין, תכנית תקפה או שיקול דעת מוסד התכנון."
- Plan 603-0528026 is NOT in force (under renewed preparation). Never label its provisions as binding.
- Rules engine is pure TS in `src/lib/rules.ts`, ported from `reference/rules-engine.mjs`. `data/test_expected.json` must match exactly (unit test).
- Access: internal. Read = authenticated users in `mt_members`; write = editor/admin. This deliberately deviates from the default public-read pattern.

## Stack
- Vite + React + TypeScript + framer-motion. MapLibre GL for the map (no API key; OSM raster or a free vector style).
- Supabase (tables prefixed `mt_`, schema in `supabase/schema.sql`), Google sign-in via Supabase. Check `/auth/v1/settings` early; if Google is off, show a clear message, no password form.
- Vercel deploy from `main`. Create project with `gitRepository`, no `teamId`, `ssoProtection: null`.
- PWA: manifest, sw.js (network-first for pages, cache for assets), text-free icon, "התקנת האפליקציה" button on `beforeinstallprompt`.
- Run `uipro init --ai claude` at project start.

## Fixed UI components
- Fixed top bar on every page (drawers open below it): app name links home, "העתקת קישור" (copies current state incl. district/plan in URL), "שיחת הפיתוח" (link to the dev chat), "פרויקט המחקר" (link to the Claude project), install button.
- Real home page that maps the content (city gauge + district map).

## Design language
Architectural, minimal, greys, depth (shadows, layers, gradients, subtle motion), never flat. IBM Plex Sans Hebrew (thin only at large headings), IBM Plex Mono for labels and numbers. Meaningful colors kept: gate status (pass / near / over / missing) must be distinguishable without color too (text label). Body text contrast ≥ 4.5:1.

## Testing (required before merge)
- Vitest: rules engine vs `data/test_expected.json`.
- Playwright vs `vite preview` with mocked Supabase and a fake admin session: click every button, tab and item; verify requests. Mobile: no horizontal scroll. Check `Page.getInstallabilityErrors` is empty. Take and inspect screenshots.

## Git
Commit and push. If a work branch is required: PR, then merge to `main` immediately after green tests. Anat has given standing approval to merge.

## Known pitfalls
- RTL horizontal scroll: top grid `grid-template-columns:minmax(0,1fr)`, `min-width:0` on button rows; motion wrappers in flex rows need `flex:0 0 auto`.
- Grid item with `overflow:hidden` inside a scroll container collapses: use `grid-auto-rows:max-content`.
- Environment may not reach supabase.co / vercel.app: seed data via SQL tool, verify deploys via Vercel tool.
- Promoting a preview to production fails (422): merge to main instead.

## Delivery
Final URL + one line on what was built. Update this file.

## Corrections log
(empty)
