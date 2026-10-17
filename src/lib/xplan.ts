// Planning Administration (מינהל התכנון) Xplan service: plan boundary ("קו כחול") and basic data by plan number.
// The service answers Israeli addresses only: the server and the build container are refused, so the call is made
// from the user's browser. If it fails, the app says so and offers manual upload.
export const XPLAN_LAYER = 'https://ags.iplan.gov.il/arcgisiplan/rest/services/PlanningPublic/Xplan/MapServer/1/query';

export interface XplanResult { boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon; props: Record<string, unknown> }

export function xplanUrl(number: string, format: 'geojson' | 'json' = 'geojson') {
  const where = `pl_number='${number.replace(/'/g, "''")}'`;
  return `${XPLAN_LAYER}?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=true&outSR=4326&f=${format}`;
}

function jsonp(url: string, ms: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const cb = `__xplan_${Math.random().toString(36).slice(2)}`;
    const s = document.createElement('script');
    const t = window.setTimeout(() => { cleanup(); reject(new Error('timeout')); }, ms);
    const cleanup = () => { window.clearTimeout(t); s.remove(); delete (window as unknown as Record<string, unknown>)[cb]; };
    (window as unknown as Record<string, unknown>)[cb] = (data: unknown) => { cleanup(); resolve(data); };
    s.src = `${url}&callback=${cb}`; s.onerror = () => { cleanup(); reject(new Error('network')); };
    document.head.appendChild(s);
  });
}

export function toResult(data: unknown): XplanResult | null {
  const d = data as { features?: { geometry?: GeoJSON.Geometry & { rings?: number[][][] }; properties?: Record<string, unknown>; attributes?: Record<string, unknown> }[] };
  const f = d?.features?.[0];
  if (!f?.geometry) return null;
  const g = f.geometry;
  const boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = g.type === 'Polygon' || g.type === 'MultiPolygon' ? g as GeoJSON.Polygon : g.rings ? { type: 'Polygon', coordinates: g.rings } : null;
  return boundary ? { boundary, props: f.properties ?? f.attributes ?? {} } : null;
}

export async function fetchXplan(number: string, ms = 12000): Promise<XplanResult> {
  try {
    const ctl = new AbortController(); const t = window.setTimeout(() => ctl.abort(), ms);
    const r = await fetch(xplanUrl(number), { signal: ctl.signal }); window.clearTimeout(t);
    const res = toResult(await r.json());
    if (res) return res;
  } catch { /* CORS or network: try JSONP */ }
  const res = toResult(await jsonp(xplanUrl(number, 'json'), ms));
  if (!res) throw new Error('התוכנית לא נמצאה בשירות');
  return res;
}

// Field names differ between versions of the layer; read what exists.
export function xplanFacts(p: Record<string, unknown>) {
  const pick = (...keys: string[]) => { for (const k of keys) { const v = p[k] ?? p[k.toUpperCase()]; if (v != null && v !== '') return v; } return null; };
  return {
    name: pick('pl_name') as string | null,
    status: pick('station_desc', 'internet_short_status', 'pl_status') as string | null,
    area_dunam: pick('pl_area_dunam') as number | null,
    url: pick('pl_url') as string | null,
    units_added: pick('quantity_delta_120') as number | null,
  };
}

export function statusFromText(s: string | null): 'approved' | 'deposited' | 'pipeline' {
  if (!s) return 'pipeline';
  if (/אישור|תוקף/.test(s)) return 'approved';
  if (/הפקדה|הופקד/.test(s)) return 'deposited';
  return 'pipeline';
}
