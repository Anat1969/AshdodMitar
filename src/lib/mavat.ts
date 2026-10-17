// Readers for files exported from מבא"ת (the national planning system). They need no AI: the formats are fixed.
//  - rights table ("טבלה 5", exported as .xls that is really HTML): one row per lot and use.
//  - areas table ("טבלת שטחים", same format): lot, land use, computed area.
//  - zipped Shapefile set (MVT_*): MVT_GVUL = plan boundary, MVT_PLAN = lots with land use.
// Output feeds draft quantities: nothing here is counted before approval.

export interface RightsRow { yeud: string; use: string; lot: string; lotArea: number | null; builtM2: number | null; units: number | null; floors: number | null }
export interface AreaRow { lot: string; yeud: string; areaM2: number }

const num = (s: string | undefined) => {
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/g);
  return m ? Number(m[m.length - 1]) : null; // "(2) 868" -> 868 (the note marker comes first)
};
const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function htmlRows(html: string): string[][] {
  return Array.from(html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((r) => Array.from(r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((c) => decode(c[1])));
}

export function isRightsTable(html: string) { return /תאי שטח/.test(html) && /יח"ד/.test(html) && /שטחי בניה/.test(html); }
export function isAreasTable(html: string) { return /שטח מחושב/.test(html) && /ייעוד קרקע/.test(html); }

export function parseRightsTable(html: string): RightsRow[] {
  const rows = htmlRows(html);
  const head = rows.findIndex((r) => r.includes('תאי שטח') && r.some((c) => c.includes('יח"ד')));
  if (head < 0) return [];
  const h = rows[head];
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const ci = { yeud: col(/יעוד/), use: col(/^שימוש$/), lot: col(/תאי שטח/), lotArea: col(/גודל מגרש/), built: col(/סה"כ שטחי בניה|שטחי בניה/), units: col(/יח"ד/), floors: col(/^מעל הכניסה/) };
  const out: RightsRow[] = [];
  for (const r of rows.slice(head + 1)) {
    const lot = r[ci.lot];
    if (r.some((c) => c === 'סך הכל')) break;
    if (!lot || !/^\d+[A-Za-z]?$/.test(lot)) continue; // stops at the totals row and the notes
    out.push({ yeud: r[ci.yeud] ?? '', use: r[ci.use] ?? '', lot, lotArea: num(r[ci.lotArea]), builtM2: num(r[ci.built]), units: num(r[ci.units]), floors: ci.floors >= 0 ? num(r[ci.floors]) : null });
  }
  return out;
}

export function rightsTotals(html: string): { units: number | null; builtM2: number | null } {
  const t = htmlRows(html).find((r) => r.some((c) => c === 'סך הכל'));
  if (!t) return { units: null, builtM2: null };
  const vals = t.map((c) => num(c));
  const nums = vals.filter((v): v is number => v != null);
  return { builtM2: nums[2] ?? null, units: nums[3] ?? null }; // lots count, lot area, built area, units, ...
}

export function parseAreasTable(html: string): AreaRow[] {
  return htmlRows(html).filter((r) => /^\d+[A-Za-z]?$/.test(r[0] ?? '') && r.length >= 3).map((r) => ({ lot: r[0], yeud: r[1], areaM2: num(r[2]) ?? 0 }));
}

// Domain mapping. Assumptions are written into each row's note.
export interface QtyDraft { domain_key: string; value: number; quote: string; note: string | null }
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
const lotsOf = (rs: { lot: string }[]) => Array.from(new Set(rs.map((r) => r.lot))).join(', ');

export function quantitiesFromRights(rows: RightsRow[]): QtyDraft[] {
  const out: QtyDraft[] = [];
  const res = rows.filter((r) => r.units != null && r.units > 0);
  if (res.length) out.push({ domain_key: 'housing', value: sum(res.map((r) => r.units)), quote: `טבלה 5: יח"ד בתאי שטח ${lotsOf(res)}`, note: 'סה"כ מוצע, לא תוספת נטו: יש לנכות את יח"ד הקיימות להריסה' });
  const pick = (re: RegExp) => rows.filter((r) => re.test(r.use) && r.builtM2);
  const com = pick(/^מסחר$/);
  if (com.length) out.push({ domain_key: 'commerce', value: sum(com.map((r) => r.builtM2)), quote: `טבלה 5: שימוש מסחר, תאי שטח ${lotsOf(com)}`, note: null });
  const emp = pick(/^תעסוקה$/);
  if (emp.length) out.push({ domain_key: 'employment', value: sum(emp.map((r) => r.builtM2)), quote: `טבלה 5: שימוש תעסוקה, תאי שטח ${lotsOf(emp)}`, note: null });
  const mixed = pick(/^מסחר ותעסוקה$/);
  if (mixed.length) out.push({ domain_key: 'employment', value: sum(mixed.map((r) => r.builtM2)), quote: `טבלה 5: שימוש מסחר ותעסוקה, תאי שטח ${lotsOf(mixed)}`, note: 'שימוש משולב: שויך לתעסוקה (הנחה). אפשר להעביר למסחר' });
  const pubUse = rows.filter((r) => /מבנים ומוסדות ציבור/.test(r.use) && r.builtM2);
  const pubLots = rows.filter((r) => /מבנים ומוסדות ציבור/.test(r.yeud) && !r.use && r.builtM2);
  if (pubUse.length) out.push({ domain_key: 'public', value: sum(pubUse.map((r) => r.builtM2)), quote: `טבלה 5: שטחי ציבור בתוך מגרשי מגורים, תאי שטח ${lotsOf(pubUse)}`, note: 'שטח בנוי לצרכי ציבור' });
  if (pubLots.length) out.push({ domain_key: 'public', value: sum(pubLots.map((r) => r.builtM2)), quote: `טבלה 5: מגרשים ביעוד מבנים ומוסדות ציבור, תאי שטח ${lotsOf(pubLots)}`, note: 'שטח בנוי מרבי. ייתכן שחלקו מבנה ציבור קיים שנכלל בתכנית: לבדוק בהוראות' });
  return out;
}

export function quantitiesFromAreas(rows: AreaRow[]): QtyDraft[] {
  const sp = rows.filter((r) => /שטח ציבורי פתוח/.test(r.yeud));
  return sp.length ? [{ domain_key: 'openspace', value: Math.round(sum(sp.map((r) => r.areaM2))), quote: `טבלת שטחים: שטח ציבורי פתוח, תאי שטח ${lotsOf(sp)}`, note: 'שטח קרקע ביעוד שצ"פ. סף-בית נספר לפי כללי ההכרה' }] : [];
}

// Lots for the map: MVT_PLAN polygons with land use, joined with the rights rows of each lot.
export interface Lot { lot: string; yeud: string; areaM2: number | null; rights: Omit<RightsRow, 'yeud' | 'lot'>[] }
export function lotsCollection(mvtPlan: GeoJSON.FeatureCollection, rights: RightsRow[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: mvtPlan.features.filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')).map((f) => {
      const p = f.properties ?? {};
      const lot = String(p.NUM ?? '');
      const props: Lot = { lot, yeud: String(p.MAVAT_NAME ?? ''), areaM2: p.SHAPE_AREA ? Math.round(Number(p.SHAPE_AREA)) : null, rights: rights.filter((r) => r.lot === lot).map(({ yeud: _y, lot: _l, ...rest }) => rest) };
      return { type: 'Feature', geometry: f.geometry, properties: props as unknown as GeoJSON.GeoJsonProperties };
    }),
  };
}

export const YEUD_COLOR: Record<string, string> = {
  'מגורים מסחר ותעסוקה': '#c9a24a', 'מגורים': '#e3c26a', 'מבנים ומוסדות ציבור': '#8f6e5a', 'שטח ציבורי פתוח': '#6f9a72',
  'דרך מאושרת': '#b9bcc2', 'דרך מוצעת': '#d07b6a', 'שטח שהתוכנית אינה חלה עליו': '#e6e7ea',
};
export const yeudColor = (y: string) => YEUD_COLOR[y] ?? '#a7adb6';
