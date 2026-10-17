// Plan boundary from a GIS file: GeoJSON, KML or zipped Shapefile. Output: one Polygon/MultiPolygon in WGS84.
// Israeli plan files (מבא"ת) are usually in Israel TM Grid (EPSG:2039). Coordinates outside lon/lat range are
// treated as ITM and reprojected; a Shapefile with a .prj is reprojected by shpjs itself.
import proj4 from 'proj4';

export const ITM = '+proj=tmerc +lat_0=31.7343936111111 +lon_0=35.2045169444444 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,-0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs';
const toWgs = proj4(ITM, 'EPSG:4326');

type Pos = number[];
type Poly = Pos[][];

export function looksProjected(polys: Poly[]): boolean {
  const p = polys[0]?.[0]?.[0];
  return !!p && (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90);
}

export function itmToWgs(p: Pos): Pos {
  const [x, y] = toWgs.forward([p[0], p[1]]);
  return [+x.toFixed(7), +y.toFixed(7)];
}

function collect(g: GeoJSON.Geometry | null | undefined, out: Poly[]) {
  if (!g) return;
  if (g.type === 'Polygon') out.push(g.coordinates as Poly);
  else if (g.type === 'MultiPolygon') for (const p of g.coordinates) out.push(p as Poly);
  else if (g.type === 'GeometryCollection') for (const x of g.geometries) collect(x, out);
}

export function polygonsOf(gj: unknown): Poly[] {
  const out: Poly[] = [];
  const o = gj as { type?: string; features?: { geometry: GeoJSON.Geometry }[]; geometry?: GeoJSON.Geometry };
  if (Array.isArray(gj)) for (const x of gj) out.push(...polygonsOf(x));
  else if (o?.type === 'FeatureCollection') for (const f of o.features ?? []) collect(f.geometry, out);
  else if (o?.type === 'Feature') collect(o.geometry, out);
  else collect(gj as GeoJSON.Geometry, out);
  return out;
}

export function toBoundary(polys: Poly[]): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!polys.length) return null;
  const fixed = looksProjected(polys) ? polys.map((p) => p.map((ring) => ring.map(itmToWgs))) : polys.map((p) => p.map((ring) => ring.map((c) => [c[0], c[1]])));
  return fixed.length === 1 ? { type: 'Polygon', coordinates: fixed[0] } : { type: 'MultiPolygon', coordinates: fixed };
}

export function parseKml(text: string): Poly[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const polys: Poly[] = [];
  const ringOf = (el: Element | null) => (el?.textContent ?? '').trim().split(/\s+/).filter(Boolean).map((t) => t.split(',').map(Number).slice(0, 2));
  for (const pg of Array.from(doc.getElementsByTagNameNS('*', 'Polygon'))) {
    const outer = pg.getElementsByTagNameNS('*', 'outerBoundaryIs')[0]?.getElementsByTagNameNS('*', 'coordinates')[0] ?? null;
    const inner = Array.from(pg.getElementsByTagNameNS('*', 'innerBoundaryIs')).map((e) => e.getElementsByTagNameNS('*', 'coordinates')[0] ?? null);
    const ring = ringOf(outer);
    if (ring.length >= 4) polys.push([ring, ...inner.map(ringOf).filter((r) => r.length >= 4)]);
  }
  return polys;
}

export async function boundaryFromFile(file: File): Promise<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
  const name = file.name.toLowerCase();
  let polys: Poly[] = [];
  if (name.endsWith('.geojson') || name.endsWith('.json')) polys = polygonsOf(JSON.parse(await file.text()));
  else if (name.endsWith('.kml')) polys = parseKml(await file.text());
  else if (name.endsWith('.zip') || name.endsWith('.shp')) {
    if (name.endsWith('.shp')) throw new Error('קובץ SHP צריך להגיע כ-ZIP יחד עם קבצי dbf ו-prj');
    const shp = (await import('shpjs')).default as unknown as (b: ArrayBuffer) => Promise<unknown>;
    polys = polygonsOf(await shp(await file.arrayBuffer()));
  } else throw new Error('פורמט לא נתמך: GeoJSON, KML או SHP בתוך ZIP');
  const b = toBoundary(polys);
  if (!b) throw new Error('לא נמצא פוליגון בקובץ');
  return b;
}

// Rough sanity check: the boundary should fall inside the Ashdod area.
export function insideAshdod(b: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const p = (b.type === 'Polygon' ? b.coordinates[0][0] : b.coordinates[0][0][0]);
  return p[0] > 34.55 && p[0] < 34.8 && p[1] > 31.7 && p[1] < 31.9;
}

export function bboxOf(b: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] {
  const pts = (b.type === 'Polygon' ? [b.coordinates] : b.coordinates).flat(2);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
