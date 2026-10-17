import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fmt, PLAN_STATUS_LABEL, toInput } from '../lib/data';
import { renewalBalance } from '../lib/rules';
import MapView from '../components/MapView';
import { CertaintyChip, Gauge, Loading, Page, RuleCard } from '../components/ui';
import { DistrictLedger } from '../components/ledger';
import { downloadXlsx, ledgerRows, quantityRows } from '../lib/export';

export default function DistrictPage() {
  const { id } = useParams();
  const { districts, plans, gates, loading, error, refresh, ledger, domains, quantities } = useStore();
  const { isMember, canWrite } = useAuth();
  const [edit, setEdit] = useState(false);
  const [pop, setPop] = useState('');
  const [src, setSrc] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const d = districts.find((x) => x.id === Number(id));
  if (loading) return <main className="page"><Loading error={error} /></main>;
  if (!d) return <Page title="מתחם לא נמצא"><Link to="/" className="btn">לדף הבית</Link></Page>;

  const dPlans = plans.filter((p) => p.district_id === d.id);
  const gate = gates[d.id];
  const bal = renewalBalance(dPlans.map(toInput));
  const groups = (['approved', 'deposited', 'pipeline', 'idea', 'rejected'] as const).map((s) => ({ s, items: dPlans.filter((p) => p.status === s) }));

  const savePop = async () => {
    setSaving('שומר');
    const { error: e } = await supabase.from('mt_districts').update({ existing_pop: pop === '' ? null : Number(pop), existing_pop_source: src || null, existing_pop_date: new Date().toISOString().slice(0, 10) }).eq('id', d.id);
    setSaving(e ? `שגיאה: ${e.message}` : 'נשמר'); if (!e) { setEdit(false); refresh(); }
  };

  return (
    <Page kicker={`מתחם ${d.id}`} title={d.name} actions={canWrite && <><Link className="btn primary" to="/plans/new">תיק תכנית חדש</Link><Link className="btn" to={`/tools/check/new?district=${d.id}`}>הוספת תכנית</Link></>}>
      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>סף אוכלוסייה, סעיף 6.3</h2><CertaintyChip certainty="plan-draft" /></div>
          <Gauge label="צפי: קיים, מאושר וצנרת" value={d.existing_pop == null ? null : (gate.values.projected as number)} target={d.target_pop ?? 0} />
          <RuleCard r={gate} />
          <dl className="kv">
            <dt>אוכלוסייה קיימת</dt><dd className="mono">{fmt(d.existing_pop)}</dd>
            <dt>מקור</dt><dd>{d.existing_pop_source ?? 'חסר'}</dd>
          </dl>
          {canWrite && !edit && <button type="button" className="btn" onClick={() => { setEdit(true); setPop(d.existing_pop?.toString() ?? ''); setSrc(''); }}>עדכון אוכלוסייה קיימת</button>}
          {edit && (
            <div className="form-grid">
              <label>אוכלוסייה קיימת<input className="input" inputMode="numeric" value={pop} onChange={(e) => setPop(e.target.value.replace(/[^\d]/g, ''))} /></label>
              <label>מקור הנתון<input className="input" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="למשל: מחלקת מחקר, 12/2025" /></label>
              <div className="row-actions"><button type="button" className="btn primary" onClick={savePop}>שמירה</button><button type="button" className="btn ghost" onClick={() => setEdit(false)}>ביטול</button></div>
              {saving && <div className="notice">{saving}</div>}
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>מיקום</h2><CertaintyChip certainty="assumption" /></div>
          <MapView focus={d.id} />
          <div className="ls">{d.geom ? `איחוד ${d.quarters.length} רובעים רשמיים (GIS עירוני) לפי שיוך משוער. שטח ממופה ${fmt((d.mapped_area_m2 ?? 0) / 1000)} דונם מול ${fmt((d.total_area_m2 ?? 0) / 1000)} דונם בתכנית (${d.total_area_m2 ? Math.round(100 * (d.mapped_area_m2 ?? 0) / d.total_area_m2) : 0}%).` : 'גבול המתחם חסר.'}</div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>מאזן המימוש של המתחם</h2>
          <div className="row-actions">
            <button type="button" className="btn small" onClick={() => downloadXlsx(`ashdod-ledger-district-${d.id}.xlsx`, [{ name: 'מאזן', rows: ledgerRows(ledger, domains, districts, d.id) }, { name: 'כמויות', rows: quantityRows(quantities, plans, domains, d.id) }])}>ייצוא לאקסל</button>
            <button type="button" className="btn small" onClick={() => window.print()}>ייצוא ל-PDF</button>
            <Link className="btn small" to={`/tools/layers?d=${d.id}&theme=progress`}>במפה</Link>
          </div></div>
        <DistrictLedger districtId={d.id} ledger={ledger} domains={domains} plans={plans} isMember={isMember} />
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>איזון התחדשות במתחם, סעיף 6.1</h2></div>
          {isMember ? <RuleCard r={bal} /> : <div className="notice">פתוח לחברי הצוות אחרי כניסה.</div>}
          <h3 className="sub">נתוני התכנית</h3>
          <dl className="kv">
            <dt>יעד אוכלוסייה</dt><dd className="mono">{fmt(d.target_pop)}</dd>
            <dt>תוספת יח"ד</dt><dd className="mono">{fmt(d.units_added)}</dd>
            <dt>סה"כ יח"ד</dt><dd className="mono">{fmt(d.units_total)}</dd>
            <dt>שטח כולל, מ"ר</dt><dd className="mono">{fmt(d.total_area_m2)}</dd>
            <dt>שטח למגורים, מ"ר</dt><dd className="mono">{fmt(d.res_area_m2)}</dd>
            <dt>תעסוקה, מ"ר</dt><dd className="mono">{fmt(d.employment_m2)}</dd>
            <dt>תיירות, מ"ר</dt><dd className="mono">{fmt(d.tourism_m2)}</dd>
          </dl>
          <div className="ls">{d.source}</div>
        </section>
        <section className="card">
          <div className="card-head"><h2>תכניות במתחם</h2></div>
          {!isMember ? <div className="notice">רשימת התכניות פתוחה לחברי הצוות בלבד.</div> : dPlans.length === 0 ? <div className="notice">אין תכניות רשומות במתחם.</div> : (
            groups.filter((g) => g.items.length).map((g) => (
              <div key={g.s} className="plan-group">
                <h3 className="sub">{PLAN_STATUS_LABEL[g.s]} <span className="mono">{g.items.length}</span></h3>
                {g.items.map((p) => (
                  <Link key={p.id} to={`/plans/${p.id}`} className="plan-row">
                    <span className="mono">{p.plan_number ?? 'ללא מספר'}</span><span>{p.name}</span><span className="mono">{fmt(p.units_added)} יח"ד</span>
                    {p.is_example && <span className="chip st-info">דוגמה</span>}
                  </Link>
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>הערות המתחם</h2><CertaintyChip certainty="plan-draft" /></div>
        <p>{d.notes}</p>
        <h3 className="sub">טבלת רח"ק, פרק 4.3</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>שורה</th><th>ייעוד</th><th>קומות</th><th>רח"ק בסיס</th><th>רח"ק מרבי</th></tr></thead>
            <tbody>{d.rahak.map((r, i) => <tr key={i}><td className="mono">{i}</td><td>{r[0]}</td><td>{r[1]}</td><td className="mono">{r[2]}</td><td className="mono">{r[3]}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </Page>
  );
}
