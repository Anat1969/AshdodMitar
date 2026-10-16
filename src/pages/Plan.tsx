import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fmt, PLAN_STATUS_LABEL, toInput, type Plan } from '../lib/data';
import { checkPlan, districtGate } from '../lib/rules';
import { CertaintyChip, Loading, Page, RuleCard, StatusChip } from '../components/ui';
import { billOfQuantities, BOQ_LABEL, type Program } from '../lib/topics';

type Form = Omit<Plan, 'id' | 'location' | 'is_example' | 'data_certainty'> & { id?: string };
const blank = (district: number | null): Form => ({
  plan_number: '', name: '', district_id: district, status: 'pipeline', sector: 'general', fabric: 'existing', is_renewal: false,
  units_added: 0, mix: { small: 0, medium: 0, rest: 0, restAvgArea: 0 }, added_above_ground_m2: null, public_built_m2: null,
  intensive: false, yard: { green: 0, hard: 0, roofs: 0, schoolyards: 0 }, distance_mass_transit_m: null, lot_area_m2: null,
  percolation_m2: null, effective_green_m2: null, green_roof_m2: null, far: null, rahak_row: null, note: null,
  program: {},
});

const STEPS = ['זיהוי', 'יח"ד ותמהיל', 'שטחים וסף-בית', 'מיקום ורח"ק', 'פרוגרמה'] as const;

export default function PlanPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { districts, plans, decisions, loading, error, refresh } = useStore();
  const { canWrite, isMember, session } = useAuth();
  const existing = plans.find((p) => p.id === id);
  const [f, setF] = useState<Form>(() => blank(sp.get('district') ? Number(sp.get('district')) : 2));
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [dec, setDec] = useState({ forum: 'ועדה מקומית', decision: '', rationale: '', deviations: '', decided_at: new Date().toISOString().slice(0, 10) });

  useEffect(() => { if (existing) setF({ ...existing }); }, [existing]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === '' ? null : Number(v));
  const district = districts.find((d) => d.id === f.district_id) ?? null;
  const input = useMemo(() => toInput({ ...(f as Plan), id: f.id ?? 'draft', location: null, is_example: false, data_certainty: 'reported' }), [f]);
  const mixFilled = f.mix && f.mix.small + f.mix.medium + f.mix.rest > 0;
  const results = useMemo(() => checkPlan({ ...input, mix: mixFilled ? input.mix : null }, district), [input, district, mixFilled]);
  const boq = useMemo(() => billOfQuantities({ ...input, mix: mixFilled ? input.mix : null }), [input, mixFilled]);

  const impact = useMemo(() => {
    if (!district) return null;
    const others = plans.filter((p) => p.district_id === district.id && p.id !== f.id).map(toInput);
    return { before: districtGate(district, others), after: districtGate(district, [...others, input]) };
  }, [district, plans, f.id, input]);

  if (loading) return <main className="page"><Loading error={error} /></main>;
  if (id !== 'new' && !existing && isMember) return <Page title="תכנית לא נמצאה"><Link to="/" className="btn">לדף הבית</Link></Page>;

  const save = async () => {
    if (!f.name.trim()) { setMsg('חסר שם תכנית'); setStep(0); return; }
    setMsg('שומר');
    const { id: pid, ...row } = f;
    const payload = { ...row, mix: mixFilled ? f.mix : null, created_by: session?.user.email ?? null, updated_at: new Date().toISOString() };
    const res = pid ? await supabase.from('mt_plans').update(payload).eq('id', pid).select('id').single() : await supabase.from('mt_plans').insert(payload).select('id').single();
    if (res.error) { setMsg(`שגיאה: ${res.error.message}`); return; }
    const planId = res.data.id as string;
    const chk = await supabase.from('mt_checks').insert(results.map((r) => ({ plan_id: planId, rule_id: r.id, rule_version: 1, status: r.status, values: r.values, message: r.message })));
    setMsg(chk.error ? `התכנית נשמרה, הבדיקה לא: ${chk.error.message}` : 'נשמר, והבדיקה נרשמה');
    await refresh();
    if (!pid) nav(`/plan/${planId}`, { replace: true });
  };

  const saveDecision = async () => {
    if (!f.id || !dec.decision.trim()) { setMsg('חסר נוסח החלטה'); return; }
    const { error: e } = await supabase.from('mt_decisions').insert({
      plan_id: f.id, forum: dec.forum, decision: dec.decision, rationale: dec.rationale || null,
      deviations: dec.deviations ? dec.deviations.split('\n').filter(Boolean) : null, decided_at: dec.decided_at, created_by: session?.user.email ?? null,
    });
    setMsg(e ? `שגיאה: ${e.message}` : 'ההחלטה נרשמה');
    if (!e) { setDec({ ...dec, decision: '', rationale: '', deviations: '' }); refresh(); }
  };

  const planDecisions = decisions.filter((d) => d.plan_id === f.id);
  const numField = (label: string, k: keyof Form, st?: string) => (
    <label key={k}>
{label}<input className="input mono" type="number" step={st ?? '1'} value={(f[k] as number | null) ?? ''} onChange={(e) => set(k, num(e.target.value) as never)} /></label>
  );

  return (
    <Page kicker={existing ? existing.plan_number ?? 'תכנית' : 'תכנית חדשה'} title={f.name || 'בדיקת תכנית'}
      actions={<>
        {canWrite && <button type="button" className="btn primary" onClick={save}>{f.id ? 'שמירה והרצת בדיקה' : 'שמירת תכנית'}</button>}
        {!canWrite && <span className="ls">בדיקה בלבד, בלי שמירה. שמירה לעורכים אחרי כניסה.</span>}
      </>}>
      <div className="io-note"><b>קלט:</b> נתוני התכנית בחמישה שלבים. <b>פלט:</b> כתב כמויות, כרטיס לכל כלל עם מקור וודאות, והשפעה על המתחם. <Link to="/about">איך זה עובד</Link></div>
      {existing?.is_example && <div className="notice">תכנית דוגמה בדויה לבדיקת המנוע. לא תכנית אמיתית.</div>}
      {msg && <div className="notice" role="status">{msg}</div>}
      <div className="plan-layout">
        <section className="card">
          <div className="steps" role="tablist">
            {STEPS.map((s, i) => <button key={s} type="button" role="tab" aria-selected={step === i} className={step === i ? 'on' : ''} onClick={() => setStep(i)}><span className="mono">{i + 1}</span>{s}</button>)}
          </div>
          {step === 0 && (
            <div className="form-grid">
              <label>שם התכנית<input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
              <label>מספר תכנית<input className="input mono" dir="ltr" value={f.plan_number ?? ''} onChange={(e) => set('plan_number', e.target.value)} /></label>
              <label>מתחם<select className="input" value={f.district_id ?? ''} onChange={(e) => set('district_id', num(e.target.value))}>{districts.map((d) => <option key={d.id} value={d.id}>{d.id}. {d.name}</option>)}</select></label>
              <label>סטטוס<select className="input" value={f.status} onChange={(e) => set('status', e.target.value as Form['status'])}>{Object.entries(PLAN_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label>אוכלוסייה<select className="input" value={f.sector} onChange={(e) => set('sector', e.target.value as Form['sector'])}><option value="general">כללית</option><option value="haredi">חרדית</option></select></label>
              <label>מרקם<select className="input" value={f.fabric} onChange={(e) => set('fabric', e.target.value as Form['fabric'])}><option value="existing">קיים</option><option value="new">חדש</option></select></label>
              <label className="check"><input type="checkbox" checked={f.is_renewal} onChange={(e) => set('is_renewal', e.target.checked)} />התחדשות עירונית</label>
              <label className="check"><input type="checkbox" checked={f.intensive} onChange={(e) => set('intensive', e.target.checked)} />מרקם אינטנסיבי</label>
            </div>
          )}
          {step === 1 && (
            <div className="form-grid">
              {numField('תוספת יח"ד', 'units_added')}
              {(['small', 'medium', 'rest'] as const).map((k) => (
                <label key={k}>{k === 'small' ? 'דירות עד 55 מ"ר' : k === 'medium' ? 'דירות 55 עד 80 מ"ר' : 'יתר הדירות'}
                  <input className="input mono" type="number" value={f.mix?.[k] ?? ''} onChange={(e) => set('mix', { ...f.mix!, [k]: Number(e.target.value || 0) })} /></label>
              ))}
              <label>ממוצע שטח היתרה, מ"ר<input className="input mono" type="number" value={f.mix?.restAvgArea ?? ''} onChange={(e) => set('mix', { ...f.mix!, restAvgArea: Number(e.target.value || 0) })} /></label>
            </div>
          )}
          {step === 2 && (
            <div className="form-grid">
              {numField("תוספת שטח מעל הקרקע, מ״ר", 'added_above_ground_m2')}
              {numField("שטח ציבורי בנוי, מ״ר", 'public_built_m2')}
              {(['green', 'hard', 'roofs', 'schoolyards'] as const).map((k) => (
                <label key={k}>{k === 'green' ? 'סף-בית: תשתית ירוקה, מ"ר' : k === 'hard' ? 'סף-בית: תשתית קשיחה, מ"ר' : k === 'roofs' ? 'סף-בית: גגות, מ"ר' : 'סף-בית: חצרות מוסדות, מ"ר'}
                  <input className="input mono" type="number" value={f.yard?.[k] ?? ''} onChange={(e) => set('yard', { ...f.yard!, [k]: Number(e.target.value || 0) })} /></label>
              ))}
              {numField("שטח מגרש, מ״ר", 'lot_area_m2')}
              {numField("שטח חלחול, מ״ר", 'percolation_m2')}
              {numField("שטח מגונן אפקטיבי, מ״ר", 'effective_green_m2')}
              {numField("גג ירוק, מ״ר", 'green_roof_m2')}
            </div>
          )}
          {step === 3 && (
            <div className="form-grid">
              {numField('מרחק מציר מתע"ן, מ׳', 'distance_mass_transit_m')}
              {numField('רח"ק מוצע', 'far', '0.1')}
              <label>שורת ייעוד בטבלת הרח"ק<select className="input" value={f.rahak_row ?? ''} onChange={(e) => set('rahak_row', num(e.target.value))}>
                <option value="">חסר</option>
                {district?.rahak.map((r, i) => <option key={i} value={i}>{i}. {r[0]}, {r[1]} (בסיס {r[2]}, מרבי {r[3]})</option>)}
              </select></label>
            </div>
          )}
          {step === 4 && (
            <div className="form-grid">
              <div className="wide ls">מה התכנית מספקת. כל שורה נבדקת מול מה שהתכנית עצמה מייצרת, בכתב הכמויות שמימין.</div>
              {([['classrooms', 'כיתות יסודי'], ['kindergartens', 'כיתות גן'], ['education_dunam', 'קרקע לחינוך, דונם'], ['open_space_m2', 'שצ"פ, מ"ר'], ['commerce_m2', 'מסחר, מ"ר'], ['office_m2', 'משרדים ותעסוקה, מ"ר'], ['roads_m', 'כבישים, מטר אורך']] as [keyof Program, string][]).map(([k, label]) => (
                <label key={k}>{label}<input className="input mono" type="number" step="any" value={(f.program?.[k] as number | null | undefined) ?? ''} onChange={(e) => set('program', { ...(f.program ?? {}), [k]: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              ))}
              {numField('שטחי ציבור בנויים, מ״ר', 'public_built_m2')}
            </div>
          )}
          <div className="row-actions step-nav">
            <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>הקודם</button>
            <button type="button" className="btn" disabled={step === STEPS.length - 1} onClick={() => setStep(step + 1)}>הבא</button>
          </div>
        </section>

        <section className="results">
          <div className="card boq" data-testid="boq">
            <div className="card-head"><h2>כתב כמויות</h2><span className="ls">מה התכנית מספקת מול מה שהיא מייצרת</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>נושא</th><th>מוצע</th><th>נדרש</th><th>מאזן</th><th>מצב</th><th>בסיס</th></tr></thead>
                <tbody>{boq.map((r) => (
                  <tr key={r.key} data-boq={r.key}>
                    <td><b>{r.title}</b> <span className="ls">{r.unit}</span></td>
                    <td className="mono">{fmt(r.provided, 2)}</td>
                    <td className="mono">{r.required == null ? 'אין יעד' : fmt(r.required, 2)}</td>
                    <td className="mono">{r.balance == null ? '' : (r.balance > 0 ? '+' : '') + fmt(r.balance, 2)}</td>
                    <td><span className={`chip st-${r.status === 'pass' ? 'pass' : r.status === 'fail' ? 'fail' : r.status === 'missing' ? 'missing' : 'info'}`}>{BOQ_LABEL[r.status]}</span></td>
                    <td className="ls">{r.basis} <CertaintyChip certainty={r.certainty} /></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="section-head"><h2>תוצאות הבדיקה</h2><span className="ls">מתעדכן תוך כדי הקלדה</span></div>
          <div className="rule-grid">{results.map((r, i) => <RuleCard key={r.id} r={r} i={i} />)}</div>
          {impact && (
            <div className="card impact">
              <div className="card-head"><h2>השפעה על מתחם {district!.id}</h2><CertaintyChip certainty="plan-draft" /></div>
              <div className="impact-row">
                <div><div className="ls">לפני</div><StatusChip status={impact.before.status} gate /><div className="mono">{fmt(impact.before.values.projected as number)}</div></div>
                <div><div className="ls">אחרי</div><StatusChip status={impact.after.status} gate /><div className="mono">{fmt(impact.after.values.projected as number)}</div></div>
                <div><div className="ls">יעד</div><div className="mono big">{fmt(district!.target_pop)}</div></div>
              </div>
              <p className="msg">{impact.after.message}</p>
            </div>
          )}
        </section>
      </div>

      {f.id && isMember && (
        <section className="card">
          <div className="card-head"><h2>החלטות</h2></div>
          {planDecisions.length === 0 && <div className="notice">אין החלטות רשומות.</div>}
          {planDecisions.map((d) => (
            <div key={d.id} className="decision"><div className="mono">{d.decided_at} · {d.forum}</div><b>{d.decision}</b>{d.rationale && <p>{d.rationale}</p>}</div>
          ))}
          {canWrite && (
            <div className="form-grid">
              <label>פורום<select className="input" value={dec.forum} onChange={(e) => setDec({ ...dec, forum: e.target.value })}><option>ועדה מקומית</option><option>פורום מהנדס העיר</option><option>ועדה מחוזית</option></select></label>
              <label>תאריך<input className="input mono" type="date" value={dec.decided_at} onChange={(e) => setDec({ ...dec, decided_at: e.target.value })} /></label>
              <label className="wide">החלטה<textarea className="input" value={dec.decision} onChange={(e) => setDec({ ...dec, decision: e.target.value })} /></label>
              <label className="wide">נימוק<textarea className="input" value={dec.rationale} onChange={(e) => setDec({ ...dec, rationale: e.target.value })} /></label>
              <label className="wide">חריגות שאושרו, שורה לכל חריגה<textarea className="input" value={dec.deviations} onChange={(e) => setDec({ ...dec, deviations: e.target.value })} /></label>
              <div className="row-actions"><button type="button" className="btn primary" onClick={saveDecision}>רישום החלטה</button></div>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}
