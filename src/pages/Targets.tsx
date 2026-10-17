import { useState } from 'react';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fmt } from '../lib/data';
import type { Target } from '../lib/ledger';
import { CertaintyChip, Loading, Page } from '../components/ui';

const CERTS = ['plan-draft', 'policy-draft', 'municipal', 'assumption', 'statutory', 'missing'];
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));

export default function TargetsPage() {
  const { districts, domains, targets, loading, error, refresh } = useStore();
  const { canWrite, session } = useAuth();
  const [domain, setDomain] = useState('housing');
  const [edit, setEdit] = useState<Target | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nd, setNd] = useState({ title: '', unit: '' });
  if (loading) return <main className="page"><Loading error={error} /></main>;
  const dm = domains.find((d) => d.key === domain) ?? domains[0];

  const save = async () => {
    if (!edit) return;
    setMsg('שומר');
    const { error: e } = await supabase.from('mt_targets').upsert({ ...edit, updated_by: session?.user.email ?? null, updated_at: new Date().toISOString() });
    setMsg(e ? `שגיאה: ${e.message}` : 'נשמר'); if (!e) { setEdit(null); refresh(); }
  };
  const addDomain = async () => {
    if (!nd.title.trim() || !nd.unit.trim()) { setMsg('חסר שם תחום או יחידה'); return; }
    const key = `d${Date.now().toString(36)}`;
    const a = await supabase.from('mt_domains').insert({ key, title: nd.title.trim(), unit: nd.unit.trim(), sort: 100 + domains.length, target_rule: 'הוזן ידנית', target_certainty: 'missing' });
    if (a.error) { setMsg(`שגיאה: ${a.error.message}`); return; }
    const b = await supabase.from('mt_targets').insert(districts.map((d) => ({ district_id: d.id, domain_key: key, updated_by: session?.user.email ?? null })));
    setMsg(b.error ? `שגיאה: ${b.error.message}` : 'התחום נוסף'); setNd({ title: '', unit: '' }); setDomain(key); refresh();
  };

  const row = (d: { id: number }) => targets.find((t) => t.district_id === d.id && t.domain_key === dm?.key) ?? { district_id: d.id, domain_key: dm.key, target: null, target_source: null, target_page: null, target_certainty: 'missing', existing: null, existing_date: null, existing_source: null, existing_certainty: 'missing', note: null };

  return (
    <Page kicker="יעדים ומצב קיים" title="היעד של תכנית המתאר והמצב הקיים, לכל מתחם ותחום">
      <p className="lead">נקודת המוצא של המאזן. היעדים נטענו מטבלאות פרק 4.3 של תכנית 603-0528026 (נוסח 2019, לא בתוקף), והקיים ממקורות עירוניים. כל ערך עם מקור וודאות. תאריך הקיים קובע אילו תכניות כבר כלולות בו.</p>
      <div className="row-actions tabs" role="tablist" aria-label="תחום">
        {domains.map((d) => <button key={d.key} type="button" role="tab" aria-selected={d.key === dm?.key} className={`btn small ${d.key === dm?.key ? 'on' : ''}`} onClick={() => { setDomain(d.key); setEdit(null); }}>{d.title}</button>)}
      </div>
      {dm && (
        <section className="card">
          <div className="card-head"><h2>{dm.title} <span className="ls">{dm.unit}</span></h2><CertaintyChip certainty={dm.target_certainty} /></div>
          <div className="ls">{dm.target_rule}</div>
          <div className="table-wrap">
            <table className="table" data-testid="targets-table">
              <thead><tr><th>מתחם</th><th>יעד</th><th>מקור היעד</th><th>קיים</th><th>תאריך הקיים</th><th>מקור הקיים</th><th>הערה</th>{canWrite && <th />}</tr></thead>
              <tbody>{districts.map((d) => {
                const t = row(d);
                if (edit && edit.district_id === d.id) return (
                  <tr key={d.id} className="editing">
                    <td><span className="mono">{d.id}</span> {d.name}</td>
                    <td><input className="input" inputMode="decimal" aria-label="יעד" value={edit.target ?? ''} onChange={(e) => setEdit({ ...edit, target: num(e.target.value) })} />
                      <select className="input" aria-label="ודאות היעד" value={edit.target_certainty} onChange={(e) => setEdit({ ...edit, target_certainty: e.target.value })}>{CERTS.map((c) => <option key={c} value={c}>{c}</option>)}</select></td>
                    <td><input className="input" aria-label="מקור היעד" value={edit.target_source ?? ''} onChange={(e) => setEdit({ ...edit, target_source: e.target.value || null })} />
                      <input className="input" inputMode="numeric" aria-label="עמוד" placeholder="עמוד" value={edit.target_page ?? ''} onChange={(e) => setEdit({ ...edit, target_page: num(e.target.value) })} /></td>
                    <td><input className="input" inputMode="decimal" aria-label="קיים" value={edit.existing ?? ''} onChange={(e) => setEdit({ ...edit, existing: num(e.target.value) })} /></td>
                    <td><input className="input" type="date" aria-label="תאריך הקיים" value={edit.existing_date ?? ''} onChange={(e) => setEdit({ ...edit, existing_date: e.target.value || null })} /></td>
                    <td><input className="input" aria-label="מקור הקיים" value={edit.existing_source ?? ''} onChange={(e) => setEdit({ ...edit, existing_source: e.target.value || null, existing_certainty: e.target.value ? (edit.existing_certainty === 'missing' ? 'municipal' : edit.existing_certainty) : 'missing' })} /></td>
                    <td><input className="input" aria-label="הערה" value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value || null })} /></td>
                    <td><div className="row-actions"><button type="button" className="btn primary small" onClick={save}>שמירה</button><button type="button" className="btn ghost small" onClick={() => setEdit(null)}>ביטול</button></div></td>
                  </tr>
                );
                return (
                  <tr key={d.id}>
                    <td><span className="mono">{d.id}</span> {d.name}</td>
                    <td><span className="mono">{fmt(t.target)}</span> <CertaintyChip certainty={t.target_certainty} /></td>
                    <td className="ls">{t.target_source ?? 'חסר'}{t.target_page ? `, עמ' ${t.target_page}` : ''}</td>
                    <td className="mono">{fmt(t.existing)}</td>
                    <td className="mono">{t.existing_date ? t.existing_date.split('-').reverse().join('.') : 'חסר'}</td>
                    <td className="ls">{t.existing_source ?? 'חסר'}</td>
                    <td className="ls">{t.note ?? ''}</td>
                    {canWrite && <td><button type="button" className="btn small" onClick={() => setEdit({ ...t })}>עריכה</button></td>}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {msg && <div className="notice" role="status">{msg}</div>}
        </section>
      )}
      {canWrite && (
        <section className="card">
          <div className="card-head"><h2>הוספת תחום</h2></div>
          <div className="form-grid">
            <label>שם התחום<input className="input" value={nd.title} onChange={(e) => setNd({ ...nd, title: e.target.value })} placeholder="למשל: מלונאות" /></label>
            <label>יחידה<input className="input" value={nd.unit} onChange={(e) => setNd({ ...nd, unit: e.target.value })} placeholder='למשל: חדרים' /></label>
            <div className="row-actions"><button type="button" className="btn primary" onClick={addDomain}>הוספה</button></div>
          </div>
        </section>
      )}
    </Page>
  );
}
