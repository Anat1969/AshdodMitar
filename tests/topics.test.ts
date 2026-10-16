import { describe, expect, it } from 'vitest';
import plansJson from '../data/test_plans.json';
import { billOfQuantities, targetFor, topicCell, type PlanForTopics } from '../src/lib/topics';

const T1 = { ...(plansJson as unknown as PlanForTopics[])[0], program: { classrooms: 4, kindergartens: 2, education_dunam: 1.2, open_space_m2: 900, commerce_m2: 1500, roads_m: 350 } };

describe('bill of quantities', () => {
  const rows = billOfQuantities(T1);
  const by = (k: string) => rows.find((r) => r.key === k)!;
  it('classrooms: provided 4 vs required 6 from R03 => fail, balance -2', () => {
    expect(by('classrooms')).toMatchObject({ provided: 4, required: 6, balance: -2, status: 'fail', certainty: 'assumption' });
  });
  it('kindergarten classes: 1320 people x 2% x 3 / 30 = 3 (ceil)', () => {
    expect(by('kinder')).toMatchObject({ required: 3, provided: 2, status: 'fail' });
  });
  it('education land: 1.2 provided vs 1.8 required', () => {
    expect(by('edu_land')).toMatchObject({ required: 1.8, provided: 1.2, status: 'fail' });
  });
  it('threshold yard uses R05 counted vs required', () => {
    expect(by('open_space')).toMatchObject({ required: 2640, provided: 1310, status: 'fail' });
  });
  it('public benefit uses R04', () => {
    expect(by('public')).toMatchObject({ required: 2420, provided: 2600, status: 'pass' });
  });
  it('rows without a target are info, never invented', () => {
    expect(by('commerce')).toMatchObject({ required: null, status: 'info', provided: 1500 });
    expect(by('roads')).toMatchObject({ required: null, status: 'info' });
  });
  it('open space falls back to the program total when no yard breakdown is entered', () => {
    const r = billOfQuantities({ ...T1, yard: { green: 0, hard: 0, roofs: 0, schoolyards: 0 } });
    expect(r.find((x) => x.key === 'open_space')).toMatchObject({ provided: 900, required: 2640, status: 'fail' });
  });
  it('missing provided value is "missing"', () => {
    const r = billOfQuantities({ ...T1, program: {} });
    expect(r.find((x) => x.key === 'classrooms')).toMatchObject({ provided: null, status: 'missing' });
  });
});

describe('district topic matrix', () => {
  const d = { id: 2, target_pop: 88000, units_added: 11100, employment_m2: 600000 };
  it('targets', () => {
    expect(targetFor('education', d)).toBe(Math.ceil((88000 * 0.02 * 6) / 30));
    expect(targetFor('openspace', d)).toBe(264000);
    expect(targetFor('public', d)).toBeNull();
  });
  it('existing + planned vs target', () => {
    const existing = [{ topic: 'education', subtype: 'בית ספר', district_id: 2, qty: { classes: 300, ages: 'יסודי' } }, { topic: 'education', subtype: 'בית ספר', district_id: 2, qty: { classes: 50, ages: 'על יסודי' } }];
    const c = topicCell('education', d, [{ ...T1, districtId: 2 }], existing);
    expect(c).toMatchObject({ existing: 300, planned: 4, target: 352, gap: 48 });
    expect(c.progress).toBeCloseTo(304 / 352, 3);
  });
  it('housing progress counts planned additions only', () => {
    const c = topicCell('housing', d, [{ ...T1, districtId: 2 }], []);
    expect(c).toMatchObject({ existing: null, planned: 400, target: 11100, gap: 10700 });
  });
});
