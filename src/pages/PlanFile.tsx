// Plan file (תיק תכנית): documents, automatic extraction, approval screen, boundary, and the plan's bill of quantities vs targets.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { SUPABASE_KEY, SUPABASE_URL, supabase } from '../lib/supabase';
import { fmt, PLAN_STATUS_LABEL, type Plan } from '../lib/data';
import { BUCKET_LABEL, planBoq, planBucket, splitByArea, type Quantity } from '../lib/ledger';
import { insideAshdod, planFromFile } from '../lib/gis';
import { docBlob, docUrl } from '../lib/docfile';
import { isAreasTable, isRightsTable, parseAreasTable, parseRightsTable, quantitiesFromAreas, quantitiesFromRights, lotsCollection, yeudColor, type Lot } from '../lib/mavat';
import BoundaryMap from '../components/BoundaryMap';
import { pctText } from '../components/ledger';
import { Loading, Page } from '../components/ui';
import type { Doc } from './Documents';

const BUCKET = 'mt-documents';
const today = () => new Date().toISOString().slice(0, 10);
const ext = (f: string) => (f.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase();
const isGis = (d: Doc) => /\.(geojson|json|kml|zip)$/i.test(d.file_name ?? '');
const isReadable = (d: Doc) => /\.(pdf|xlsx|xls|ods|csv|txt|png|jpe?g|webp)$/i.test(d.file_name ?? '') || (d.mime ?? '').includes('pdf');
interface Extraction { id: string; doc_id: string; status: 'queued' | 'running' | 'done' | 'error'; error: string | null; result: { missing?: string[]; plan?: { number: string | null; name: string | null; approval_date: string | null; area_dunam: number | null } } | null; created_at: string; finished_at: string | null }
interface AreaPart { district_id: number; area_m2: number }

type Head = Pick<Plan, 'plan_number' | 'name' | 'status' | 'approval_date' | 'district_id' | 'note'>;

export default function PlanFilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { plans, districts, quantities, loading, error, refresh } = useStore();
  const { isMember, canWrite, session } = useAuth();
  const plan = plans.find((p) => p.id === id) ?? null;
  const isNew = id === 'new';
  const [head, setHead] = useState<Head>({ plan_number: '', name: '', status: 'approved', approval_date: null, district_id: null, note: null });
  const [msg, setMsg] = useState<string | null>(null);
  // reset the form only when the stored values change, so a background refresh never wipes what is being typed
  const headKey = plan ? JSON.stringify([plan.id, plan.plan_number, plan.name, plan.status, plan.approval_date, plan.district_id, plan.note]) : '';
  useEffect(() => { if (plan) setHead({ plan_number: plan.plan_number, name: plan.name, status: plan.status, approval_date: plan.approval_date, district_id: plan.district_id, note: plan.note }); }, [headKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveHead = async () => {
    if (!head.name?.trim()) { setMsg('חסר שם תכנית'); return; }
    setMsg('שומר');
    const row = { ...head, plan_number: head.plan_number || null, updated_at: new Date().toISOString() };
    const res = isNew
      ? await supabase.from('mt_plans').insert({ ...row, created_by: session?.user.email ?? null, source: 'תיק תכנית' }).select('id').single()
      : await supabase.from('mt_plans').update(row).eq('id', id!).select('id').single();
    if (res.error) { setMsg(`שגיאה: ${res.error.message}`); return; }
    setMsg('נשמר'); await refresh();
    if (isNew) nav(`/plans/${res.data.id}`, { replace: true });
  };

  if (loading) return <main className="page"><Loading error={error} /></main>;
  if (!isMember) return <Page title="תיק תכנית"><div className="notice">תיקי התכניות פתוחים לחברי הצוות אחרי כניסה, מכפתור "מערכת".</div></Page>;
  if (!isNew && !plan) return <Page title="תכנית לא נמצאה"><Link to="/plans" className="btn">לרשימת התכניות</Link></Page>;

  return (
    <Page kicker={isNew ? 'תכנית חדשה' : `תיק תכנית ${plan?.plan_number ?? ''}`} title={isNew ? 'פתיחת תיק תכנית' : plan!.name}
      actions={!isNew && <><Link className="btn primary" to={`/plan/${encodeURIComponent(plan!.mavat_number || plan!.plan_number || plan!.id)}`}>דף התכנית</Link><Link className="btn" to={`/tools/check/${plan!.id}`}>בדיקת כללי מדיניות</Link><Link className="btn" to="/ledger">מאזן מימוש</Link></>}>
      <section className="card" data-testid="plan-head">
        <div className="card-head"><h2>1. פרטי התכנית</h2>{plan && <span className="chip st-info">{BUCKET_LABEL[planBucket(plan, null)]}</span>}</div>
        <div className="form-grid">
          <label>מספר תכנית<input className="input" dir="ltr" value={head.plan_number ?? ''} disabled={!canWrite} onChange={(e) => setHead({ ...head, plan_number: e.target.value })} placeholder="603-0000000" /></label>
          <label>שם<input className="input" value={head.name} disabled={!canWrite} onChange={(e) => setHead({ ...head, name: e.target.value })} /></label>
          <label>סטטוס<select className="input" value={head.status} disabled={!canWrite} onChange={(e) => setHead({ ...head, status: e.target.value as Plan['status'] })}>
            {(['approved', 'deposited', 'pipeline', 'idea', 'rejected'] as const).map((s) => <option key={s} value={s}>{PLAN_STATUS_LABEL[s]}</option>)}</select></label>
          <label>תאריך אישור (מתן תוקף)<input className="input" type="date" value={head.approval_date ?? ''} disabled={!canWrite} onChange={(e) => setHead({ ...head, approval_date: e.target.value || null })} /></label>
          <label>מתחם עיקרי<select className="input" value={head.district_id ?? ''} disabled={!canWrite} onChange={(e) => setHead({ ...head, district_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">לפי הגבול</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.id}. {d.name}</option>)}</select></label>
          <label>הערה<input className="input" value={head.note ?? ''} disabled={!canWrite} onChange={(e) => setHead({ ...head, note: e.target.value || null })} /></label>
        </div>
        <div className="ls">מאושרת: נכנסת לסה"כ. בצנרת או בהפקדה: נכנסת לתרחיש בלבד. רעיון ונדחתה: לא נספרות.</div>
        {canWrite && <div className="row-actions"><button type="button" className="btn primary" onClick={saveHead}>{isNew ? 'פתיחת התיק' : 'שמירת הפרטים'}</button></div>}
        {msg && <div className="notice" role="status">{msg}</div>}
      </section>
      {plan && <PlanBody plan={plan} />}
      {plan && (
        <section className="card">
          <div className="card-head"><h2>6. כתב הכמויות מול יעד המתחם</h2></div>
          <PlanBoqTable plan={plan} quantities={quantities} />
        </section>
      )}
      {!plan && <div className="notice">אחרי פתיחת התיק אפשר להעלות מסמכים, לחלץ נתונים ולטעון גבול.</div>}
    </Page>
  );
}

function PlanBody({ plan }: { plan: Plan }) {
  const { districts, quantities, refresh } = useStore();
  const { canWrite, session } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [ex, setEx] = useState<Extraction[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ name: '', doc_date: today() });
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<{ doc: Doc; url: string; page: number | null } | null>(null);
  const [parts, setParts] = useState<AreaPart[] | null>(null);
  const gisInput = useRef<HTMLInputElement>(null);
  const qs = quantities.filter((q) => q.plan_id === plan.id);

  const load = useCallback(async () => {
    const [d, e] = await Promise.all([
      supabase.from('mt_documents').select('*').eq('plan_id', plan.id).order('created_at'),
      supabase.from('mt_extractions').select('*').eq('plan_id', plan.id).order('created_at', { ascending: false }),
    ]);
    if (!d.error) setDocs(d.data as Doc[]);
    if (!e.error) setEx(e.data as Extraction[]);
  }, [plan.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch(`${SUPABASE_URL}/functions/v1/mt-extract`, { headers: { apikey: SUPABASE_KEY } }).then((r) => r.json()).then((j) => setReady(!!j.ready)).catch(() => setReady(false));
  }, []);
  // poll while an extraction runs; refresh the quantities when it finishes
  const running = ex.some((x) => x.status === 'running' || x.status === 'queued');
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(async () => {
      const { data } = await supabase.from('mt_extractions').select('*').eq('plan_id', plan.id).order('created_at', { ascending: false });
      if (data) { setEx(data as Extraction[]); if (!(data as Extraction[]).some((x) => x.status === 'running' || x.status === 'queued')) refresh(); }
    }, 4000);
    return () => window.clearInterval(t);
  }, [running, plan.id, refresh]);

  const area = useCallback(async (b: Plan['boundary']) => {
    if (!b) { setParts(null); return null; }
    const { data, error } = await supabase.rpc('mt_area_split', { boundary: b });
    if (error) { setMsg(`חישוב השטח נכשל: ${error.message}`); return null; }
    const r = data as { area_m2: number; parts: AreaPart[] };
    setParts(r.parts); return r;
  }, []);
  useEffect(() => { if (plan.boundary) area(plan.boundary); }, [plan.boundary, area]);

  const upload = async (f: File, name: string, date: string | null) => {
    const path = `plans/${plan.id}/${crypto.randomUUID()}.${ext(f.name)}`;
    const up = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
    if (up.error) throw new Error(up.error.message);
    const ins = await supabase.from('mt_documents').insert({ name, doc_date: date, file_path: path, file_name: f.name, mime: f.type || null, size_bytes: f.size, plan_id: plan.id, district_id: plan.district_id, uploaded_by: session?.user.email ?? null }).select('*').single();
    if (ins.error) throw new Error(ins.error.message);
    return ins.data as Doc;
  };
  const onUpload = async () => {
    if (!file) { setMsg('לא נבחר קובץ'); return; }
    setBusy(true); setMsg('מעלה');
    try { await upload(file, form.name.trim() || file.name, form.doc_date || null); setMsg('המסמך נשמר'); setFile(null); setForm({ name: '', doc_date: today() }); await load(); }
    catch (e) { setMsg(`שגיאה בהעלאה: ${(e as Error).message}`); }
    setBusy(false);
  };

  const open = async (d: Doc, page: number | null = null) => {
    try { setViewer({ doc: d, url: await docUrl(d.file_path), page }); } catch (e) { setMsg(`לא ניתן לפתוח: ${(e as Error).message}`); }
  };

  const extract = async (d: Doc) => {
    setMsg('שולח לחילוץ');
    const { error } = await supabase.functions.invoke('mt-extract', { body: { plan_id: plan.id, doc_id: d.id } });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      setMsg(status === 503 ? 'החילוץ האוטומטי ממתין למפתח Claude API בפרויקט. בינתיים אפשר להזין נתונים ידנית.' : `החילוץ נכשל: ${error.message}`);
      return;
    }
    setMsg('החילוץ רץ. מסמך ארוך לוקח כמה דקות. הנתונים יופיעו כטיוטה לאישור.'); await load();
  };

  const setBoundary = async (b: NonNullable<Plan['boundary']>, source: 'gis' | 'drawn', lots?: GeoJSON.FeatureCollection | null) => {
    if (!insideAshdod(b)) setMsg('הגבול נטען, אבל אינו נמצא באזור אשדוד. לבדוק את מערכת הקואורדינטות של הקובץ.');
    const r = await area(b);
    const { error } = await supabase.from('mt_plans').update({ boundary: b, boundary_source: source, area_m2: r?.area_m2 ?? null, ...(lots ? { lots } : {}) }).eq('id', plan.id);
    if (error) { setMsg(`שגיאה בשמירת הגבול: ${error.message}`); return; }
    if (insideAshdod(b)) setMsg(source === 'drawn' ? 'הגבול שורטט ונשמר' : 'הגבול נטען מהקובץ ונשמר');
    refresh();
  };
  const onGisFile = async (f: File | undefined) => {
    if (!f) return;
    try { const p = await planFromFile(f); await setBoundary(p.boundary, 'gis', p.lots && lotsCollection(p.lots, [])); await upload(f, `גבול: ${f.name}`, today()); await load(); }
    catch (e) { setMsg(`קובץ הגבול לא נקרא: ${(e as Error).message}`); }
  };
  const gisFromDoc = async (d: Doc) => {
    try {
      const p = await planFromFile(new File([await docBlob(d.file_path)], d.file_name ?? 'boundary.geojson'));
      await setBoundary(p.boundary, 'gis', p.lots && lotsCollection(p.lots, (plan.lots?.features ?? []).flatMap((f) => ((f.properties as unknown as Lot | null)?.rights ?? []).map((r) => ({ ...r, lot: String(f.properties?.lot), yeud: String(f.properties?.yeud) })))));
    } catch (e) { setMsg(`קובץ הגבול לא נקרא: ${(e as Error).message}`); }
  };
  // מבא"ת tables (.xls exported as HTML) are read here, without AI; rows become drafts with their source
  const readMavat = async (d: Doc) => {
    try {
      const html = (await (await docBlob(d.file_path)).text()).replace(/^\uFEFF/, '');
      const rights = isRightsTable(html) ? parseRightsTable(html) : [];
      const drafts = rights.length ? quantitiesFromRights(rights) : isAreasTable(html) ? quantitiesFromAreas(parseAreasTable(html)) : [];
      if (!drafts.length) { setMsg('הקובץ אינו טבלת זכויות או טבלת שטחים של מבא"ת'); return; }
      const district = plan.district_id ?? (parts?.length === 1 ? parts[0].district_id : null);
      const { error } = await supabase.from('mt_plan_quantities').insert(drafts.map((x) => ({ plan_id: plan.id, district_id: district, domain_key: x.domain_key, value: x.value, doc_id: d.id, quote: x.quote, note: x.note, split: 'single', status: 'draft', origin: 'mavat', created_by: session?.user.email ?? null })));
      if (error) { setMsg(`שגיאה: ${error.message}`); return; }
      // the rights of each lot also go to the lots shown on the map
      if (rights.length && plan.lots?.features?.length) {
        const fc = { type: 'FeatureCollection' as const, features: plan.lots.features.map((f) => ({ ...f, properties: { NUM: f.properties?.lot, MAVAT_NAME: f.properties?.yeud, SHAPE_AREA: f.properties?.areaM2 } })) };
        await supabase.from('mt_plans').update({ lots: lotsCollection(fc, rights) }).eq('id', plan.id);
      }
      setMsg(`נקראו ${drafts.length} שורות מהטבלה. הן ממתינות לאישור`); refresh();
    } catch (e) { setMsg(`הקובץ לא נקרא: ${(e as Error).message}`); }
  };

  const clearBoundary = async () => {
    await supabase.from('mt_plans').update({ boundary: null, boundary_source: null, area_m2: null }).eq('id', plan.id);
    setParts(null); refresh();
  };

  // ---- quantities ----
  const addRow = async (row: Partial<Quantity>) => {
    const { error } = await supabase.from('mt_plan_quantities').insert({ plan_id: plan.id, domain_key: 'housing', district_id: plan.district_id ?? (parts?.length === 1 ? parts[0].district_id : null), status: 'draft', origin: 'manual', created_by: session?.user.email ?? null, ...row });
    if (error) setMsg(`שגיאה: ${error.message}`); else refresh();
  };
  const copyFromCheck = async () => {
    const g = plan.program ?? {};
    const pairs: [string, number | null | undefined][] = [['housing', plan.units_added], ['education', g.classrooms], ['kinder', g.kindergartens], ['openspace', g.open_space_m2], ['public', plan.public_built_m2], ['commerce', g.commerce_m2], ['employment', g.office_m2], ['roads', g.roads_m]];
    const rows = pairs.filter(([, v]) => v != null && v !== 0).map(([k, v]) => ({ plan_id: plan.id, domain_key: k, value: v, district_id: plan.district_id, status: 'draft', origin: 'manual', note: 'הועתק מטופס בדיקת התכנית', created_by: session?.user.email ?? null }));
    if (!rows.length) { setMsg('אין נתונים בטופס הבדיקה'); return; }
    const { error } = await supabase.from('mt_plan_quantities').insert(rows);
    setMsg(error ? `שגיאה: ${error.message}` : `נוספו ${rows.length} שורות טיוטה`); refresh();
  };
  const approveAll = async () => {
    const ok = qs.filter((q) => q.status === 'draft' && q.value != null && q.district_id != null).map((q) => q.id);
    if (!ok.length) { setMsg('אין טיוטות שלמות לאישור (חסרים כמות או מתחם)'); return; }
    const { error } = await supabase.from('mt_plan_quantities').update({ status: 'approved', approved_by: session?.user.email ?? null, approved_at: new Date().toISOString() }).in('id', ok);
    setMsg(error ? `שגיאה: ${error.message}` : `אושרו ${ok.length} נתונים`); refresh();
  };
  const splitRow = async (q: Quantity) => {
    if (!parts?.length || q.value == null) { setMsg('לחלוקה לפי שטח צריך גבול תכנית וכמות'); return; }
    const rows = splitByArea(q.value, parts);
    const [first, ...rest] = rows;
    const u = await supabase.from('mt_plan_quantities').update({ district_id: first.district_id, value: first.value, share: first.share, split: 'area', status: 'draft', approved_by: null, approved_at: null, updated_at: new Date().toISOString() }).eq('id', q.id);
    if (u.error) { setMsg(`שגיאה: ${u.error.message}`); return; }
    if (rest.length) {
      const i = await supabase.from('mt_plan_quantities').insert(rest.map((r) => ({ plan_id: plan.id, domain_key: q.domain_key, district_id: r.district_id, value: r.value, share: r.share, split: 'area', doc_id: q.doc_id, page: q.page, quote: q.quote, origin: q.origin, status: 'draft', note: 'חלוקה לפי שטח (הערכה)', created_by: session?.user.email ?? null })));
      if (i.error) { setMsg(`שגיאה: ${i.error.message}`); return; }
    }
    setMsg(`חולק ל-${rows.length} מתחמים לפי שטח, מסומן "הערכה"`); refresh();
  };

  const docName = (docId: string | null) => docs.find((d) => d.id === docId)?.name ?? null;
  const lastEx = (docId: string) => ex.find((x) => x.doc_id === docId);

  return (
    <>
      <section className="card" data-testid="plan-docs">
        <div className="card-head"><h2>2. מסמכי התכנית</h2>
          <span className={`chip ${ready ? 'st-pass' : 'st-missing'}`} data-testid="extract-ready">{ready == null ? 'בודק חילוץ אוטומטי' : ready ? 'חילוץ אוטומטי זמין' : 'חילוץ אוטומטי ממתין למפתח'}</span></div>
        <div className="ls">הוראות התכנית (PDF), טבלת זכויות (PDF או Excel) וקובץ GIS. החילוץ קורא את המסמך בעזרת Claude ומחזיר כמויות עם עמוד המקור. שום נתון לא נספר לפני אישור.</div>
        {docs.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>מסמך</th><th>תאריך</th><th>חילוץ</th><th /></tr></thead>
              <tbody>{docs.map((d) => {
                const x = lastEx(d.id);
                return (
                  <tr key={d.id}>
                    <td><b>{d.name}</b><div className="ls" dir="ltr">{d.file_name}</div></td>
                    <td className="mono">{d.doc_date ? d.doc_date.split('-').reverse().join('.') : 'חסר'}</td>
                    <td>{x ? <span className={`chip ${x.status === 'done' ? 'st-pass' : x.status === 'error' ? 'st-fail' : 'st-warn'}`}>{x.status === 'done' ? 'הושלם' : x.status === 'error' ? 'נכשל' : 'רץ'}</span> : <span className="ls">לא הורץ</span>}
                      {x?.error && <div className="ls">{x.error}</div>}
                      {x?.result?.missing?.length ? <div className="ls">לא נמצא במסמך: {x.result.missing.join('; ')}</div> : null}</td>
                    <td><div className="row-actions">
                      <button type="button" className="btn small" onClick={() => open(d)}>פתיחה</button>
                      {canWrite && /\.(xls|html?)$/i.test(d.file_name ?? '') && <button type="button" className="btn small primary" onClick={() => readMavat(d)}>קריאת טבלת מבא"ת</button>}
                      {canWrite && isReadable(d) && <button type="button" className="btn small primary" disabled={!ready || running} title={ready ? '' : 'ממתין למפתח Claude API'} onClick={() => extract(d)}>חילוץ נתונים</button>}
                      {canWrite && isGis(d) && <button type="button" className="btn small" onClick={() => gisFromDoc(d)}>טעינת גבול מהקובץ</button>}
                    </div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <div className="notice">עדיין לא הועלו מסמכים לתכנית.</div>}
        {canWrite && (
          <div className="form-grid">
            <label>קובץ<input className="input" type="file" aria-label="קובץ מסמך" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setForm((x) => ({ ...x, name: x.name || f.name.replace(/\.[^.]+$/, '') })); }} /></label>
            <label>שם המסמך<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="למשל: הוראות התכנית" /></label>
            <label>תאריך המסמך<input className="input" type="date" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></label>
            <div className="row-actions"><button type="button" className="btn primary" disabled={busy || !file} onClick={onUpload}>העלאת מסמך</button></div>
          </div>
        )}
        {msg && <div className="notice" role="status" data-testid="plan-msg">{msg}</div>}
      </section>

      <section className="card" data-testid="plan-approve">
        <div className="card-head"><h2>3. אישור הנתונים</h2>
          {canWrite && <div className="row-actions">
            <button type="button" className="btn small" onClick={() => addRow({})}>הוספת שורה ידנית</button>
            <button type="button" className="btn small" onClick={copyFromCheck}>העתקה מטופס הבדיקה</button>
            <button type="button" className="btn small primary" onClick={approveAll}>אישור כל הטיוטות השלמות</button>
          </div>}</div>
        <div className="ls">כל שורה עם מקור: מסמך ועמוד. לחיצה על "מקור" פותחת את המסמך בעמוד. שינוי בשורה מאושרת מחזיר אותה לטיוטה.</div>
        <div className={`approve-grid ${viewer ? 'with-viewer' : ''}`}>
          <div className="table-wrap">
            <table className="table qty">
              <thead><tr><th>תחום</th><th>מתחם</th><th>כמות</th><th>מקור</th><th>סטטוס</th><th /></tr></thead>
              <tbody>{qs.map((q) => <QtyRow key={q.id} q={q} docName={docName(q.doc_id)} canSplit={!!parts?.length && parts.length > 1} onSource={() => { const d = docs.find((x) => x.id === q.doc_id); if (d) open(d, q.page); }} onSplit={() => splitRow(q)} />)}</tbody>
            </table>
            {!qs.length && <div className="notice">אין עדיין נתונים. חילוץ ממסמך, הזנה ידנית או העתקה מטופס הבדיקה.</div>}
          </div>
          {viewer && (
            <div className="viewer card" data-testid="doc-viewer">
              <div className="card-head"><h3>{viewer.doc.name}{viewer.page ? <span className="mono">, עמ' {viewer.page}</span> : null}</h3><button type="button" className="btn small ghost" onClick={() => setViewer(null)}>סגירה</button></div>
              {(viewer.doc.mime ?? '').includes('pdf') || /\.pdf$/i.test(viewer.doc.file_name ?? '')
                ? <iframe title="מסמך המקור" src={`${viewer.url}${viewer.page ? `#page=${viewer.page}` : ''}`} key={`${viewer.url}${viewer.page}`} />
                : <a className="btn" href={viewer.url} target="_blank" rel="noreferrer">פתיחת הקובץ</a>}
            </div>
          )}
        </div>
      </section>

      <section className="card" data-testid="plan-boundary">
        <div className="card-head"><h2>4. גבול התכנית</h2>
          {canWrite && <div className="row-actions">
            <button type="button" className="btn small" onClick={() => gisInput.current?.click()}>טעינת קובץ GIS</button>
            <input ref={gisInput} type="file" hidden accept=".geojson,.json,.kml,.zip" aria-label="קובץ GIS" onChange={(e) => onGisFile(e.target.files?.[0])} />
            {plan.boundary && <button type="button" className="btn small ghost" onClick={clearBoundary}>מחיקת הגבול</button>}
          </div>}</div>
        <div className="ls">GeoJSON, KML או Shapefile בתוך ZIP. קואורדינטות ברשת ישראל החדשה (ITM) מומרות אוטומטית. בלי קובץ: שרטוט ידני על המפה.</div>
        <BoundaryMap boundary={plan.boundary} lots={plan.lots ?? null} districts={districts} canDraw={canWrite} onDrawn={(b) => setBoundary(b, 'drawn')} />
        {plan.lots?.features?.length ? <LotsTable lots={plan.lots} /> : null}
        {parts && (
          <div className="table-wrap">
            <table className="table" data-testid="area-split">
              <thead><tr><th>מתחם</th><th>שטח בתוך המתחם, דונם</th><th>חלק מהתכנית</th></tr></thead>
              <tbody>{parts.map((p) => { const tot = parts.reduce((a, x) => a + x.area_m2, 0); return <tr key={p.district_id}><td>{p.district_id}. {districts.find((d) => d.id === p.district_id)?.name}</td><td className="mono">{fmt(p.area_m2 / 1000, 1)}</td><td className="mono">{pctText(p.area_m2 / tot)}</td></tr>; })}</tbody>
            </table>
            <div className="ls">שטח התכנית {fmt((plan.area_m2 ?? 0) / 1000, 1)} דונם. כשהתכנית חוצה מתחמים ואין טבלת זכויות לפי מתחם, "חלוקה לפי שטח" בשורת הנתון מחלקת אותו לפי הטבלה הזו ומסמנת "הערכה".</div>
          </div>
        )}
      </section>
    </>
  );
}

function QtyRow({ q, docName, canSplit, onSource, onSplit }: { q: Quantity; docName: string | null; canSplit: boolean; onSource: () => void; onSplit: () => void }) {
  const { districts, domains, refresh } = useStore();
  const { canWrite, session } = useAuth();
  const [e, setE] = useState({ domain_key: q.domain_key, district_id: q.district_id, value: q.value, page: q.page, quote: q.quote ?? '' });
  const [err, setErr] = useState<string | null>(null);
  // reset only when the stored row really changed, so a background refresh never wipes what is being typed
  useEffect(() => setE({ domain_key: q.domain_key, district_id: q.district_id, value: q.value, page: q.page, quote: q.quote ?? '' }), [q.id, q.domain_key, q.district_id, q.value, q.page, q.quote]);
  const dirty = e.domain_key !== q.domain_key || e.district_id !== q.district_id || e.value !== q.value || e.page !== q.page || e.quote !== (q.quote ?? '');
  const dm = domains.find((d) => d.key === e.domain_key);
  const save = async () => {
    const { error } = await supabase.from('mt_plan_quantities').update({ ...e, quote: e.quote || null, status: 'draft', approved_by: null, approved_at: null, updated_at: new Date().toISOString() }).eq('id', q.id);
    setErr(error?.message ?? null); if (!error) refresh();
  };
  const approve = async () => {
    if (e.value == null || e.district_id == null) { setErr('לאישור צריך כמות ומתחם'); return; }
    const { error } = await supabase.from('mt_plan_quantities').update({ ...e, quote: e.quote || null, status: 'approved', approved_by: session?.user.email ?? null, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', q.id);
    setErr(error?.message ?? null); if (!error) refresh();
  };
  const remove = async () => { const { error } = await supabase.from('mt_plan_quantities').delete().eq('id', q.id); setErr(error?.message ?? null); if (!error) refresh(); };
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
  return (
    <tr className={q.status === 'draft' ? 'draft' : ''} data-qty={q.id}>
      <td><select className="input" aria-label="תחום" disabled={!canWrite} value={e.domain_key} onChange={(x) => setE({ ...e, domain_key: x.target.value })}>{domains.map((d) => <option key={d.key} value={d.key}>{d.title}</option>)}</select></td>
      <td><select className="input" aria-label="מתחם" disabled={!canWrite} value={e.district_id ?? ''} onChange={(x) => setE({ ...e, district_id: x.target.value ? Number(x.target.value) : null })}>
        <option value="">חסר שיוך</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.id}. {d.name}</option>)}</select>
        {q.split === 'area' && <span className="chip st-warn">הערכה {q.share != null ? pctText(q.share) : ''}</span>}{q.split === 'table' && <span className="ls">לפי טבלת זכויות</span>}</td>
      <td><input className="input mono" inputMode="decimal" aria-label="כמות" disabled={!canWrite} value={e.value ?? ''} onChange={(x) => setE({ ...e, value: num(x.target.value) })} /> <span className="ls">{dm?.unit}</span></td>
      <td>
        <div className="row-actions">{docName ? <button type="button" className="btn small ghost" onClick={onSource}>מקור</button> : <span className="ls">{q.origin === 'manual' ? 'הזנה ידנית' : 'חסר מסמך'}</span>}
          <input className="input mono small-input" inputMode="numeric" aria-label="עמוד" placeholder="עמ'" disabled={!canWrite} value={e.page ?? ''} onChange={(x) => setE({ ...e, page: num(x.target.value) })} /></div>
        {docName && <div className="ls">{docName}</div>}
        <input className="input" aria-label="ציטוט מהמקור" placeholder="ציטוט מהמקור" disabled={!canWrite} value={e.quote} onChange={(x) => setE({ ...e, quote: x.target.value })} />
        {q.note && <div className="ls">{q.note}</div>}
      </td>
      <td>{q.status === 'approved' ? <><span className="chip st-pass">מאושר</span><div className="ls" dir="ltr">{q.approved_by}</div></> : <span className="chip st-warn">טיוטה</span>}
        {q.origin === 'ai' && <div className="ls">חילוץ אוטומטי</div>}</td>
      <td>{canWrite && <div className="row-actions">
        {dirty && <button type="button" className="btn small" onClick={save}>שמירה</button>}
        {(q.status === 'draft' || dirty) && <button type="button" className="btn small primary" onClick={approve}>אישור</button>}
        {canSplit && q.district_id == null && <button type="button" className="btn small" onClick={onSplit}>חלוקה לפי שטח</button>}
        <button type="button" className="btn small ghost" onClick={remove}>מחיקה</button>
      </div>}{err && <div className="notice">{err}</div>}</td>
    </tr>
  );
}

function PlanBoqTable({ plan, quantities }: { plan: Plan; quantities: Quantity[] }) {
  const { districts, domains, ledger } = useStore();
  const rows = useMemo(() => planBoq(plan.id, quantities, ledger), [plan.id, quantities, ledger]);
  const bucket = planBucket(plan, null);
  if (!rows.length) return <div className="notice">אין עדיין כמויות לתכנית.</div>;
  return (
    <>
      <div className="table-wrap">
        <table className="table" data-testid="plan-boq">
          <thead><tr><th>תחום</th><th>מתחם</th><th>התכנית מוסיפה</th><th>יעד המתחם</th><th>חלק מהיעד</th><th>יתרה במתחם לפני התכנית</th><th>נתון</th></tr></thead>
          <tbody>{rows.map((r) => {
            const dm = domains.find((d) => d.key === r.domain_key);
            return (
              <tr key={r.q.id} className={r.status === 'draft' ? 'draft' : ''}>
                <td><b>{dm?.title ?? r.domain_key}</b> <span className="ls">{dm?.unit}</span></td>
                <td>{r.district_id ? `${r.district_id}. ${districts.find((d) => d.id === r.district_id)?.name ?? ''}` : <span className="chip st-missing">חסר שיוך</span>}</td>
                <td className="mono">{fmt(r.value)}{r.split === 'area' && <span className="ls"> הערכה</span>}</td>
                <td className="mono">{fmt(r.target)}</td>
                <td className="mono">{pctText(r.shareOfTarget)}</td>
                <td className="mono">{fmt(r.remainingBefore)}</td>
                <td>{r.status === 'approved' ? <span className="chip st-pass">מאושר</span> : <span className="chip st-warn">טיוטה, לא נספר</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <div className="ls">{bucket === 'approved' ? 'התכנית מאושרת: הנתונים המאושרים נכנסים לסה"כ המתחם.' : bucket === 'scenario' ? 'התכנית בהליך: הנתונים נכנסים לתרחיש בלבד, לא לסה"כ.' : 'התכנית אינה נספרת במאזן (רעיון או נדחתה).'} "יתרה לפני התכנית": מה היה חסר במתחם בלי התכנית הזו.</div>
    </>
  );
}

function LotsTable({ lots }: { lots: GeoJSON.FeatureCollection }) {
  const rows = lots.features.map((f) => f.properties as unknown as Lot).filter(Boolean).sort((a, b) => a.lot.localeCompare(b.lot, 'he', { numeric: true }));
  return (
    <details className="lots">
      <summary>תאי שטח: {rows.length}. ייעוד, שטח וזכויות לפי טבלה 5</summary>
      <div className="table-wrap">
        <table className="table mini" data-testid="lots-table">
          <thead><tr><th>תא שטח</th><th>ייעוד</th><th>שטח, מ"ר</th><th>שימושים וזכויות</th></tr></thead>
          <tbody>{rows.map((l) => (
            <tr key={l.lot}>
              <td className="mono">{l.lot}</td>
              <td><span className="sw" style={{ background: yeudColor(l.yeud), display: 'inline-block', marginInlineEnd: 6 }} />{l.yeud}</td>
              <td className="mono">{fmt(l.areaM2)}</td>
              <td className="ls">{(l.rights ?? []).map((r) => `${r.use || 'כללי'} ${fmt(r.builtM2)} מ"ר${r.units ? `, ${r.units} יח"ד` : ''}`).join('; ') || 'ללא זכויות בנייה'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}
