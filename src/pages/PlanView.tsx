// Plan page (simple flow, page 3): /plan/<number>. Layers, proposed-state drawing, 2D / 3D, data card and source files.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fmt } from '../lib/data';
import { bboxOfFC, fact, findPlan, loadLayers, STATUS_GROUP_LABEL, statusGroup, type PlanLayerRow } from '../lib/plansapi';
import { LAYER_TITLE, type LayerKind } from '../lib/planlayers';
import { docUrl } from '../lib/docfile';
import { pdfFirstPageToPng } from '../lib/pdfimage';
import PlanMap3D, { type MapLayerData } from '../components/PlanMap3D';
import { demandFromUnits, GapLegend, GapRow, gapRows } from '../components/GapBars';
import { Loading, Page } from '../components/ui';
import type { Doc } from './Documents';

const ORDER: LayerKind[] = ['blue_line', 'land_use', 'building_lines', 'demolish', 'existing', 'proposed', 'tashrit'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;
const dmy = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : 'חסר');

export default function PlanViewPage() {
  const { num = '' } = useParams();
  const { plans, districts, quantities, ledger, domains, loading, error } = useStore();
  const { canWrite, isMember, session } = useAuth();
  const plan = findPlan(plans, num);
  const [layers, setLayers] = useState<PlanLayerRow[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sp, setSp] = useSearchParams();
  // ?view=3d opens in 3D, so a link (and "העתקת קישור") can share the 3D view
  const mode: '2d' | '3d' = sp.get('view') === '3d' ? '3d' : '2d';
  const setMode = (m: '2d' | '3d') => { const n = new URLSearchParams(sp); if (m === '3d') n.set('view', '3d'); else n.delete('view'); setSp(n, { replace: true }); };
  const [visible, setVisible] = useState<Set<LayerKind>>(new Set(ORDER));
  const [opacity, setOpacity] = useState(0.6);
  const [tUrl, setTUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [pts, setPts] = useState<number[][]>([]);
  const [floors, setFloors] = useState('8');
  const [show, setShow] = useState({ envelope: true, volume: true });
  const [orbit, setOrbit] = useState(false);

  const load = useCallback(async () => {
    if (!plan) return;
    try { setLayers(await loadLayers(plan.id)); } catch (e) { setMsg((e as Error).message); }
    const d = await supabase.from('mt_documents').select('*').eq('plan_id', plan.id).order('created_at');
    if (!d.error) setDocs(d.data as Doc[]);
  }, [plan]);
  useEffect(() => { load(); }, [load]);

  const tl = layers.find((l) => l.kind === 'tashrit');
  useEffect(() => { if (tl?.image_url) docUrl(tl.image_url).then(setTUrl).catch(() => setTUrl(null)); else setTUrl(null); }, [tl?.image_url]);

  // the blue line falls back to the plan's boundary when there is no layer row
  const mapLayers = useMemo<MapLayerData[]>(() => {
    const out: MapLayerData[] = layers.filter((l) => l.geojson?.features?.length).map((l) => ({ kind: l.kind, geojson: l.geojson }));
    if (!out.some((l) => l.kind === 'blue_line') && plan?.boundary) out.push({ kind: 'blue_line', geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: plan.boundary, properties: {} }] } });
    return out;
  }, [layers, plan]);
  const hasEnv = useMemo(() => !!layers.find((l) => l.kind === 'proposed')?.geojson?.features.some((f) => f.properties?.kind === 'envelope'), [layers]);
  const bbox = useMemo(() => bboxOfFC(mapLayers.find((l) => l.kind === 'blue_line')?.geojson ?? null), [mapLayers]);

  if (loading) return <main className="page"><Loading error={error} /></main>;
  if (num === 'new' || UUID.test(num)) return <Navigate to={`/tools/check/${num}`} replace />;
  if (!plan) return <Page title="תכנית לא נמצאה"><div className="notice">אין במערכת תכנית במספר {decodeURIComponent(num)}.</div></Page>;

  const g = statusGroup(plan.status);
  const district = districts.find((d) => d.id === plan.district_id);
  const f = (k: string, sum = false) => fact(quantities, plan.id, k, sum);
  const facts = [
    { label: 'יח"ד קיימות', f: f('units_existing') },
    { label: 'יח"ד מוצעות', f: f('units_proposed') },
    { label: 'תוספת נטו', f: f('housing', true) },
    { label: 'סה"כ שטחי בנייה, מ"ר', f: f('built_m2') },
    { label: 'שטח עיקרי, מ"ר', f: f('main_m2') },
    { label: 'שטח שירות, מ"ר', f: f('service_m2') },
    { label: 'קומות מרביות', f: f('floors_max') },
    { label: 'שטחי ציבור בנויים, מ"ר', f: f('public', true) },
  ];
  const kindsHere = ORDER.filter((k) => mapLayers.some((l) => l.kind === k) || (k === 'tashrit' && tl));
  const missingKinds = ORDER.filter((k) => !kindsHere.includes(k) && k !== 'existing');
  const toggle = (k: LayerKind) => { const s = new Set(visible); if (s.has(k)) s.delete(k); else s.add(k); setVisible(s); };
  const acc = (k: LayerKind) => (k === 'blue_line' && !layers.some((l) => l.kind === 'blue_line') ? 'exact' : layers.find((l) => l.kind === k)?.accuracy);

  const uploadTashrit = async (file: File | undefined) => {
    if (!file || !bbox) return;
    try {
      setMsg('מכין את התשריט');
      const img = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfFirstPageToPng(file) : file;
      const path = `plans/${plan.id}/tashrit-${Date.now()}.png`;
      const up = await supabase.storage.from('mt-documents').upload(path, img, { contentType: 'image/png', upsert: true });
      if (up.error) throw new Error(up.error.message);
      const { error: e } = await supabase.from('mt_plan_layers').upsert({ plan_id: plan.id, kind: 'tashrit', image_url: path, image_bounds: bbox, accuracy: 'approx', source: `תשריט: ${file.name}`, note: 'מיושר לגבולות הקו הכחול. קירוב: שולי הגיליון אינם נחתכים', created_by: session?.user.email ?? null }, { onConflict: 'plan_id,kind' });
      if (e) throw new Error(e.message);
      setMsg('התשריט נטען ומיושר לקו הכחול'); load();
    } catch (e) { setMsg(`התשריט לא נטען: ${(e as Error).message}`); }
  };
  const nudge = async (dx: number, dy: number, ds: number) => {
    if (!tl?.image_bounds) return;
    const [w, s, e, n] = tl.image_bounds; const cx = (w + e) / 2, cy = (s + n) / 2, hw = ((e - w) / 2) * (1 + ds), hh = ((n - s) / 2) * (1 + ds);
    const sx = (e - w) * dx, sy = (n - s) * dy;
    const b: [number, number, number, number] = [cx - hw + sx, cy - hh + sy, cx + hw + sx, cy + hh + sy];
    setLayers((ls) => ls.map((l) => (l.kind === 'tashrit' ? { ...l, image_bounds: b } : l)));
    await supabase.from('mt_plan_layers').update({ image_bounds: b }).eq('id', tl.id);
  };
  const saveFootprint = async () => {
    if (pts.length < 3) return;
    const h = Math.round(Number(floors || 0) * 3.3);
    const cur = layers.find((l) => l.kind === 'proposed');
    const feat: GeoJSON.Feature = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, properties: { floors: Number(floors), height: h, base: 0, drawn: 1 } };
    const geojson = { type: 'FeatureCollection', features: [...(cur?.geojson?.features ?? []), feat] };
    const { error: e } = await supabase.from('mt_plan_layers').upsert({ plan_id: plan.id, kind: 'proposed', geojson, accuracy: 'approx', source: cur?.source ?? 'שרטוט ידני על גבי התשריט', note: 'טביעות רגל משורטטות ידנית: קירוב', created_by: session?.user.email ?? null }, { onConflict: 'plan_id,kind' });
    setMsg(e ? `שגיאה: ${e.message}` : 'טביעת הרגל נשמרה'); setPts([]); setDrawing(false); load();
  };

  return (
    <Page kicker={`תכנית ${plan.plan_number ?? ''}${plan.mavat_number && plan.mavat_number !== plan.plan_number ? ` · ${plan.mavat_number}` : ''}`} title={plan.name}
      actions={<><span className={`chip status-${g}`} data-testid="plan-status">{STATUS_GROUP_LABEL[g]}</span></>}>
      {district && (
        <section className="card gap-card" data-testid="plan-gap">
          <div className="card-head"><h2>מה צריך במתחם {district.id}, מה התכנית עושה, ומה נשאר</h2><GapLegend /></div>
          <div className="ls">{district.name}. היעד לפי תכנית המתאר 603-0528026 (לא בתוקף). "צריך" = יעד פחות קיים. "נשאר" = מה שצריך אחרי כל התכניות.</div>
          {(() => {
            const net = f('housing', true).value ?? 0;
            const dmd = net > 0 ? demandFromUnits(net, plan.sector === 'haredi' ? 'haredi' : 'general') : null;
            // only the domains this plan touches (or creates demand in); the others are named in one line
            const rows = gapRows(ledger, domains, plans, [district.id], plan.id).map((r) => ({ ...r, demand: dmd && r.key === 'education' ? { value: dmd.classes, label: 'ביקוש חדש שהתוספת יוצרת, כיתות' } : dmd && r.key === 'kinder' ? { value: dmd.kinder, label: 'ביקוש חדש שהתוספת יוצרת, כיתות גן' } : null }));
            const mine = rows.filter((r) => r.parts.some((x) => x.highlight) || r.demand);
            const rest = rows.filter((r) => !mine.includes(r));
            return <>
              {mine.map((r) => <GapRow key={r.key} r={r} />)}
              {rest.length > 0 && <div className="ls" data-testid="gap-rest">התכנית אינה מוסיפה ל: {rest.map((r) => r.title).join(', ')}.</div>}
            </>;
          })()}
          <div className="ls">ביקוש חדש: תוספת הדירות כפול גודל משק בית ושיעור שנתון (מסמך המדיניות, טיוטה), 30 תלמידים בכיתה (הנחת עבודה).</div>
        </section>
      )}
      <div className="pv-grid">
        <section className="card pv-map">
          <div className="pv-tools">
            <div className="seg" role="tablist" aria-label="תצוגה">
              <button type="button" role="tab" aria-selected={mode === '2d'} className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>דו-ממד</button>
              <button type="button" role="tab" aria-selected={mode === '3d'} className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>תלת-ממד</button>
            </div>
            {mode === '3d' && hasEnv && <div className="seg" aria-label="מה מוצג בתלת-ממד">
              <button type="button" aria-pressed={show.envelope} className={show.envelope ? 'on' : ''} onClick={() => setShow((x) => ({ ...x, envelope: !x.envelope }))}>מעטפת מותרת</button>
              <button type="button" aria-pressed={show.volume} className={show.volume ? 'on' : ''} onClick={() => setShow((x) => ({ ...x, volume: !x.volume }))}>נפח לדוגמה</button>
            </div>}
            {mode === '3d' && <button type="button" className={`btn small ${orbit ? 'on' : ''}`} aria-pressed={orbit} onClick={() => setOrbit((o) => !o)}>{orbit ? 'עצירת הסיבוב' : 'סיבוב סביב התכנית'}</button>}
            {tl && <label className="pv-opacity">שקיפות התשריט<input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="שקיפות התשריט" /></label>}
          </div>
          <PlanMap3D layers={mapLayers} visible={visible} mode={mode} bbox={bbox} tashrit={tl?.image_bounds && tUrl ? { url: tUrl, bounds: tl.image_bounds, opacity } : null}
            drawing={drawing} onDrawPoint={(p) => setPts((x) => [...x, p])} draft={pts} show={show} orbit={orbit} />
          {mode === '3d' && <div className="ls">{hasEnv ? 'מעטפת מותרת: קווי הבניין כפול הגובה המרבי, בזכוכית בהירה. נפח לדוגמה: בסיס ומגדל מחושבים משטחי טבלה 5, מחולקים לקומות.' : 'נפח מקורב: מגרש המגורים בגובה הקומות המותר.'} לחיצה על מבנה מציגה את נתוניו.</div>}
          <ul className="pv-layers" data-testid="layer-list">
            {kindsHere.map((k) => (
              <li key={k}>
                <label><input type="checkbox" checked={visible.has(k)} onChange={() => toggle(k)} data-layer={k} /> <span className={`lk lk-${k}`} />{LAYER_TITLE[k]}</label>
                <span className={`chip ${acc(k) === 'exact' ? 'acc-exact' : 'acc-approx'}`}>{acc(k) === 'exact' ? 'מקור מדויק' : 'קירוב'}</span>
                <span className="ls">{layers.find((l) => l.kind === k)?.source ?? (k === 'blue_line' ? 'גבול התכנית השמור' : '')}</span>
                {layers.find((l) => l.kind === k)?.note && <span className="ls">{layers.find((l) => l.kind === k)?.note}</span>}
              </li>
            ))}
            {missingKinds.map((k) => <li key={k} className="off"><span>{LAYER_TITLE[k]}</span> <span className="chip st-missing">חסר</span></li>)}
          </ul>
          {canWrite && (
            <div className="pv-edit">
              <label className="btn small">טעינת תשריט (PDF או תמונה)<input type="file" hidden accept=".pdf,image/*" aria-label="קובץ תשריט" onChange={(e) => uploadTashrit(e.target.files?.[0])} /></label>
              {tl && <div className="row-actions" aria-label="יישור התשריט">
                <span className="ls">יישור:</span>
                <button type="button" className="btn small ghost" onClick={() => nudge(0, 0.01, 0)}>למעלה</button>
                <button type="button" className="btn small ghost" onClick={() => nudge(0, -0.01, 0)}>למטה</button>
                <button type="button" className="btn small ghost" onClick={() => nudge(0.01, 0, 0)}>ימינה</button>
                <button type="button" className="btn small ghost" onClick={() => nudge(-0.01, 0, 0)}>שמאלה</button>
                <button type="button" className="btn small ghost" onClick={() => nudge(0, 0, 0.02)}>הגדלה</button>
                <button type="button" className="btn small ghost" onClick={() => nudge(0, 0, -0.02)}>הקטנה</button>
              </div>}
              {!drawing ? <button type="button" className="btn small" onClick={() => { setDrawing(true); setPts([]); setMode('2d'); }}>שרטוט טביעת רגל של מבנה מוצע</button> : (
                <div className="row-actions">
                  <span className="ls">לחיצה על המפה מוסיפה פינה. {pts.length} נקודות.</span>
                  <label className="ls">קומות<input className="input small-input" inputMode="numeric" value={floors} onChange={(e) => setFloors(e.target.value.replace(/\D/g, ''))} aria-label="מספר קומות" /></label>
                  <button type="button" className="btn small primary" disabled={pts.length < 3} onClick={saveFootprint}>שמירת המבנה</button>
                  <button type="button" className="btn small ghost" onClick={() => { setDrawing(false); setPts([]); }}>ביטול</button>
                </div>
              )}
            </div>
          )}
          {msg && <div className="notice" role="status" data-testid="pv-msg">{msg}</div>}
        </section>

        <aside className="pv-side">
          <section className="card" data-testid="plan-facts">
            <div className="card-head"><h2>נתונים</h2></div>
            <dl className="kv pv-kv">
              {facts.map((x) => (
                <div key={x.label} className="kv-row"><dt>{x.label}</dt>
                  <dd className="mono">{fmt(x.f.value)}{x.f.q?.note && /הערכה|לאמת|פרסום/.test(x.f.q.note) && <span className="chip st-warn">לבדיקה</span>}</dd>
                  {x.f.q?.quote && <dd className="ls src">{x.f.q.quote}{x.f.q.page ? `, עמ' ${x.f.q.page}` : ''}</dd>}
                </div>
              ))}
              <div className="kv-row"><dt>סטטוס</dt><dd>{STATUS_GROUP_LABEL[g]}</dd></div>
              <div className="kv-row"><dt>הפקדה</dt><dd className="mono">{dmy(plan.deposit_date)}</dd></div>
              <div className="kv-row"><dt>אישור</dt><dd className="mono">{dmy(plan.approval_date)}</dd></div>
              <div className="kv-row"><dt>רובע</dt><dd>{plan.quarter ?? 'חסר'}</dd></div>
              <div className="kv-row"><dt>מתחם בתכנית המתאר</dt><dd>{district ? `${district.id}. ${district.name}` : 'חסר'}</dd></div>
              <div className="kv-row"><dt>שטח</dt><dd className="mono">{plan.area_m2 ? `${fmt(plan.area_m2 / 1000, 1)} דונם` : 'חסר'}</dd></div>
            </dl>
            {plan.note && <div className="ls">{plan.note}</div>}
            {plan.status_note && <div className="ls">{plan.status_note}</div>}
            {isMember && <Link className="linklike ls" to={`/plans/${plan.id}`}>עריכת הנתונים בתיק התכנית</Link>}
          </section>
          <section className="card" data-testid="plan-sources">
            <div className="card-head"><h2>מסמכי מקור</h2></div>
            <ul className="src-list">
              {plan.mavat_url && <li><a href={plan.mavat_url} target="_blank" rel="noreferrer">התכנית באתר מבא"ת</a></li>}
              {docs.map((d) => <li key={d.id}><button type="button" className="linklike" onClick={async () => { try { window.open(await docUrl(d.file_path), '_blank'); } catch (e) { setMsg((e as Error).message); } }}>{d.name}</button> <span className="ls" dir="ltr">{d.file_name}</span></li>)}
            </ul>
            {!docs.length && !plan.mavat_url && <div className="ls">אין מסמכים פתוחים לצפייה.</div>}
            {plan.source && <div className="ls">מקור הנתונים: {plan.source}</div>}
          </section>
        </aside>
      </div>
    </Page>
  );
}
