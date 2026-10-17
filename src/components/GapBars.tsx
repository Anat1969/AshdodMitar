// "What is needed, what each plan does, what is left": one row per domain, a stacked bar and the numbers in large type.
// Bar: existing | each plan (the current plan highlighted) | plans in process (hatched) | remaining gap.
import { Link } from 'react-router-dom';
import { fmt } from '../lib/data';
import type { Domain, Ledger } from '../lib/ledger';
import { PARAMS } from '../lib/rules';
import type { Plan } from '../lib/data';
import { planKey } from '../lib/plansapi';

export interface GapPart { planId: string; label: string; href: string; value: number; scenario: boolean; highlight: boolean }
export interface GapRowData { key: string; title: string; unit: string; target: number | null; existing: number | null; parts: GapPart[]; demand?: { value: number; label: string } | null; partial?: number }

export function gapRows(ledger: Ledger, domains: Domain[], plans: Plan[], districtIds: number[], highlight?: string): GapRowData[] {
  const pmap = new Map(plans.map((p) => [p.id, p]));
  return domains.map((dm) => {
    // target and existing are summed over districts that have both; a district with a target but no existing state
    // is left out of "needed" and counted in `partial`, so "needed" never mixes known and unknown baselines
    let target: number | null = null, existing: number | null = null, tOnly: number | null = null, partial = 0;
    const byPlan = new Map<string, GapPart>();
    for (const id of districtIds) {
      const c = ledger[id]?.[dm.key]; if (!c) continue;
      if (c.target != null && c.existing != null) { target = (target ?? 0) + c.target; existing = (existing ?? 0) + c.existing; }
      else if (c.target != null) { tOnly = (tOnly ?? 0) + c.target; partial += 1; }
      for (const x of c.contributions) {
        if (x.bucket !== 'approved' && x.bucket !== 'scenario') continue;
        const p = pmap.get(x.plan_id); if (!p || p.is_example) continue;
        const cur = byPlan.get(x.plan_id) ?? { planId: x.plan_id, label: p.plan_number ?? p.name, href: `/plan/${planKey(p)}`, value: 0, scenario: x.bucket === 'scenario', highlight: x.plan_id === highlight };
        cur.value += x.value; byPlan.set(x.plan_id, cur);
      }
    }
    const parts = [...byPlan.values()].sort((a, b) => Number(b.highlight) - Number(a.highlight) || b.value - a.value);
    if (target == null && tOnly != null) return { key: dm.key, title: dm.title, unit: dm.unit, target: tOnly, existing: null, parts, partial: 0 };
    return { key: dm.key, title: dm.title, unit: dm.unit, target, existing, parts, partial };
  });
}

// New public demand that added housing creates (policy-draft parameters: household size, cohort share, class size 30 = assumption)
export function demandFromUnits(units: number, sector: 'general' | 'haredi' = 'general') {
  const pop = units * (sector === 'haredi' ? PARAMS.household.haredi : PARAMS.household.general_existing);
  const share = sector === 'haredi' ? PARAMS.cohortShare.haredi : PARAMS.cohortShare.general_existing;
  return { population: Math.round(pop), classes: Math.ceil((pop * share * PARAMS.elementaryGrades) / PARAMS.classSize), kinder: Math.ceil((pop * share * 3) / 30) };
}

export function GapRow({ r }: { r: GapRowData }) {
  const approved = r.parts.filter((p) => !p.scenario).reduce((a, p) => a + p.value, 0);
  const scen = r.parts.filter((p) => p.scenario).reduce((a, p) => a + p.value, 0);
  const need = r.target != null ? r.target - (r.existing ?? 0) : null;
  const left = need != null && r.existing != null ? need - approved : null;
  const scale = Math.max(r.target ?? 0, (r.existing ?? 0) + approved + scen, 1);
  const w = (v: number) => `${Math.max(0, (v / scale) * 100)}%`;
  const thisPlan = r.parts.find((p) => p.highlight);
  return (
    <div className="gap-row" data-domain={r.key}>
      <div className="gap-head">
        <h3>{r.title} <span className="ls">{r.unit}</span></h3>
        <div className="gap-nums">
          <span><span className="gn-label">צריך</span><b className="mono">{need == null ? 'יעד חסר' : r.existing == null ? `${fmt(r.target)} (בלי קיים)` : fmt(need)}</b></span>
          {thisPlan && <span className="gn-this"><span className="gn-label">התכנית</span><b className="mono">{thisPlan.value >= 0 ? '+' : ''}{fmt(thisPlan.value)}</b></span>}
          <span><span className="gn-label">כל התכניות</span><b className="mono">{fmt(approved)}</b>{scen > 0 && <span className="ls"> ועוד {fmt(scen)} בהליך</span>}</span>
          <span className={left != null && left <= 0 ? 'gn-done' : 'gn-left'}><span className="gn-label">נשאר</span><b className="mono">{left == null ? (r.target == null ? 'חסר' : 'חסר קיים') : left <= 0 ? `עומד ביעד (${fmt(-left)} מעבר)` : fmt(left)}</b></span>
        </div>
      </div>
      <div className="gap-bar" role="img" aria-label={`${r.title}: יעד ${fmt(r.target)}, קיים ${fmt(r.existing)}, תכניות ${fmt(approved)}`}>
        {r.existing != null && r.existing > 0 && <span className="gb-existing" style={{ width: w(r.existing) }} title={`קיים ${fmt(r.existing)}`} />}
        {r.parts.filter((p) => !p.scenario && p.value > 0).map((p) => <span key={p.planId} className={p.highlight ? 'gb-this' : 'gb-plan'} style={{ width: w(p.value) }} title={`${p.label}: ${fmt(p.value)}`} />)}
        {r.parts.filter((p) => p.scenario && p.value > 0).map((p) => <span key={p.planId} className={p.highlight ? 'gb-this gb-scn' : 'gb-scn'} style={{ width: w(p.value) }} title={`${p.label} (בהליך): ${fmt(p.value)}`} />)}
        {r.target != null && <span className="gb-target" style={{ insetInlineStart: w(r.target) }} />}
      </div>
      <div className="gap-parts">
        {r.parts.length ? r.parts.map((p) => <Link key={p.planId} to={p.href} className={`gp ${p.highlight ? 'gp-this' : ''}`}><span className="mono">{p.label}</span> {p.value >= 0 ? '+' : ''}{fmt(p.value)}{p.scenario ? ' בהליך' : ''}</Link>) : <span className="ls">אין עדיין תכנית שתורמת לתחום</span>}
        {r.demand && <span className="gp gp-demand">{r.demand.label}: {fmt(r.demand.value)}</span>}
      </div>
      {!!r.partial && <div className="ls">בלי {r.partial} {r.partial === 1 ? 'מתחם' : 'מתחמים'} שאין להם מצב קיים.</div>}
    </div>
  );
}

export function GapLegend() {
  return <div className="gap-legend ls"><span><i className="gb-existing" />קיים</span><span><i className="gb-this" />התכנית הזו</span><span><i className="gb-plan" />תכניות אחרות</span><span><i className="gb-scn" />בהליך</span><span><i className="gb-target-i" />יעד</span></div>;
}
