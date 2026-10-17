import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isAreasTable, isRightsTable, parseAreasTable, parseRightsTable, quantitiesFromAreas, quantitiesFromRights, rightsTotals } from '../src/lib/mavat';
import { pickLayers } from '../src/lib/gis';

// Real files of plan תמל/2022 (603-0380584), exported from מבא"ת
const rightsHtml = fs.readFileSync(new URL('../public/plans/tml-2022/rights-table-5.xls', import.meta.url), 'utf8');
const areasHtml = fs.readFileSync(new URL('../public/plans/tml-2022/areas-table.xls', import.meta.url), 'utf8').replace(/^﻿/, '');

describe('מבא"ת rights table (טבלה 5)', () => {
  const rows = parseRightsTable(rightsHtml);
  it('is recognised and reads every lot row', () => {
    expect(isRightsTable(rightsHtml)).toBe(true);
    expect(isAreasTable(rightsHtml)).toBe(false);
    expect(rows.length).toBe(41);
    expect(rows[0]).toMatchObject({ yeud: 'מגורים מסחר ותעסוקה', use: 'מגורים', lot: '101', builtM2: 25590, units: 203 });
  });
  it('sums match the table totals', () => {
    const t = rightsTotals(rightsHtml);
    expect(t.units).toBe(2460);
    expect(rows.reduce((a, r) => a + (r.units ?? 0), 0)).toBe(2460);
    expect(rows.reduce((a, r) => a + (r.builtM2 ?? 0), 0)).toBe(t.builtM2);
  });
  it('maps to domains with sources', () => {
    const q = quantitiesFromRights(rows);
    const get = (k: string) => q.filter((x) => x.domain_key === k).map((x) => x.value);
    expect(get('housing')).toEqual([2460]);
    expect(get('commerce')).toEqual([5461]);
    expect(get('employment')).toEqual([16735, 12372]);
    expect(get('public')).toEqual([5020, 373615]);
    expect(q.find((x) => x.domain_key === 'housing')!.note).toContain('לא תוספת נטו');
  });
});

describe('מבא"ת areas table', () => {
  it('reads 36 lots and the open space', () => {
    const rows = parseAreasTable(areasHtml);
    expect(isAreasTable(areasHtml)).toBe(true);
    expect(rows.length).toBe(36);
    expect(Math.round(rows.reduce((a, r) => a + r.areaM2, 0))).toBe(144521);
    expect(quantitiesFromAreas(rows)[0]).toMatchObject({ domain_key: 'openspace', value: 7439 });
  });
});

describe('Shapefile layers', () => {
  it('takes the boundary from MVT_GVUL, not from every layer', () => {
    const fc = (fileName: string) => ({ type: 'FeatureCollection' as const, features: [], fileName });
    const p = pickLayers([fc('MVT_ARC'), fc('MVT_GVUL'), fc('MVT_PLAN'), fc('MVT_PLAN_NUM')]);
    expect(p.boundaryLayer?.fileName).toBe('MVT_GVUL');
    expect(p.lots?.fileName).toBe('MVT_PLAN');
  });
});
