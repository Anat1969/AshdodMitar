import fs from 'node:fs';
import { checkPlan, districtGate, renewalBalance } from './rules-engine.mjs';
const { districts } = JSON.parse(fs.readFileSync(new URL('../data/districts.json', import.meta.url)));
const plans = JSON.parse(fs.readFileSync(new URL('../data/test_plans.json', import.meta.url)));
const out = {};
for (const p of plans) {
  const d = districts.find((x) => x.id === p.districtId);
  out[p.id] = checkPlan(p, d).map(({ id, status, values, message }) => ({ id, status, values, message }));
}
out.G61 = renewalBalance(plans);
const d2 = { ...districts.find((x) => x.id === 2), existing_pop: 70000 }; // illustrative only
out.G63_example = districtGate(d2, plans.filter((p) => p.districtId === 2));
fs.writeFileSync(new URL('../data/test_expected.json', import.meta.url), JSON.stringify(out, null, 2));
for (const [k, v] of Object.entries(out)) { console.log('==', k); (Array.isArray(v) ? v : [v]).forEach((r) => console.log(r.id, r.status, '|', r.message)); }
