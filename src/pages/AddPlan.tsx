// Add a plan (simple flow, page 4): number, blue line from Xplan, files dropped in, then the approval screen.
import { useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fetchXplan, statusFromText, xplanFacts, type XplanResult } from '../lib/xplan';
import { findPlan, planKey } from '../lib/plansapi';
import { planFromFile, pickLayers } from '../lib/gis';
import { planLayersFromShp } from '../lib/planlayers';
import { isAreasTable, isRightsTable, parseAreasTable, parseRightsTable, quantitiesFromAreas, quantitiesFromRights } from '../lib/mavat';
import { pdfFirstPageToPng } from '../lib/pdfimage';
import { NextStep, Page } from '../components/ui';
import type { Plan } from '../lib/data';

type Kind = 'gis' | 'instructions' | 'building' | 'tashrit' | 'table' | 'other';
const KIND_LABEL: Record<Kind, string> = { gis: 'ממ"ג (SHP, KML, GeoJSON)', instructions: 'הוראות התכנית (PDF)', building: 'נספח בינוי', tashrit: 'תשריט מצב מוצע', table: 'טבלת מבא"ת (xls)', other: 'אחר (DWG ועוד)' };
export function guessKind(name: string): Kind {
  const n = name.toLowerCase();
  if (/\.(zip|kml|geojson|json)$/.test(n)) return 'gis';
  if (/\.(xls|html?)$/.test(n)) return 'table';
  if (/תשריט|tashrit|tasrit/.test(n) && /\.(pdf|png|jpe?g)$/.test(n)) return 'tashrit';
  if (/בינוי|binui/.test(n)) return 'building';
  if (/\.pdf$/.test(n)) return 'instructions';
  return 'other';
}
interface Item { file: File; kind: Kind; state: 'waiting' | 'done' | 'error'; msg: string | null }

export default function AddPlanPage() {
  const { plans, refresh } = useStore();
  const { canWrite, session } = useAuth();
  const nav = useNavigate();
  const [num, setNum] = useState('');
  const [name, setName] = useState('');
  const [x, setX] = useState<XplanResult | null>(null);
  const [xMsg, setXMsg] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const existing = num.trim() ? findPlan(plans, num.trim()) : null;

  const pull = async () => {
    setXMsg('פונה לשירות Xplan של מינהל התכנון'); setX(null);
    try {
      const r = await fetchXplan(num.trim());
      setX(r); const f = xplanFacts(r.props); if (f.name && !name) setName(f.name);
      setXMsg(`נמצא: ${f.name ?? 'ללא שם'}${f.status ? `, ${f.status}` : ''}. הקו הכחול יישמר כ"מקור מדויק".`);
    } catch (e) {
      setXMsg(`שירות Xplan לא החזיר תשובה (${(e as Error).message}). השירות זמין רק מכתובות בישראל. אפשר להמשיך ולהעלות קובץ ממ"ג או KML.`);
    }
  };

  const create = async () => {
    if (!num.trim() || !name.trim()) { setXMsg('חסר מספר או שם'); return; }
    setBusy(true);
    const f = x ? xplanFacts(x.props) : null;
    const row = {
      plan_number: num.trim(), mavat_number: /^\d{3}-\d{7}$/.test(num.trim()) ? num.trim() : null, name: name.trim(), status: statusFromText(f?.status ?? null),
      sector: 'general', fabric: 'existing', is_renewal: true, units_added: 0, boundary: x?.boundary ?? null, boundary_source: x ? 'xplan' : null,
      mavat_url: f?.url ?? null, source: x ? 'Xplan, מינהל התכנון' : 'הוזן ידנית', created_by: session?.user.email ?? null, is_example: false,
    };
    const ins = await supabase.from('mt_plans').insert(row).select('*').single();
    if (ins.error) { setBusy(false); setXMsg(`שגיאה: ${ins.error.message}`); return; }
    const p = ins.data as Plan;
    if (x) await supabase.from('mt_plan_layers').insert({ plan_id: p.id, kind: 'blue_line', geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: x.boundary, properties: {} }] }, accuracy: 'exact', source: 'Xplan, מינהל התכנון', created_by: session?.user.email ?? null });
    setPlan(p); setBusy(false); refresh();
  };

  const add = (files: FileList | File[] | null) => { if (files) setItems((xs) => [...xs, ...Array.from(files).map((file) => ({ file, kind: guessKind(file.name), state: 'waiting' as const, msg: null }))]); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); };

  const processOne = async (p: Plan, it: Item): Promise<string> => {
    const email = session?.user.email ?? null;
    const path = `plans/${p.id}/${crypto.randomUUID()}.${(it.file.name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase()}`;
    const up = await supabase.storage.from('mt-documents').upload(path, it.file, { contentType: it.file.type || 'application/octet-stream' });
    if (up.error) throw new Error(up.error.message);
    const doc = await supabase.from('mt_documents').insert({ name: `${KIND_LABEL[it.kind]}: ${it.file.name}`, doc_date: new Date().toISOString().slice(0, 10), file_path: path, file_name: it.file.name, mime: it.file.type || null, size_bytes: it.file.size, plan_id: p.id, district_id: p.district_id, uploaded_by: email }).select('id').single();
    if (doc.error) throw new Error(doc.error.message);
    const docId = doc.data.id as string;
    if (it.kind === 'gis') {
      const n = it.file.name.toLowerCase();
      if (n.endsWith('.zip')) {
        const shp = (await import('shpjs')).default as unknown as (b: ArrayBuffer) => Promise<never>;
        const all = await shp(await it.file.arrayBuffer());
        const layers = planLayersFromShp(all, []);
        for (const l of layers) await supabase.from('mt_plan_layers').upsert({ plan_id: p.id, kind: l.kind, geojson: l.geojson, accuracy: l.accuracy, source: l.source, note: l.note ?? null, created_by: email }, { onConflict: 'plan_id,kind' });
        const b = pickLayers(all).boundaryLayer;
        if (b) { const pf = await planFromFile(it.file); await supabase.from('mt_plans').update({ boundary: pf.boundary, boundary_source: 'gis' }).eq('id', p.id); }
        return `נטענו ${layers.length} שכבות: ${layers.map((l) => l.kind).join(', ')}`;
      }
      const pf = await planFromFile(it.file);
      await supabase.from('mt_plans').update({ boundary: pf.boundary, boundary_source: 'gis' }).eq('id', p.id);
      await supabase.from('mt_plan_layers').upsert({ plan_id: p.id, kind: 'blue_line', geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: pf.boundary, properties: {} }] }, accuracy: 'exact', source: `קובץ ${it.file.name}`, created_by: email }, { onConflict: 'plan_id,kind' });
      return 'הקו הכחול נטען מהקובץ';
    }
    if (it.kind === 'table') {
      const html = (await it.file.text()).replace(/^﻿/, '');
      const drafts = isRightsTable(html) ? quantitiesFromRights(parseRightsTable(html)) : isAreasTable(html) ? quantitiesFromAreas(parseAreasTable(html)) : [];
      if (!drafts.length) return 'נשמר, אבל אינו טבלת זכויות או שטחים של מבא"ת';
      await supabase.from('mt_plan_quantities').insert(drafts.map((d) => ({ plan_id: p.id, district_id: p.district_id, domain_key: d.domain_key, value: d.value, doc_id: docId, quote: d.quote, note: d.note, status: 'draft', origin: 'mavat', created_by: email })));
      return `נקראו ${drafts.length} נתונים לטיוטה`;
    }
    if (it.kind === 'tashrit') {
      const { data: blue } = await supabase.from('mt_plan_layers').select('geojson').eq('plan_id', p.id).eq('kind', 'blue_line').maybeSingle();
      const { bboxOfFC } = await import('../lib/plansapi');
      const bb = bboxOfFC((blue?.geojson as GeoJSON.FeatureCollection) ?? p.boundary);
      if (!bb) return 'נשמר. כדי ליישר את התשריט צריך קו כחול';
      const img = /\.pdf$/i.test(it.file.name) ? await pdfFirstPageToPng(it.file) : it.file;
      const ip = `plans/${p.id}/tashrit-${Date.now()}.png`;
      const iu = await supabase.storage.from('mt-documents').upload(ip, img, { contentType: 'image/png', upsert: true });
      if (iu.error) throw new Error(iu.error.message);
      await supabase.from('mt_plan_layers').upsert({ plan_id: p.id, kind: 'tashrit', image_url: ip, image_bounds: bb, accuracy: 'approx', source: `תשריט: ${it.file.name}`, note: 'מיושר לגבולות הקו הכחול', created_by: email }, { onConflict: 'plan_id,kind' });
      return 'התשריט נשמר כשכבת תמונה';
    }
    if (it.kind === 'instructions') {
      const { error } = await supabase.functions.invoke('mt-extract', { body: { plan_id: p.id, doc_id: docId } });
      if (error) return (error as { context?: { status?: number } }).context?.status === 503 ? 'נשמר. החילוץ האוטומטי ממתין למפתח Claude API' : `נשמר. החילוץ נכשל: ${error.message}`;
      return 'נשמר. חילוץ טבלת הזכויות רץ ברקע';
    }
    return 'נשמר';
  };

  const processAll = async () => {
    if (!plan) return;
    setBusy(true);
    for (let i = 0; i < items.length; i++) {
      if (items[i].state === 'done') continue;
      try { const m = await processOne(plan, items[i]); setItems((xs) => xs.map((y, j) => (j === i ? { ...y, state: 'done', msg: m } : y))); }
      catch (e) { setItems((xs) => xs.map((y, j) => (j === i ? { ...y, state: 'error', msg: (e as Error).message } : y))); }
    }
    setBusy(false); refresh();
  };

  if (!canWrite) return <Page kicker="הוספת תכנית" title="הוספת תכנית"><div className="notice">הוספת תכנית פתוחה לעורכים אחרי כניסה, מכפתור "מערכת".</div><NextStep to="/map" label="למפה" /></Page>;

  return (
    <Page kicker="הוספת תכנית" title="תכנית חדשה: מספר, קו כחול, קבצים">
      <section className="card" data-testid="add-step1">
        <div className="card-head"><h2>1. מספר התכנית</h2></div>
        <div className="form-grid">
          <label>מספר תכנית<input className="input" dir="ltr" value={num} onChange={(e) => setNum(e.target.value)} placeholder="603-0000000" aria-label="מספר תכנית" disabled={!!plan} /></label>
          <label>שם<input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="שם התכנית" disabled={!!plan} /></label>
        </div>
        {existing && !plan && <div className="notice">התכנית כבר במערכת. <Link to={`/plan/${planKey(existing)}`}>לדף התכנית</Link></div>}
        {!plan && <div className="row-actions">
          <button type="button" className="btn" disabled={!num.trim() || busy} onClick={pull}>משיכת קו כחול מ-Xplan</button>
          <button type="button" className="btn primary" disabled={!num.trim() || !name.trim() || busy || !!existing} onClick={create}>יצירת התכנית</button>
        </div>}
        {xMsg && <div className="notice" role="status" data-testid="xplan-msg">{xMsg}</div>}
        {plan && <div className="notice" data-testid="created">התכנית נוצרה. עכשיו הקבצים.</div>}
      </section>

      <section className={`card ${plan ? '' : 'disabled'}`} data-testid="add-step2">
        <div className="card-head"><h2>2. קבצים</h2></div>
        <div className={`dropzone2 ${drag ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
          <p>גרירת קבצים לכאן: ממ"ג (ZIP של SHP, DWG), הוראות PDF, נספח בינוי, תשריט PDF, טבלאות מבא"ת.</p>
          <label className="btn">בחירת קבצים<input type="file" multiple hidden aria-label="בחירת קבצים" onChange={(e) => add(e.target.files)} /></label>
        </div>
        {items.length > 0 && (
          <table className="table mini" data-testid="add-files">
            <thead><tr><th>קובץ</th><th>סוג</th><th>מצב</th></tr></thead>
            <tbody>{items.map((it, i) => (
              <tr key={i}>
                <td dir="ltr">{it.file.name}</td>
                <td><select className="input" value={it.kind} aria-label={`סוג ${it.file.name}`} disabled={it.state === 'done'} onChange={(e) => setItems((xs) => xs.map((y, j) => (j === i ? { ...y, kind: e.target.value as Kind } : y)))}>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                <td>{it.state === 'waiting' ? 'ממתין' : it.state === 'done' ? <span className="chip st-pass">נקלט</span> : <span className="chip st-fail">שגיאה</span>} {it.msg && <span className="ls">{it.msg}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div className="row-actions"><button type="button" className="btn primary" disabled={!plan || !items.some((i) => i.state !== 'done') || busy} onClick={processAll}>קליטת הקבצים</button></div>
        <div className="ls">ממ"ג נותן גאומטריה מדויקת. בלי ממ"ג: קו כחול מ-Xplan ותשריט כתמונה. בלי נספח בינוי וקטורי: שרטוט טביעות רגל בדף התכנית. DWG נשמר להורדה ואינו נקרא.</div>
      </section>

      <section className={`card ${plan ? '' : 'disabled'}`}>
        <div className="card-head"><h2>3. אישור הנתונים</h2></div>
        <p>המספרים שחולצו מוצגים לצד המסמך, כל מספר עם העמוד שלו. שום נתון לא נספר לפני אישור.</p>
        <div className="row-actions">
          <button type="button" className="btn primary" disabled={!plan} onClick={() => plan && nav(`/plans/${plan.id}`)}>למסך האישור</button>
          <button type="button" className="btn" disabled={!plan} onClick={() => plan && nav(`/plan/${planKey(plan)}`)}>לדף התכנית</button>
        </div>
      </section>
      <NextStep to="/compare" label="השוואה ליעד" why="אחרי האישור: מה התכנית תורמת ליעד" />
    </Page>
  );
}
