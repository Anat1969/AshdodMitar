// Realisation ledger (מאזן מימוש): where each district stands on the way to the master plan's targets.
// remaining = target - existing - sum(approved plans). Pure functions, unit-tested in tests/ledger.test.ts.
// Rules:
//  - only approved quantities (status 'approved') of approved plans count;
//  - plans in process (pipeline, deposited) are a separate scenario, never in the total;
//  - a plan approved on or before the existing-state date is already inside "existing" and is not added again;
//  - unknown => null ("חסר"); nothing is invented.
import type { Certainty } from './rules';

export interface Domain { key: string; title: string; unit: string; sort: number; target_rule: string | null; target_certainty: string }
export interface Target {
  district_id: number; domain_key: string;
  target: number | null; target_source: string | null; target_page: number | null; target_certainty: string;
  existing: number | null; existing_date: string | null; existing_source: string | null; existing_certainty: string; note: string | null;
}
export interface Quantity {
  id: string; plan_id: string; district_id: number | null; domain_key: string; value: number | null;
  doc_id: string | null; page: number | null; quote: string | null; split: 'single' | 'table' | 'area'; share: number | null;
  status: 'draft' | 'approved'; origin: 'ai' | 'manual'; note: string | null; approved_by: string | null; approved_at: string | null;
}
export interface LedgerPlan { id: string; name: string; plan_number: string | null; status: string; approval_date: string | null }

export const IN_PROCESS = ['pipeline', 'deposited'];
export type PlanBucket = 'approved' | 'in-existing' | 'scenario' | 'none';

export function planBucket(p: LedgerPlan, existingDate: string | null): PlanBucket {
  if (p.status === 'approved') return existingDate && p.approval_date && p.approval_date <= existingDate ? 'in-existing' : 'approved';
  if (IN_PROCESS.includes(p.status)) return 'scenario';
  return 'none';
}

export interface Contribution { plan_id: string; value: number; bucket: PlanBucket; split: Quantity['split'] }
export type Flag = 'over' | 'lag' | 'done';
export interface LedgerCell {
  district_id: number; domain_key: string;
  target: number | null; existing: number | null; approved: number; scenario: number;
  remaining: number | null;          // target - existing - approved
  remainingBeforeExisting: number | null; // target - approved, shown when existing is missing
  progress: number | null;           // (existing + approved) / target
  scenarioProgress: number | null;   // (existing + approved + scenario) / target
  contributions: Contribution[];     // per plan, approved data only
  estimated: boolean;                // some contribution was split by area (הערכה)
  drafts: number;                    // quantities waiting for approval
  flags: Flag[];
  certainty: Certainty | string; t: Target | null;
}

const round = (n: number) => +n.toFixed(3);

export function ledgerCell(districtId: number, domainKey: string, t: Target | null, plans: LedgerPlan[], qs: Quantity[]): LedgerCell {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const exDate = t?.existing_date ?? null;
  const mine = qs.filter((q) => q.domain_key === domainKey && q.district_id === districtId);
  const contributions: Contribution[] = [];
  let approved = 0, scenario = 0, estimated = false;
  for (const q of mine) {
    const p = byId.get(q.plan_id);
    if (!p || q.status !== 'approved' || q.value == null) continue;
    const bucket = planBucket(p, exDate);
    contributions.push({ plan_id: p.id, value: q.value, bucket, split: q.split });
    if (bucket === 'approved') { approved += q.value; if (q.split === 'area') estimated = true; }
    if (bucket === 'scenario') scenario += q.value;
  }
  const target = t?.target ?? null;
  const existing = t?.existing ?? null;
  const remaining = target == null || existing == null ? null : round(target - existing - approved);
  const remainingBeforeExisting = target == null ? null : round(target - approved);
  const progress = target && existing != null ? round((existing + approved) / target) : null;
  const scenarioProgress = target && existing != null ? round((existing + approved + scenario) / target) : null;
  const flags: Flag[] = [];
  if (remaining != null && remaining < 0) flags.push('over');
  else if (progress != null && progress >= 1) flags.push('done');
  return {
    district_id: districtId, domain_key: domainKey, target, existing, approved: round(approved), scenario: round(scenario),
    remaining, remainingBeforeExisting, progress, scenarioProgress, contributions, estimated,
    drafts: mine.filter((q) => q.status === 'draft').length,
    flags, certainty: t?.target_certainty ?? 'missing', t,
  };
}

// A public-needs domain "lags" housing when its progress trails housing by more than LAG_GAP (assumption: 15 points).
export const LAG_GAP = 0.15;
export const LAG_DOMAINS = ['education', 'kinder', 'openspace', 'public'];

export type Ledger = Record<number, Record<string, LedgerCell>>;

export function buildLedger(districtIds: number[], domains: Pick<Domain, 'key'>[], targets: Target[], plans: LedgerPlan[], qs: Quantity[]): Ledger {
  const tmap = new Map(targets.map((t) => [`${t.district_id}:${t.domain_key}`, t]));
  const out: Ledger = {};
  for (const d of districtIds) {
    out[d] = {};
    for (const dm of domains) out[d][dm.key] = ledgerCell(d, dm.key, tmap.get(`${d}:${dm.key}`) ?? null, plans, qs);
    const h = out[d].housing?.progress;
    if (h != null) for (const k of LAG_DOMAINS) {
      const c = out[d][k];
      if (c && c.progress != null && c.progress < h - LAG_GAP) c.flags.push('lag');
    }
  }
  return out;
}

// City total over districts with a target. When some lack a known existing state, remaining and progress are
// computed over the districts that have it, and `coverage` says how many (partial, never invented).
export function cityCell(ledger: Ledger, domainKey: string): Omit<LedgerCell, 'district_id' | 't' | 'contributions'> & { coverage: { known: number; of: number } } {
  const cells = Object.values(ledger).map((d) => d[domainKey]).filter(Boolean);
  const withTarget = cells.filter((c) => c.target != null);
  const known = withTarget.filter((c) => c.existing != null);
  const sum = (xs: LedgerCell[], f: (c: LedgerCell) => number) => xs.reduce((a, c) => a + f(c), 0);
  const target = withTarget.length ? sum(withTarget, (c) => c.target as number) : null;
  const kTarget = sum(known, (c) => c.target as number);
  const existing = known.length ? sum(known, (c) => c.existing as number) : null;
  const kApproved = sum(known, (c) => c.approved);
  const remaining = known.length ? round(kTarget - (existing as number) - kApproved) : null;
  const progress = known.length && kTarget ? round(((existing as number) + kApproved) / kTarget) : null;
  const scenarioProgress = known.length && kTarget ? round(((existing as number) + kApproved + sum(known, (c) => c.scenario)) / kTarget) : null;
  const flags: Flag[] = [];
  if (remaining != null && remaining < 0) flags.push('over'); else if (progress != null && progress >= 1) flags.push('done');
  return {
    domain_key: domainKey, target, existing, approved: round(sum(cells, (c) => c.approved)), scenario: round(sum(cells, (c) => c.scenario)), remaining,
    remainingBeforeExisting: target == null ? null : round(target - sum(withTarget, (c) => c.approved)),
    progress, scenarioProgress, estimated: cells.some((c) => c.estimated), drafts: sum(cells, (c) => c.drafts),
    flags, certainty: withTarget[0]?.certainty ?? 'missing', coverage: { known: known.length, of: withTarget.length },
  };
}

// Bill of quantities of one plan, against the targets of the districts it touches.
export interface PlanBoqRow { domain_key: string; district_id: number | null; value: number | null; status: Quantity['status']; split: Quantity['split']; target: number | null; remainingBefore: number | null; shareOfTarget: number | null; q: Quantity }
export function planBoq(planId: string, qs: Quantity[], ledger: Ledger): PlanBoqRow[] {
  return qs.filter((q) => q.plan_id === planId).map((q) => {
    const c = q.district_id != null ? ledger[q.district_id]?.[q.domain_key] : undefined;
    const target = c?.target ?? null;
    const counted = (c?.contributions ?? []).filter((x) => x.plan_id === planId && x.bucket === 'approved').reduce((a, x) => a + x.value, 0);
    const remainingBefore = c?.remaining == null ? null : round(c.remaining + counted);
    return { domain_key: q.domain_key, district_id: q.district_id, value: q.value, status: q.status, split: q.split, target, remainingBefore, shareOfTarget: target && q.value != null ? round(q.value / target) : null, q };
  });
}

// Split a whole-plan quantity between districts by area share. Shares sum to 1; values keep the original total.
export function splitByArea(value: number, parts: { district_id: number; area_m2: number }[]): { district_id: number; value: number; share: number }[] {
  const total = parts.reduce((a, p) => a + p.area_m2, 0);
  if (!total) return [];
  const rows = parts.map((p) => ({ district_id: p.district_id, share: round(p.area_m2 / total), value: round((value * p.area_m2) / total) }));
  const drift = round(value - rows.reduce((a, r) => a + r.value, 0));
  if (rows.length && drift) rows[0].value = round(rows[0].value + drift);
  return rows;
}

export const FLAG_LABEL: Record<Flag, string> = { over: 'חריגה מעל היעד', lag: 'מפגר אחרי יח"ד', done: 'הושג היעד' };
export const BUCKET_LABEL: Record<PlanBucket, string> = { approved: 'נספר', 'in-existing': 'כלול בקיים', scenario: 'תרחיש', none: 'לא נספר' };
