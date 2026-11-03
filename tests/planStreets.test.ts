import { describe, expect, it } from 'vitest';
import { boundaryOf, planStreets, readStreets, rankInfo } from '../src/lib/planStreets';

// a 200 x 200 m square near Ashdod; metres to degrees at lat 31.8
const LAT0 = 31.8, LON0 = 34.65;
const kx = 111320 * Math.cos((LAT0 * Math.PI) / 180), ky = 110540;
const ll = (x: number, y: number) => [LON0 + x / kx, LAT0 + y / ky];
const square: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[ll(0, 0), ll(200, 0), ll(200, 200), ll(0, 200), ll(0, 0)]] };
const line = (n: string, h: number, pts: [number, number][]): GeoJSON.Feature => ({ type: 'Feature', properties: { n, h }, geometry: { type: 'LineString', coordinates: pts.map(([x, y]) => ll(x, y)) } });
const streets: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [
  line('שד הבדיקה', 1, [[-50, -5], [250, -5]]), // runs 5 m south of the south edge: frontage 200 m
  line('רחוב פנימי', 3, [[100, -50], [100, 250]]), // crosses north-south: about 200 m inside, nothing along
  line('רחוב רחוק', 2, [[-50, 300], [250, 300]]), // 100 m north: not related
  line('חניה', 9, [[50, 50], [150, 50]]), // parking strip: ignored
  line('רחוב פנימי', 3, [[150, 100], [150, 120]]), // second segment of the same street, 20 m inside
] };

describe('planStreets', () => {
  const r = planStreets(square, streets);
  it('finds the bordering boulevard and the crossing street, grouped by name', () => {
    expect(r.streets.map((s) => s.name)).toEqual(['שד הבדיקה', 'רחוב פנימי']);
    const b = r.streets[0], inner = r.streets[1];
    expect(b.rankLabel).toBe('שדרה ראשית');
    expect(b.along_m).toBeGreaterThan(195); expect(b.along_m).toBeLessThan(220); // 200 m plus the buffer reach past each corner
    expect(b.inside_m).toBe(0);
    expect(inner.segments).toBe(2);
    expect(inner.inside_m).toBeGreaterThan(205); expect(inner.inside_m).toBeLessThan(225);
    expect(inner.along_m).toBe(0);
    expect(r.mainAlong_m).toBe(b.along_m);
    expect(r.features.features).toHaveLength(3);
  });
  it('a 2 m buffer drops the boulevard 5 m away', () => {
    expect(planStreets(square, streets, 2).streets.map((s) => s.name)).toEqual(['רחוב פנימי']);
  });
  it('reads an insight, entry street and units per metre of main frontage', () => {
    const t = readStreets(r, 1000);
    expect(t.insight).toBe('התכנית נשענת על **שדרה ראשית אחת**');
    expect(t.insight.replace(/\*/g, '').split(' ').length).toBeLessThanOrEqual(8);
    expect(t.explain.replace(/\*/g, '').split(' ').length).toBeLessThanOrEqual(20);
    expect(t.entry?.name).toBe('שד הבדיקה');
    expect(t.unitsPerMainMetre).toBeCloseTo(1000 / (r.mainAlong_m + r.mainInside_m), 5);
    expect(readStreets(r, null).unitsPerMainMetre).toBeNull();
    expect(readStreets(r, null).perMetreNote).toMatch(/^חסר/);
  });
  it('no main frontage and no streets', () => {
    const local = planStreets(square, { type: 'FeatureCollection', features: [streets.features[1]] });
    expect(readStreets(local, 500).insight).toContain('רחובות מקומיים');
    expect(readStreets(local, 500).unitsPerMainMetre).toBeNull();
    expect(planStreets(null, streets).streets).toEqual([]);
    expect(readStreets(planStreets(square, { type: 'FeatureCollection', features: [] }), 5).insight).toContain('אין רחוב');
  });
  it('unread ranks give חסר, not a zero', () => {
    const r5 = planStreets(square, { type: 'FeatureCollection', features: [line('רחוב חדש', 5, [[-50, -5], [250, -5]])] });
    const t = readStreets(r5, 500);
    expect(t.insight).toContain('לא פוענחה');
    expect(t.unitsPerMainMetre).toBeNull();
    expect(t.perMetreNote).toMatch(/^חסר/);
  });
  it('boundaryOf joins every blue-line part; unknown ranks are labelled, not invented', () => {
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: square }, { type: 'Feature', properties: {}, geometry: square }] };
    expect(boundaryOf(fc)?.coordinates).toHaveLength(2);
    expect(rankInfo(7).label).toContain('לא פוענחה');
  });
});
