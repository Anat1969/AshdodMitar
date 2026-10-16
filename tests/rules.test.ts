import { describe, expect, it } from 'vitest';
import districtsJson from '../data/districts.json';
import plansJson from '../data/test_plans.json';
import expected from '../data/test_expected.json';
import { checkPlan, districtGate, renewalBalance, type DistrictInput, type PlanInput } from '../src/lib/rules';

const districts = districtsJson.districts as unknown as DistrictInput[];
const plans = plansJson as unknown as (PlanInput & { id: string; districtId: number })[];
const exp = expected as Record<string, unknown>;

describe('rules engine matches data/test_expected.json', () => {
  for (const p of plans) {
    it(`plan ${p.id}`, () => {
      const d = districts.find((x) => x.id === p.districtId);
      const out = checkPlan(p, d).map(({ id, status, values, message }) => ({ id, status, values, message }));
      expect(out).toEqual(exp[p.id]);
    });
  }
  it('G61 renewal balance', () => {
    expect(JSON.parse(JSON.stringify(renewalBalance(plans)))).toEqual(exp.G61);
  });
  it('G63 district gate example', () => {
    const d2 = { ...districts.find((x) => x.id === 2)!, existing_pop: 70000 };
    const r = districtGate(d2, plans.filter((p) => p.districtId === 2));
    expect(JSON.parse(JSON.stringify(r))).toEqual(exp.G63_example);
  });
});
