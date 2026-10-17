import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadDecisions, loadPlans, loadPublic, loadQuantities, toInput, type Decision, type Plan, type PublicData } from './data';
import { buildLedger, type Domain, type Ledger, type Quantity } from './ledger';
import { districtGate, renewalBalance, type RuleResult } from './rules';
import { useAuth } from './auth';
import { type TopicCell, type TopicKey } from './topics';

interface Store extends PublicData {
  plans: Plan[]; decisions: Decision[]; loading: boolean; error: string | null;
  gates: Record<number, RuleResult>; renewal: RuleResult; refresh: () => Promise<void>;
  matrix: Record<number, Record<TopicKey, TopicCell>>;
  quantities: Quantity[]; ledger: Ledger; factDomains: Domain[];
}
const Ctx = createContext<Store | null>(null);
const EMPTY: PublicData = { city: null, districts: [], features: [], rules: [], register: [], existing: [], domains: [], targets: [] };

export function StoreProvider({ children }: { children: ReactNode }) {
  const { isMember, ready } = useAuth();
  const [pub, setPub] = useState<PublicData>(EMPTY);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [quantities, setQuantities] = useState<Quantity[]>([]);
  const [factDomains, setFactDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const p = await loadPublic();
      // target domains drive the ledger; "fact" domains (units existing / proposed, areas, floors) feed the plan card only
      setPub({ ...p, domains: p.domains.filter((d) => (d.kind ?? 'target') === 'target') });
      setFactDomains(p.domains.filter((d) => d.kind === 'fact'));
      // published plans and approved quantities are public; members also get drafts and example plans (RLS)
      const [pl, qs, de] = await Promise.all([loadPlans(), loadQuantities(), isMember ? loadDecisions() : Promise.resolve([])]);
      setPlans(pl); setQuantities(qs); setDecisions(de);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [isMember]);

  useEffect(() => { if (ready) refresh(); }, [ready, refresh]);

  const gates = useMemo(() => {
    const out: Record<number, RuleResult> = {};
    for (const d of pub.districts) out[d.id] = districtGate(d, plans.filter((p) => p.district_id === d.id).map(toInput));
    return out;
  }, [pub.districts, plans]);
  const renewal = useMemo(() => renewalBalance(plans.map(toInput)), [plans]);
  const ledger = useMemo(() => buildLedger(pub.districts.map((d) => d.id), pub.domains, pub.targets, plans, quantities), [pub.districts, pub.domains, pub.targets, plans, quantities]);
  // matrix: the ledger in the shape the topic tables and the map already read (planned = approved + in process)
  const matrix = useMemo(() => {
    const out: Record<number, Record<TopicKey, TopicCell>> = {};
    for (const [id, row] of Object.entries(ledger)) {
      out[Number(id)] = Object.fromEntries(Object.entries(row).map(([k, c]) => [k, {
        existing: c.existing, planned: c.approved + c.scenario, approved: c.approved, target: c.target, gap: c.remaining,
        progress: c.progress, certainty: c.certainty as TopicCell['certainty'], existingSource: c.t?.existing_source ?? null,
      }])) as Record<TopicKey, TopicCell>;
    }
    return out;
  }, [ledger]);

  return <Ctx.Provider value={{ ...pub, plans, decisions, loading, error, gates, renewal, refresh, matrix, quantities, ledger, factDomains }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('StoreProvider missing');
  return c;
}
