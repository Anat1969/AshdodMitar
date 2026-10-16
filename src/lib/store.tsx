import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { loadDecisions, loadPlans, loadPublic, toInput, type Decision, type Plan, type PublicData } from './data';
import { districtGate, renewalBalance, type RuleResult } from './rules';
import { useAuth } from './auth';
import { TOPICS, topicCell, type TopicCell, type TopicKey } from './topics';

interface Store extends PublicData {
  plans: Plan[]; decisions: Decision[]; loading: boolean; error: string | null;
  gates: Record<number, RuleResult>; renewal: RuleResult; refresh: () => Promise<void>;
  matrix: Record<number, Record<TopicKey, TopicCell>>;
}
const Ctx = createContext<Store | null>(null);
const EMPTY: PublicData = { city: null, districts: [], features: [], rules: [], register: [], existing: [] };

export function StoreProvider({ children }: { children: ReactNode }) {
  const { isMember, ready } = useAuth();
  const [pub, setPub] = useState<PublicData>(EMPTY);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const p = await loadPublic();
      setPub(p);
      if (isMember) {
        const [pl, de] = await Promise.all([loadPlans(), loadDecisions()]);
        setPlans(pl); setDecisions(de);
      } else { setPlans([]); setDecisions([]); }
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
  const matrix = useMemo(() => {
    const inputs = plans.map(toInput);
    const ex = pub.existing.map((e) => ({ topic: e.topic, subtype: e.subtype, district_id: e.district_id, qty: e.qty }));
    const out: Record<number, Record<TopicKey, TopicCell>> = {};
    for (const d of pub.districts) {
      const dd = { id: d.id, target_pop: d.target_pop, units_added: d.units_added, employment_m2: d.employment_m2, sector_hint: d.id === 4 ? 'haredi' as const : 'general' as const };
      out[d.id] = Object.fromEntries(TOPICS.map((t) => [t.key, topicCell(t.key, dd, inputs, ex)])) as Record<TopicKey, TopicCell>;
    }
    return out;
  }, [pub.districts, pub.existing, plans]);

  return <Ctx.Provider value={{ ...pub, plans, decisions, loading, error, gates, renewal, refresh, matrix }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('StoreProvider missing');
  return c;
}
