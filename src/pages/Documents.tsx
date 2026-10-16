import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Page } from '../components/ui';

export interface Doc {
  id: string; name: string; doc_date: string | null; file_path: string; file_name: string | null; mime: string | null;
  size_bytes: number | null; district_id: number | null; plan_id: string | null; note: string | null; uploaded_by: string | null; created_at: string;
}
const BUCKET = 'mt-documents';
const MAX = 50 * 1024 * 1024;

const today = () => new Date().toISOString().slice(0, 10);
const baseName = (f: string) => f.replace(/\.[^.]+$/, '');
const ext = (f: string) => (f.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase();
export const fmtSize = (n: number | null) => n == null ? 'חסר' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtDate = (d: string | null) => (d ? d.split('-').reverse().join('.') : 'חסר');

export default function DocumentsPage() {
  const { districts, plans } = useStore();
  const { isMember, canWrite, session, ready } = useAuth();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ name: '', doc_date: today(), district_id: '', plan_id: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!isMember) { setDocs([]); setLoading(false); return; }
    const { data, error } = await supabase.from('mt_documents').select('*').order('doc_date', { ascending: false, nullsFirst: false });
    if (error) setMsg(`שגיאה בטעינה: ${error.message}`); else setDocs(data as Doc[]);
    setLoading(false);
  }, [isMember]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > MAX) { setMsg('הקובץ גדול מ-50MB'); return; }
    setFile(f); setMsg(null);
    setForm((x) => ({ ...x, name: x.name || baseName(f.name) }));
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); };

  const upload = async () => {
    if (!file) { setMsg('לא נבחר קובץ'); return; }
    if (!form.name.trim()) { setMsg('חסר שם מסמך'); return; }
    setBusy(true); setMsg('מעלה');
    const path = `${(form.doc_date || today()).slice(0, 4)}/${crypto.randomUUID()}.${ext(file.name)}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (up.error) { setBusy(false); setMsg(`שגיאה בהעלאה: ${up.error.message}`); return; }
    const ins = await supabase.from('mt_documents').insert({
      name: form.name.trim(), doc_date: form.doc_date || null, file_path: path, file_name: file.name, mime: file.type || null, size_bytes: file.size,
      district_id: form.district_id ? Number(form.district_id) : null, plan_id: form.plan_id || null, note: form.note || null, uploaded_by: session?.user.email ?? null,
    });
    setBusy(false);
    if (ins.error) { await supabase.storage.from(BUCKET).remove([path]); setMsg(`שגיאה בשמירה: ${ins.error.message}`); return; }
    setMsg('המסמך נשמר'); setFile(null); setForm({ name: '', doc_date: today(), district_id: '', plan_id: '', note: '' });
    if (input.current) input.current.value = '';
    load();
  };

  const openDoc = async (d: Doc) => {
    const w = window.open('', '_blank');
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.file_path, 300);
    if (error || !data) { w?.close(); setMsg(`שגיאה בפתיחה: ${error?.message ?? ''}`); return; }
    if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
  };
  const remove = async (d: Doc) => {
    if (!window.confirm(`למחוק את "${d.name}"?`)) return;
    const r = await supabase.storage.from(BUCKET).remove([d.file_path]);
    if (r.error) { setMsg(`שגיאה במחיקה: ${r.error.message}`); return; }
    const del = await supabase.from('mt_documents').delete().eq('id', d.id);
    setMsg(del.error ? `שגיאה במחיקה: ${del.error.message}` : 'המסמך נמחק');
    load();
  };

  const rows = useMemo(() => docs.filter((d) => !q || `${d.name} ${d.file_name ?? ''} ${d.note ?? ''}`.includes(q)), [docs, q]);
  const dName = (id: number | null) => districts.find((x) => x.id === id)?.name ?? '';

  return (
    <Page kicker="ספרייה" title="מסמכים">
      {!isMember ? (
        <div className="notice">ספריית המסמכים פתוחה לחברי הצוות בלבד. כניסה דרך כפתור "מערכת" בסרגל העליון.</div>
      ) : (
        <>
          {canWrite && (
            <section className="card">
              <div className="card-head"><h2>העלאת מסמך</h2><span className="ls">כל סוג קובץ, עד 50MB</span></div>
              <motion.label className={`dropzone ${drag ? 'over' : ''} ${file ? 'has' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} whileHover={{ y: -1 }}>
                <input ref={input} type="file" aria-label="בחירת קובץ" onChange={(e) => pick(e.target.files?.[0])} />
                {file ? <><b dir="auto"><bdi>{file.name}</bdi></b><span className="mono ls">{fmtSize(file.size)}</span></> : <><b>גרירת קובץ לכאן</b><span className="ls">או לחיצה לבחירה</span></>}
              </motion.label>
              <div className="form-grid">
                <label>שם המסמך<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                <label>תאריך המסמך<input className="input mono" type="date" value={form.doc_date} onChange={(e) => setForm({ ...form, doc_date: e.target.value })} /></label>
                <label>מתחם<select className="input" aria-label="מתחם המסמך" value={form.district_id} onChange={(e) => setForm({ ...form, district_id: e.target.value })}><option value="">כללי</option>{districts.map((d) => <option key={d.id} value={d.id}>{d.id}. {d.name}</option>)}</select></label>
                <label>תכנית<select className="input" aria-label="תכנית המסמך" value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}><option value="">ללא</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className="wide">הערה<input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
              </div>
              <div className="row-actions"><button type="button" className="btn primary" disabled={busy || !file} onClick={upload}>{busy ? 'מעלה' : 'שמירת מסמך'}</button></div>
            </section>
          )}
          {msg && <div className="notice" role="status">{msg}</div>}
          <div className="toolbar">
            <input className="input" placeholder="חיפוש" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש מסמכים" />
            <span className="mono ls">{rows.length} מסמכים</span>
          </div>
          <div className="table-wrap card">
            {loading ? <div className="loading">טוען</div> : rows.length === 0 ? <div className="notice">אין מסמכים עדיין.</div> : (
              <table className="table">
                <thead><tr><th>שם</th><th>תאריך</th><th>קובץ</th><th>שיוך</th><th>הועלה על ידי</th><th /></tr></thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} data-testid="doc-row">
                      <td><b>{d.name}</b>{d.note && <div className="ls">{d.note}</div>}</td>
                      <td className="mono">{fmtDate(d.doc_date)}</td>
                      <td><span className="mono">{ext(d.file_name ?? d.file_path).toUpperCase()}</span> <span className="ls mono">{fmtSize(d.size_bytes)}</span></td>
                      <td>{d.district_id ? `${d.district_id}. ${dName(d.district_id)}` : 'כללי'}{d.plan_id && <div className="ls">{plans.find((p) => p.id === d.plan_id)?.name}</div>}</td>
                      <td className="ls">{d.uploaded_by ?? ''}</td>
                      <td><div className="row-actions"><button type="button" className="btn small" onClick={() => openDoc(d)}>פתיחה</button>{canWrite && <button type="button" className="btn small ghost" onClick={() => remove(d)}>מחיקה</button>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
