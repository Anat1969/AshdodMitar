# פרומפט פתיחה ל-Claude Code

להדביק בסשן חדש, אחרי שתיקיית החבילה הועתקה לשורש הריפו.

```
Build the MVP of "תאום מתאר אשדוד" (Ashdod Master Plan Twin) using the end-to-end-builder skill.

First: run `uipro init --ai claude`. Then read CLAUDE.md, docs/SPEC.md, docs/RULES.md, data/districts.json, data/policy_register.csv, reference/rules-engine.mjs, supabase/schema.sql. Follow CLAUDE.md strictly.

Steps:
1. Scaffold Vite + React + TS + framer-motion + MapLibre. Hebrew RTL, IBM Plex Sans Hebrew / Plex Mono.
2. Port reference/rules-engine.mjs to src/lib/rules.ts. Add a Vitest test that reproduces data/test_expected.json exactly. Do not proceed until green.
3. Apply supabase/schema.sql (prefix mt_). Seed mt_districts and mt_city from data/districts.json, mt_policy_register from the CSV, mt_rules from docs/RULES.md, and the 3 test plans (marked "דוגמה") into mt_plans.
4. Screens per SPEC section 5: home (city gauge + district map; districts without geometry shown as a labeled grid until GeoJSON is supplied), district, plan form + rule cards + district impact, rules catalog, policy register (filter "חסר"), clause 6.2 annual report (print view).
5. Certainty label on every rule card; "חסר" wherever data is missing; disclaimer footer on result screens.
6. Fixed top bar, copy-link with state in URL, dev-chat and research-project buttons, PWA install.
7. Google sign-in via Supabase; access per mt_members.
8. Playwright: every button, tab, item; mobile no horizontal scroll; installability errors empty; screenshots inspected.
9. Push, PR, merge to main after green, deploy on Vercel (gitRepository, no teamId, ssoProtection null). Verify READY on main.
Deliver: final URL + one line. Append any of my corrections to CLAUDE.md.
```

## קישורים להזנה לכפתורים
- **שיחת הפיתוח:** קישור לסשן ה-Claude Code שבו תבני
- **פרויקט המחקר:** קישור לפרויקט "בודק: תוכנית מתאר 603-0528026"
