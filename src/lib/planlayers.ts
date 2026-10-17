// Plan map layers from a מבא"ת SHP set: blue line, land use, building lines, buildings to demolish, and (when there is
// no building annex) an approximate massing of the residential lots by their allowed floors. Each layer says if it is exact.
import type { RightsRow } from './mavat';
import { yeudColor } from './mavat';

export type LayerKind = 'blue_line' | 'land_use' | 'building_lines' | 'demolish' | 'proposed' | 'existing' | 'tashrit';
export interface PlanLayer { kind: LayerKind; geojson: GeoJSON.FeatureCollection; accuracy: 'exact' | 'approx'; source: string; note?: string | null }
type Named = GeoJSON.FeatureCollection & { fileName?: string };

export const LAYER_TITLE: Record<LayerKind, string> = {
  blue_line: 'קו כחול', land_use: 'ייעודי קרקע', building_lines: 'קווי בניין', demolish: 'מבנים להריסה',
  proposed: 'מבנים מוצעים', existing: 'מבנים קיימים', tashrit: 'תשריט מצב מוצע',
};
export const FLOOR_M = 3.3; // assumption: floor height for approximate massing

const r7 = (g: unknown): unknown => (Array.isArray(g) ? (typeof g[0] === 'number' ? g.slice(0, 2).map((x: number) => +x.toFixed(7)) : g.map(r7)) : g);
const geom = (g: GeoJSON.Geometry) => ({ ...g, coordinates: r7((g as GeoJSON.Polygon).coordinates) }) as GeoJSON.Geometry;
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

export function planLayersFromShp(out: Named | Named[], rights: RightsRow[] = []): PlanLayer[] {
  const all = ([] as Named[]).concat(out);
  const by = (re: RegExp) => all.find((x) => re.test(x.fileName ?? ''));
  const src = 'קובץ SHP ממבא"ת';
  const layers: PlanLayer[] = [];
  const gvul = by(/GVUL/i);
  if (gvul) layers.push({ kind: 'blue_line', accuracy: 'exact', source: `${src}, שכבת MVT_GVUL`, geojson: fc(gvul.features.map((f) => ({ type: 'Feature', geometry: geom(f.geometry), properties: {} }))) });
  const plan = by(/MVT_PLAN$/i);
  const floorsOf = (lot: string) => Math.max(0, ...rights.filter((r) => r.lot === lot).map((r) => r.floors ?? 0));
  const unitsOf = (lot: string) => rights.filter((r) => r.lot === lot).reduce((a, r) => a + (r.units ?? 0), 0);
  if (plan) layers.push({ kind: 'land_use', accuracy: 'exact', source: `${src}, שכבת MVT_PLAN`, geojson: fc(plan.features.map((f) => {
    const lot = String(f.properties?.NUM ?? ''); const yeud = String(f.properties?.MAVAT_NAME ?? '');
    return { type: 'Feature', geometry: geom(f.geometry), properties: { lot, yeud, color: yeudColor(yeud), area: Math.round(Number(f.properties?.SHAPE_AREA ?? 0)) } };
  })) });
  const arc = by(/MVT_ARC/i);
  if (arc) {
    const keep = arc.features.filter((f) => /קו בנין|חזית פעילה/.test(String(f.properties?.MAVAT_NAME ?? '')));
    layers.push({ kind: 'building_lines', accuracy: 'exact', source: `${src}, שכבת MVT_ARC`, geojson: fc(keep.map((f) => ({ type: 'Feature', geometry: geom(f.geometry), properties: { name: String(f.properties?.MAVAT_NAME), under: /תת/.test(String(f.properties?.MAVAT_NAME)) ? 1 : 0, active: /חזית/.test(String(f.properties?.MAVAT_NAME)) ? 1 : 0 } }))) });
  }
  const pol = by(/MVT_POL$/i);
  const dem = pol?.features.filter((f) => /להריסה/.test(String(f.properties?.MAVAT_NAME ?? ''))) ?? [];
  if (dem.length) layers.push({ kind: 'demolish', accuracy: 'exact', source: `${src}, שכבת MVT_POL "מבנה להריסה"`, note: 'גובה המבנים אינו בקובץ: בתלת-ממד מוצגים בגובה סמלי', geojson: fc(dem.map((f) => ({ type: 'Feature', geometry: geom(f.geometry), properties: { height: 12, base: 0 } }))) });
  if (plan && rights.length) {
    const res = plan.features.filter((f) => floorsOf(String(f.properties?.NUM)) > 0 && unitsOf(String(f.properties?.NUM)) > 0);
    if (res.length) layers.push({ kind: 'proposed', accuracy: 'approx', source: 'קירוב: מגרש המגורים בגובה מספר הקומות המותר בטבלה 5', note: `אין נספח בינוי וקטורי. גובה = קומות כפול ${FLOOR_M} מ'. אפשר לשרטט טביעות רגל ידנית`, geojson: fc(res.map((f) => {
      const lot = String(f.properties?.NUM); const floors = floorsOf(lot);
      return { type: 'Feature', geometry: geom(f.geometry), properties: { lot, floors, units: unitsOf(lot), height: Math.round(floors * FLOOR_M), base: 0 } };
    })) });
  }
  return layers;
}
