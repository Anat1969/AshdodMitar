import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fmt, PLAN_STATUS_LABEL, toInput } from '../lib/data';
import { population } from '../lib/rules';
import { CertaintyChip, Loading, Page, RuleCard, StatusChip } from '../components/ui';

export default function ReportPage() {
  const { year } = useParams();
  const { city, districts, plans, decisions, gates, renewal, register, loading, error } = useStore();
  const { canWrite, isMember } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  if (loading || !city) return <main className="page"><Loading error={error} /></main>;
  const y = Number(year) || new Date().getFullYear();
  const yearDecisions = decisions.filter((d) => (d.decided_at ?? d.created_at).startsWith(String(y)));
  const gaps = register.filter((r) => r.certainty === 'missing' || r.gap_note).length;

  const snapshot = async () => {
    const payload = { city, gates, renewal, plans: plans.map((p) => ({ id: p.id, name: p.name, status: p.status, district: p.district_id, units: p.units_added })), decisions: yearDecisions.length };
    const { error: e } = await supabase.from('mt_snapshots').insert({ year: y, payload });
    setMsg(e ? `שגיאה: ${e.message}` : 'תמונת המצב נשמרה');
  };

  return (
    <Page kicker={`סעיף 6.2 · ${y}`} title="דוח מלאי תכנון ומעקב שנתי"
      actions={<>
        <Link className="btn ghost" to={`/report/${y - 1}`}>{y - 1}</Link>
        <Link className="btn ghost" to={`/report/${y + 1}`}>{y + 1}</Link>
        <button type="button" className="btn" onClick={() => window.print()}>הדפסה</button>
        {canWrite && <button type="button" className="btn primary" onClick={snapshot}>שמירת תמונת מצב</button>}
      </>}>
      {msg && <div className="notice">{msg}</div>}
      {!isMember && <div className="notice">הדוח המלא כולל תכניות והחלטות, ופתוח לחברי הצוות. כאן מוצגים נתוני התכנית והמתחמים בלבד.</div>}
      <section className="card">
        <div className="card-head"><h2>תמונה עירונית</h2><CertaintyChip certainty="plan-draft" /></div>
        <dl className="kv">
          <dt>תושבים</dt><dd className="mono">{fmt(city.current_pop)} ({city.current_pop_date})</dd>
          <dt>יעד התכנית</dt><dd className="mono">{fmt(city.plan_target_pop)} ({city.plan_target_year})</dd>
          <dt>צנרת לפי מסמך המדיניות</dt><dd className="mono">{fmt(city.pipeline_pop)}</dd>
          <dt>תכניות בתאום</dt><dd className="mono">{isMember ? plans.length : 'לצוות'}</dd>
          <dt>החלטות בשנה</dt><dd className="mono">{isMember ? yearDecisions.length : 'לצוות'}</dd>
          <dt>מסמכי מדיניות עם חוסר</dt><dd className="mono">{gaps} מתוך {register.length}</dd>
        </dl>
      </section>
      <section className="card">
        <div className="card-head"><h2>מתחמים מול סף 6.3</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>מתחם</th><th>יעד</th><th>קיים</th><th>מאושר</th><th>צנרת</th><th>סף</th></tr></thead>
            <tbody>{districts.map((d) => {
              const g = gates[d.id];
              return <tr key={d.id}><td>{d.id}. {d.name}</td><td className="mono">{fmt(d.target_pop)}</td><td className="mono">{fmt(d.existing_pop)}</td>
                <td className="mono">{isMember ? fmt(g.values.approved as number) : 'לצוות'}</td><td className="mono">{isMember ? fmt(g.values.pipeline as number) : 'לצוות'}</td><td><StatusChip status={g.status} gate /></td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>
      {isMember && <section><div className="section-head"><h2>איזון התחדשות, סעיף 6.1</h2></div><RuleCard r={renewal} /></section>}
      {isMember && (
        <section className="card">
          <div className="card-head"><h2>תכניות</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>תכנית</th><th>מתחם</th><th>סטטוס</th><th>יח"ד</th><th>תושבים</th></tr></thead>
              <tbody>{plans.map((p) => <tr key={p.id}><td><Link to={`/plan/${p.id}`}>{p.name}</Link></td><td className="mono">{p.district_id}</td><td>{PLAN_STATUS_LABEL[p.status]}</td><td className="mono">{fmt(p.units_added)}</td><td className="mono">{fmt(population(toInput(p)).values.population as number)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </Page>
  );
}
