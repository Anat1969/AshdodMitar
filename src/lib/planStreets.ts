// "רחובות התכנית": which municipal streets cross or border a plan's blue line, by rank, with the length inside the
// plan and the frontage along its boundary. Pure: geometry by hand in a local metric projection (no turf).
// Street geometry: municipal GIS (certainty `municipal`). The meaning of the hierarchy codes was not given by the city:
// the rank labels are inferred from the street names in each code (certainty `assumption`).

export const BUFFER_M = 10; // a street within this distance of the blue line borders the plan
export const STEP_M = 2; // pieces each street is cut into for the inside / along test
export const MIN_M = 10; // a street counts only with at least this many metres inside or along
export const PARALLEL_DEG = 30; // a piece counts as frontage only when it runs roughly along the boundary
export const MAIN_RANKS = [1, 2]; // ranks that count as main-street frontage

export interface RankInfo { label: string; order: number; width: number }
// inferred from the names in each code (rehevot.shp, 03.11.2026): 1 = שד בני ברית, שד הרצל, שד ירושלים;
// 2 = הפלמ"ח, נורדאו; 3 = local; 4 = מבוא...; 8 = כביש 4, כביש 41; 10 = מדרחוב; 0 = unclassified
export const RANK: Record<number, RankInfo> = {
  8: { label: 'כביש ארצי', order: 0, width: 5 },
  1: { label: 'שדרה ראשית', order: 1, width: 5 },
  2: { label: 'רחוב ראשי', order: 2, width: 3.5 },
  10: { label: 'מדרחוב', order: 3, width: 2.5 },
  3: { label: 'רחוב מקומי', order: 4, width: 2 },
  4: { label: 'מבוא או רחוב שכונתי', order: 5, width: 1.6 },
  5: { label: 'דרגה 5, לא פוענחה', order: 6, width: 1.6 },
  0: { label: 'לא מסווג בשכבה', order: 7, width: 1.4 },
};
export const rankInfo = (h: number): RankInfo => RANK[h] ?? { label: `דרגה ${h}, לא פוענחה`, order: 8, width: 1.4 };

export interface PlanStreet { key: string; name: string; rank: number; rankLabel: string; inside_m: number; along_m: number; segments: number }
export interface PlanStreetsResult {
  streets: PlanStreet[];
  inside_m: number; along_m: number; mainAlong_m: number; mainInside_m: number;
  features: GeoJSON.FeatureCollection; // the touched segments, for the map (props: n, h, w)
}

type XY = [number, number];
interface Proj { toXY: (p: number[]) => XY }

function projAround(lon0: number, lat0: number): Proj {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  return { toXY: (p) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky] };
}

function polygonsOf(g: GeoJSON.Geometry | null | undefined): number[][][][] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf);
  return [];
}

// the blue line as one geometry (a layer may hold several parts)
export function boundaryOf(src: GeoJSON.FeatureCollection | GeoJSON.Geometry | null | undefined): GeoJSON.MultiPolygon | null {
  if (!src) return null;
  const polys = src.type === 'FeatureCollection' ? src.features.flatMap((f) => polygonsOf(f.geometry)) : polygonsOf(src);
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
}

function linesOf(g: GeoJSON.Geometry | null): number[][][] {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

// even-odd over every ring, so holes count as outside
function inside(pt: XY, rings: XY[][]): boolean {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// distance from a point to the nearest boundary edge, and that edge's unit direction
function nearestEdge(pt: XY, edges: [XY, XY][]): { d: number; dir: XY } {
  let best = Infinity, dir: XY = [1, 0];
  for (const [a, b] of edges) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2)) : 0;
    const ex = a[0] + t * dx - pt[0], ey = a[1] + t * dy - pt[1], d = Math.hypot(ex, ey);
    if (d < best) { best = d; const L = Math.sqrt(L2) || 1; dir = [dx / L, dy / L]; }
  }
  return { d: best, dir };
}

export function planStreets(boundary: GeoJSON.Geometry | null, streets: GeoJSON.FeatureCollection | null, buffer = BUFFER_M): PlanStreetsResult {
  const empty: PlanStreetsResult = { streets: [], inside_m: 0, along_m: 0, mainAlong_m: 0, mainInside_m: 0, features: { type: 'FeatureCollection', features: [] } };
  const polys = polygonsOf(boundary);
  if (!polys.length || !streets?.features.length) return empty;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polys) for (const r of poly) for (const p of r) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
  const P = projAround((w + e) / 2, (s + n) / 2);
  const rings: XY[][] = polys.flatMap((poly) => poly.map((r) => r.map(P.toXY)));
  const edges: [XY, XY][] = rings.flatMap((r) => r.slice(1).map((p, i) => [r[i], p] as [XY, XY]));
  const [x0, y0] = P.toXY([w, s]), [x1, y1] = P.toXY([e, n]);
  const pad = buffer + 1, cosMin = Math.cos((PARALLEL_DEG * Math.PI) / 180);

  const groups = new Map<string, PlanStreet>();
  const touched: GeoJSON.Feature[] = [];
  for (const f of streets.features) {
    const p = (f.properties ?? {}) as { n?: string; name?: string; h?: number; hierarchy?: number };
    const h = Number(p.h ?? p.hierarchy ?? 0), name = String(p.n ?? p.name ?? '').trim();
    if (h === 9) continue; // parking strips
    let ins = 0, alg = 0;
    for (const line of linesOf(f.geometry)) {
      const xy = line.map(P.toXY);
      if (!xy.some(([x, y]) => x > x0 - 400 && x < x1 + 400 && y > y0 - 400 && y < y1 + 400)) continue;
      for (let i = 1; i < xy.length; i++) {
        const a = xy[i - 1], b = xy[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (!L) continue;
        // skip a vertex pair whose box is clear of the plan box
        if (Math.max(a[0], b[0]) < x0 - pad || Math.min(a[0], b[0]) > x1 + pad || Math.max(a[1], b[1]) < y0 - pad || Math.min(a[1], b[1]) > y1 + pad) continue;
        const k = Math.max(1, Math.ceil(L / STEP_M)), piece = L / k, ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
        for (let j = 0; j < k; j++) {
          const m: XY = [a[0] + ux * piece * (j + 0.5), a[1] + uy * piece * (j + 0.5)];
          const near = nearestEdge(m, edges);
          if (near.d <= buffer && Math.abs(ux * near.dir[0] + uy * near.dir[1]) >= cosMin) alg += piece;
          else if (inside(m, rings)) ins += piece;
        }
      }
    }
    if (ins + alg <= 0) continue;
    const key = name || `ללא שם|${h}`;
    const g = groups.get(key) ?? { key, name: name || 'ללא שם בשכבה העירונית', rank: h, rankLabel: rankInfo(h).label, inside_m: 0, along_m: 0, segments: 0 };
    if (rankInfo(h).order < rankInfo(g.rank).order) { g.rank = h; g.rankLabel = rankInfo(h).label; }
    g.inside_m += ins; g.along_m += alg; g.segments += 1;
    groups.set(key, g);
    touched.push({ type: 'Feature', geometry: f.geometry, properties: { n: name, h, w: rankInfo(h).width, key } });
  }
  const list = [...groups.values()].filter((g) => g.inside_m + g.along_m >= MIN_M)
    .map((g) => ({ ...g, inside_m: Math.round(g.inside_m), along_m: Math.round(g.along_m) }))
    .sort((a, b) => rankInfo(a.rank).order - rankInfo(b.rank).order || b.along_m + b.inside_m - (a.along_m + a.inside_m));
  const keys = new Set(list.map((g) => g.key));
  const sum = (xs: PlanStreet[], k: 'inside_m' | 'along_m') => xs.reduce((t, x) => t + x[k], 0);
  const main = list.filter((g) => MAIN_RANKS.includes(g.rank));
  return {
    streets: list,
    inside_m: sum(list, 'inside_m'), along_m: sum(list, 'along_m'),
    mainAlong_m: sum(main, 'along_m'), mainInside_m: sum(main, 'inside_m'),
    features: { type: 'FeatureCollection', features: touched.filter((t) => keys.has(String(t.properties?.key))) },
  };
}

const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
const heCount = (k: number, one: string, many: string) => (k === 1 ? `${one} אחת` : `${k} ${many}`);
const heCountM = (k: number, one: string, many: string) => (k === 1 ? `${one} אחד` : `${k} ${many}`);

export interface StreetsReading {
  insight: string; explain: string; // `**` marks the main concept and the numbers
  entry: PlanStreet | null; // the highest-ranked street that borders or crosses the plan
  unitsPerMainMetre: number | null; // net added units per metre of main street (inside + along); null = חסר
  perMetreNote: string;
}

// insight line (up to 8 words) + one sentence (up to 20 words), and what it means for planning.
// Main street = ranks 1-2, counted inside the plan and along its boundary: a boulevard that runs through the plan
// (ציר הרצל in תמל/2022) fronts it on both sides.
export function readStreets(r: PlanStreetsResult, netUnits: number | null): StreetsReading {
  const lean = (ranks: number[]) => r.streets.filter((x) => ranks.includes(x.rank) && x.along_m + x.inside_m >= 20);
  const blvd = lean([1]), mainSt = lean([2]), national = lean([8]);
  const unread = r.streets.filter((x) => !(x.rank in RANK) || [0, 5].includes(x.rank));
  const mainLen = r.mainAlong_m + r.mainInside_m, total = r.inside_m + r.along_m;
  let insight: string;
  if (!r.streets.length) insight = 'אין רחוב בשכבה העירונית סביב התכנית';
  else if (blvd.length) insight = `התכנית נשענת על **${heCount(blvd.length, 'שדרה ראשית', 'שדרות ראשיות')}**`;
  else if (mainSt.length) insight = `התכנית נשענת על **${heCountM(mainSt.length, 'רחוב ראשי', 'רחובות ראשיים')}**`;
  else if (national.length) insight = 'התכנית נשענת על **כביש ארצי** בלבד';
  else if (unread.length * 2 >= r.streets.length) insight = 'התכנית נשענת על **רחובות שדרגתם לא פוענחה**';
  else insight = 'התכנית נשענת על **רחובות מקומיים** בלבד';
  const explain = !r.streets.length ? `לא נמצא קטע רחוב במרחק **${BUFFER_M} מ'** מהקו הכחול.`
    : mainLen <= 0 && unread.length ? `**${fmt(total)} מ'** רחוב בתוך התכנית ולאורכה, ודרגתו **לא פוענחה** בשכבה העירונית.`
    : `**${fmt(mainLen)} מ'** רחוב ראשי בתוך התכנית ולאורכה, מתוך **${fmt(total)} מ'** רחוב בסך הכול.`;
  const entry = r.streets[0] ?? null;
  let unitsPerMainMetre: number | null = null, perMetreNote: string;
  if (netUnits == null || !(netUnits > 0)) perMetreNote = 'חסר: אין תוספת יח"ד נטו לתכנית';
  else if (mainLen <= 0 && unread.length) perMetreNote = 'חסר: דרגת הרחובות סביב התכנית לא פוענחה בשכבה העירונית';
  else if (mainLen <= 0) perMetreNote = 'אין רחוב ראשי: כל התוספת נשענת על רחובות מקומיים';
  else { unitsPerMainMetre = netUnits / mainLen; perMetreNote = `**${unitsPerMainMetre.toFixed(1)}** יח"ד נטו לכל מטר רחוב ראשי (${fmt(netUnits)} יח"ד, ${fmt(mainLen)} מ')`; }
  return { insight, explain, entry, unitsPerMainMetre, perMetreNote };
}
