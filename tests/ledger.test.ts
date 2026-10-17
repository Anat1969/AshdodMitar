import { describe, expect, it } from 'vitest';
import { buildLedger, cityCell, ledgerCell, planBoq, planBucket, splitByArea, type LedgerPlan, type Quantity, type Target } from '../src/lib/ledger';
import { insideAshdod, itmToWgs, looksProjected, polygonsOf, toBoundary } from '../src/lib/gis';

const T = (o: Partial<Target>): Target => ({ district_id: 1, domain_key: 'housing', target: 1000, target_source: 's', target_page: 1, target_certainty: 'plan-draft', existing: 600, existing_date: null, existing_source: 'e', existing_certainty: 'plan-draft', note: null, ...o });
const P = (id: string, status: string, approval_date: string | null = '2024-01-01'): LedgerPlan => ({ id, name: id, plan_number: id, status, approval_date });
let n = 0;
const Q = (o: Partial<Quantity>): Quantity => ({ id: `q${n++}`, plan_id: 'a', district_id: 1, domain_key: 'housing', value: 100, doc_id: null, page: 3, quote: null, split: 'single', share: null, status: 'approved', origin: 'manual', note: null, approved_by: 'x', approved_at: null, ...o });

describe('ledger: remaining = target - existing - approved plans', () => {
  it('subtracts existing and approved plans', () => {
    const c = ledgerCell(1, 'housing', T({}), [P('a', 'approved'), P('b', 'approved')], [Q({ plan_id: 'a', value: 100 }), Q({ plan_id: 'b', value: 50 })]);
    expect(c.approved).toBe(150);
    expect(c.remaining).toBe(250);
    expect(c.progress).toBe(0.75);
    expect(c.contributions.map((x) => x.plan_id)).toEqual(['a', 'b']);
  });
  it('counts only approved data', () => {
    const c = ledgerCell(1, 'housing', T({}), [P('a', 'approved')], [Q({ status: 'draft', value: 999 }), Q({ value: 10 })]);
    expect(c.approved).toBe(10);
    expect(c.drafts).toBe(1);
  });
  it('keeps plans in process out of the total, in the scenario', () => {
    const c = ledgerCell(1, 'housing', T({}), [P('a', 'approved'), P('b', 'deposited'), P('c', 'pipeline'), P('d', 'idea')],
      [Q({ plan_id: 'a', value: 100 }), Q({ plan_id: 'b', value: 200 }), Q({ plan_id: 'c', value: 50 }), Q({ plan_id: 'd', value: 77 })]);
    expect(c.approved).toBe(100);
    expect(c.scenario).toBe(250);
    expect(c.remaining).toBe(300);
    expect(c.scenarioProgress).toBe(0.95);
  });
  it('does not count twice a plan approved before the existing-state date', () => {
    const t = T({ existing_date: '2025-06-30' });
    const c = ledgerCell(1, 'housing', t, [P('old', 'approved', '2020-05-01'), P('new', 'approved', '2026-01-01')], [Q({ plan_id: 'old', value: 300 }), Q({ plan_id: 'new', value: 100 })]);
    expect(c.approved).toBe(100);
    expect(c.contributions.find((x) => x.plan_id === 'old')?.bucket).toBe('in-existing');
    expect(planBucket(P('old', 'approved', '2025-06-30'), '2025-06-30')).toBe('in-existing');
  });
  it('returns missing (null) when existing or target is unknown, never zero', () => {
    const c = ledgerCell(1, 'openspace', T({ domain_key: 'openspace', existing: null }), [P('a', 'approved')], [Q({ domain_key: 'openspace', value: 40 })]);
    expect(c.remaining).toBeNull();
    expect(c.progress).toBeNull();
    expect(c.remainingBeforeExisting).toBe(960);
    const m = ledgerCell(1, 'public', null, [], []);
    expect(m.target).toBeNull();
    expect(m.remainingBeforeExisting).toBeNull();
  });
  it('flags over-target and marks area splits as estimates', () => {
    const c = ledgerCell(1, 'housing', T({}), [P('a', 'approved')], [Q({ value: 500, split: 'area' })]);
    expect(c.remaining).toBe(-100);
    expect(c.flags).toContain('over');
    expect(c.estimated).toBe(true);
  });
  it('flags public needs lagging behind housing', () => {
    const targets = [T({}), T({ domain_key: 'education', target: 100, existing: 20 })];
    const l = buildLedger([1], [{ key: 'housing' }, { key: 'education' }], targets, [P('a', 'approved')], [Q({ value: 300 })]);
    expect(l[1].housing.progress).toBe(0.9);
    expect(l[1].education.progress).toBe(0.2);
    expect(l[1].education.flags).toContain('lag');
  });
  it('sums the city only over districts that have a target', () => {
    const targets = [T({}), T({ district_id: 2, target: null, existing: null })];
    const l = buildLedger([1, 2], [{ key: 'housing' }], targets, [P('a', 'approved')], [Q({ value: 100 }), Q({ district_id: 2, value: 5 })]);
    const c = cityCell(l, 'housing');
    expect(c.target).toBe(1000);
    expect(c.remaining).toBe(300);
    expect(c.approved).toBe(105);
  });
  it('city remaining is partial over districts with a known existing state', () => {
    const targets = [T({}), T({ district_id: 2, target: 500, existing: null })];
    const c = cityCell(buildLedger([1, 2], [{ key: 'housing' }], targets, [P('a', 'approved')], [Q({ value: 100 }), Q({ district_id: 2, value: 50 })]), 'housing');
    expect(c.target).toBe(1500);
    expect(c.remaining).toBe(300);
    expect(c.coverage).toEqual({ known: 1, of: 2 });
  });
  it('plan bill of quantities shows the remaining before the plan', () => {
    const qs = [Q({ plan_id: 'a', value: 100 }), Q({ plan_id: 'b', value: 50 })];
    const l = buildLedger([1], [{ key: 'housing' }], [T({})], [P('a', 'approved'), P('b', 'approved')], qs);
    const rows = planBoq('a', qs, l);
    expect(rows[0].remainingBefore).toBe(350);
    expect(rows[0].shareOfTarget).toBe(0.1);
  });
});

describe('split by area', () => {
  it('keeps the total and the shares', () => {
    const r = splitByArea(100, [{ district_id: 2, area_m2: 2000 }, { district_id: 3, area_m2: 1000 }]);
    expect(r.map((x) => x.district_id)).toEqual([2, 3]);
    expect(r.reduce((a, x) => a + x.value, 0)).toBeCloseTo(100, 6);
    expect(r[0].share).toBe(0.667);
  });
  it('returns nothing without area', () => expect(splitByArea(10, [])).toEqual([]));
});

describe('gis', () => {
  it('reprojects Israel TM Grid coordinates into Ashdod', () => {
    const [lon, lat] = itmToWgs([166500, 634000]);
    expect(lon).toBeGreaterThan(34.6); expect(lon).toBeLessThan(34.72);
    expect(lat).toBeGreaterThan(31.75); expect(lat).toBeLessThan(31.85);
  });
  it('reads a GeoJSON FeatureCollection in ITM and returns WGS84', () => {
    const ring = [[166000, 633500], [166600, 633500], [166600, 634100], [166000, 634100], [166000, 633500]];
    const polys = polygonsOf({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }] });
    expect(looksProjected(polys)).toBe(true);
    const b = toBoundary(polys)!;
    expect(b.type).toBe('Polygon');
    expect(insideAshdod(b)).toBe(true);
  });
  it('keeps lon/lat GeoJSON and merges several polygons', () => {
    const sq = (x: number) => [[[x, 31.8], [x + 0.01, 31.8], [x + 0.01, 31.81], [x, 31.81], [x, 31.8]]];
    const b = toBoundary(polygonsOf({ type: 'MultiPolygon', coordinates: [sq(34.64), sq(34.66)] }))!;
    expect(b.type).toBe('MultiPolygon');
    expect(insideAshdod(b)).toBe(true);
  });
});
