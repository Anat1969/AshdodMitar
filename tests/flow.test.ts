import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import shp from 'shpjs';
import { planLayersFromShp } from '../src/lib/planlayers';
import { parseRightsTable } from '../src/lib/mavat';
import { statusFromText, toResult, xplanUrl } from '../src/lib/xplan';
import { bboxOfFC, findPlan, planKey, statusGroup } from '../src/lib/plansapi';
import { housingTotals } from '../src/pages/Start';
import { guessKind } from '../src/pages/AddPlan';
import type { Plan } from '../src/lib/data';

describe('plan layers from the real תמל/2022 SHP', async () => {
  const all = await (shp as unknown as (b: Buffer) => Promise<never>)(fs.readFileSync(new URL('../public/plans/tml-2022/mavat-shp.zip', import.meta.url)));
  const rights = parseRightsTable(fs.readFileSync(new URL('../public/plans/tml-2022/rights-table-5.xls', import.meta.url), 'utf8'));
  const layers = planLayersFromShp(all, rights);
  const by = (k: string) => layers.find((l) => l.kind === k)!;
  it('takes each layer from its own SHP layer, marked exact', () => {
    expect(layers.map((l) => l.kind)).toEqual(['blue_line', 'land_use', 'building_lines', 'demolish', 'proposed']);
    expect(by('blue_line').geojson.features).toHaveLength(2);
    expect(by('land_use').geojson.features).toHaveLength(37);
    expect(by('demolish').geojson.features).toHaveLength(31);
    expect(by('building_lines').geojson.features.length).toBe(39);
    for (const k of ['blue_line', 'land_use', 'building_lines', 'demolish']) expect(by(k).accuracy).toBe('exact');
  });
  it('approximates proposed massing by allowed floors and says so', () => {
    const p = by('proposed');
    expect(p.accuracy).toBe('approx');
    const lot102 = p.geojson.features.find((f) => f.properties?.lot === '102')!;
    expect(lot102.properties).toMatchObject({ floors: 32, units: 517, height: Math.round(32 * 3.3) });
  });
});

describe('Xplan', () => {
  it('queries by plan number in WGS84', () => {
    const u = xplanUrl("603-0380584");
    expect(u).toContain(encodeURIComponent("pl_number='603-0380584'"));
    expect(u).toContain('outSR=4326');
  });
  it('reads GeoJSON and Esri JSON answers', () => {
    const ring = [[34.6, 31.8], [34.61, 31.8], [34.61, 31.81], [34.6, 31.8]];
    expect(toResult({ features: [{ geometry: { type: 'Polygon', coordinates: [ring] }, properties: { pl_name: 'x' } }] })?.props).toEqual({ pl_name: 'x' });
    expect(toResult({ features: [{ geometry: { rings: [ring] }, attributes: { pl_name: 'y' } }] })?.boundary.type).toBe('Polygon');
    expect(toResult({ features: [] })).toBeNull();
  });
  it('maps status text', () => {
    expect(statusFromText('אישור למתן תוקף')).toBe('approved');
    expect(statusFromText('הפקדה')).toBe('deposited');
    expect(statusFromText(null)).toBe('pipeline');
  });
});

describe('simple flow helpers', () => {
  const plan = { id: 'x', plan_number: 'תמל/2022', mavat_number: '603-0380584' } as Plan;
  it('finds a plan by its מבא"ת number or its encoded plan number', () => {
    expect(planKey(plan)).toBe('603-0380584');
    expect(findPlan([plan], '603-0380584')).toBe(plan);
    expect(findPlan([plan], encodeURIComponent('תמל/2022'))).toBe(plan);
    expect(findPlan([plan], 'nope')).toBeNull();
  });
  it('groups statuses for the map', () => {
    expect(statusGroup('approved')).toBe('approved');
    expect(statusGroup('deposited')).toBe('process');
    expect(statusGroup('pipeline')).toBe('prep');
  });
  it('home totals: target is the sum of district additions; missing never negative', () => {
    const t = housingTotals([{ id: 1, units_added: 1000 }, { id: 2, units_added: null }, { id: 3, units_added: 500 }], { 1: { housing: { approved: 300, scenario: 200 } }, 3: { housing: { approved: 1400, scenario: 0 } } });
    expect(t).toMatchObject({ target: 1500, approved: 1700, process: 200, missing: 0, districtsKnown: 2 });
  });
  it('classifies dropped files', () => {
    expect(guessKind('mavat.zip')).toBe('gis');
    expect(guessKind('rights.xls')).toBe('table');
    expect(guessKind('תשריט מצב מוצע.pdf')).toBe('tashrit');
    expect(guessKind('נספח בינוי.pdf')).toBe('building');
    expect(guessKind('horaot.pdf')).toBe('instructions');
    expect(guessKind('plan.dwg')).toBe('other');
  });
  it('bbox of a collection', () => {
    expect(bboxOfFC({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }, { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 0] }, properties: {} }] })).toEqual([1, 0, 3, 2]);
  });
});

import { gapRows } from '../src/components/GapBars';
describe('gap rows', () => {
  const cell = (target: number | null, existing: number | null, contributions: { plan_id: string; value: number; bucket: 'approved' | 'scenario' }[] = []) => ({ target, existing, contributions } as never);
  const ledger = { 1: { housing: cell(1000, 600, [{ plan_id: 'a', value: 100, bucket: 'approved' }]) }, 2: { housing: cell(500, null) }, 3: { housing: cell(800, 700, [{ plan_id: 'b', value: 50, bucket: 'scenario' }]) } };
  const plans = [{ id: 'a', plan_number: 'A', name: 'a', is_example: false }, { id: 'b', plan_number: 'B', name: 'b', is_example: false }] as never;
  it('sums needed only where the existing state is known, and highlights the plan', () => {
    const [r] = gapRows(ledger as never, [{ key: 'housing', title: 'יח"ד', unit: 'יח"ד', sort: 1, target_rule: null, target_certainty: 'plan-draft' }], plans, [1, 2, 3], 'a');
    expect(r).toMatchObject({ target: 1800, existing: 1300, partial: 1 });
    expect(r.parts.map((p) => [p.label, p.value, p.scenario, p.highlight])).toEqual([['A', 100, false, true], ['B', 50, true, false]]);
  });
});

describe('3D floors and quarters (2026-10-17)', () => {
  it('cuts a tower into floors and keeps the envelope whole', async () => {
    const { sliceFloors } = await import('../src/lib/planlayers');
    const sq = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    const fc = sliceFloors({ type: 'FeatureCollection', features: [
      { type: 'Feature', geometry: sq, properties: { kind: 'envelope', height: 60 } },
      { type: 'Feature', geometry: sq, properties: { kind: 'tower', base: 13.2, height: 46.2 } },
    ] });
    expect(fc.features.filter((f) => f.properties?.kind === 'envelope')).toHaveLength(1);
    const t = fc.features.filter((f) => f.properties?.kind === 'tower');
    expect(t).toHaveLength(10);
    expect(t[0].properties!.base).toBeCloseTo(13.2);
    expect(t[9].properties!.height).toBeLessThan(46.2);
    expect(t[9].properties!.height).toBeGreaterThan(45);
  });
  it('finds the quarter of a plan by point in polygon', async () => {
    const { inPolygon } = await import('../src/lib/planlayers');
    const sq = { type: 'Polygon' as const, coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    expect(inPolygon([1, 1], sq)).toBe(true);
    expect(inPolygon([3, 1], sq)).toBe(false);
    expect(inPolygon([1, 1], { type: 'MultiPolygon', coordinates: [sq.coordinates] })).toBe(true);
  });
  it('share of the whole as text', async () => {
    const { shareText } = await import('../src/lib/peek');
    expect(shareText(3544, 11100)).toBe('31.9%');
    expect(shareText(5, null)).toBeNull();
  });
});
