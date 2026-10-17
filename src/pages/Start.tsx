// Home (simple flow, page 1): the master plan's housing target against approved, in process and missing.
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { fmt } from '../lib/data';
import { Loading, Page } from '../components/ui';
import RemainingMap from '../components/RemainingMap';
import { GapLegend, GapRow, gapRows } from '../components/GapBars';

export function housingTotals(districts: { id: number; units_added: number | null }[], ledger: Record<number, Record<string, { approved: number; scenario: number }>>) {
  const known = districts.filter((d) => d.units_added != null && d.units_added > 0);
  const target = known.reduce((a, d) => a + (d.units_added as number), 0);
  const approved = Object.values(ledger).reduce((a, r) => a + (r.housing?.approved ?? 0), 0);
  const process = Object.values(ledger).reduce((a, r) => a + (r.housing?.scenario ?? 0), 0);
  return { target, approved, process, missing: Math.max(0, target - approved - process), districtsKnown: known.length };
}

export default function StartPage() {
  const { districts, ledger, quantities, plans, domains, loading, error } = useStore();
  const { isMember } = useAuth();
  const [sp, setSp] = useSearchParams();
  const dom = sp.get('domain') ?? 'housing';
  const setDom = (k: string) => { const n = new URLSearchParams(sp); n.set('domain', k); setSp(n, { replace: true }); };
  if (loading) return <main className="page"><Loading error={error} /></main>;
  const t = housingTotals(districts, ledger);
  const pct = (v: number) => (t.target ? Math.min(100, (v / t.target) * 100) : 0);
  const drafts = quantities.filter((q) => q.status === 'draft' && q.domain_key === 'housing').length;
  const real = plans.filter((p) => !p.is_example);
  const noHousing = districts.filter((d) => d.units_added == null && d.target_pop).map((d) => d.name);

  return (
    <Page kicker="תאום מתאר אשדוד" title="כמה דירות נוספו בדרך ליעד">
      <section className="card start-card" data-testid="start-card">
        <div className="start-nums">
          <div><span className="mono big">{fmt(t.target)}</span><span>יעד תוספת יח"ד בתכנית המתאר</span></div>
          <div className="s-approved"><span className="mono big">{fmt(t.approved)}</span><span>מאושר</span></div>
          <div className="s-process"><span className="mono big">{fmt(t.process)}</span><span>בהליך</span></div>
          <div className="s-missing"><span className="mono big">{fmt(t.missing)}</span><span>חסר</span></div>
        </div>
        <div className="start-bar" role="img" aria-label={`מאושר ${Math.round(pct(t.approved))}%, בהליך ${Math.round(pct(t.process))}%`}>
          <motion.span className="seg-approved" initial={{ width: 0 }} animate={{ width: `${pct(t.approved)}%` }} transition={{ duration: 0.8 }} />
          <motion.span className="seg-process" initial={{ width: 0 }} animate={{ width: `${pct(t.process)}%` }} transition={{ duration: 0.8, delay: 0.2 }} />
        </div>
        <div className="start-legend ls"><span>מאושר: {Math.round(pct(t.approved))}%</span><span>בהליך: {Math.round(pct(t.process))}%</span><span>חסר: {Math.round(100 - pct(t.approved) - pct(t.process))}%</span></div>
        <div className="ls">היעד: סכום תוספת יח"ד שתכנית המתאר (603-0528026, לא בתוקף) קובעת ל-{t.districtsKnown} מתחמים.{noHousing.length ? ` חסר יעד ל: ${noHousing.join(', ')}.` : ''} נספרת התוספת נטו של כל תכנית.</div>
        {isMember && drafts > 0 && <div className="notice">{drafts} נתוני יח"ד עוד לא נקלטו (תיקי התכניות, בכלים נוספים).</div>}
      </section>
      <RemainingMap domainKey={dom} onDomain={setDom} />
      <section className="card gap-card" data-testid="city-gap">
        <div className="card-head"><h2>כל התחומים: מה צריך, מה כל תכנית עושה, ומה נשאר</h2><GapLegend /></div>
        {gapRows(ledger, domains, plans, districts.map((d) => d.id)).map((r) => <GapRow key={r.key} r={r} />)}
        <div className="ls">סכום כל המתחמים שיש להם יעד בתחום. כשחסר מצב קיים, "נשאר" אינו מחושב. לחיצה על תכנית פותחת אותה כאן.</div>
      </section>
      <div className="ls">{real.length} תכניות במערכת.</div>
    </Page>
  );
}
