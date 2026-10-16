import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { CertaintyChip, Loading, Page } from '../components/ui';

export default function RegisterPage() {
  const { register, loading, error, refresh } = useStore();
  const { canWrite } = useAuth();
  const [sp, setSp] = useSearchParams();
  const filter = sp.get('f') ?? 'all';
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ status: '', gap_note: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const rows = useMemo(() => register.filter((r) => {
    const missing = r.certainty === 'missing' || !r.date || !r.status || (r.status ?? '').includes('???') || !!r.gap_note;
    if (filter === 'missing' && !missing) return false;
    if (filter === 'plan' && !r.plan_number) return false;
    return !q || `${r.name} ${r.owner} ${r.type}`.includes(q);
  }), [register, filter, q]);
  if (loading) return <main className="page"><Loading error={error} /></main>;

  const save = async (id: number) => {
    const { error: e } = await supabase.from('mt_policy_register').update({ status: draft.status || null, gap_note: draft.gap_note || null, updated_at: new Date().toISOString() }).eq('id', id);
    setMsg(e ? `שגיאה: ${e.message}` : 'נשמר'); if (!e) { setEditing(null); refresh(); }
  };
  const setF = (v: string) => { const n = new URLSearchParams(sp); n.set('f', v); setSp(n, { replace: true }); };

  return (
    <Page kicker="מרשם" title="מסמכי מדיניות ותכניות">
      <div className="toolbar">
        <div className="seg" role="tablist">
          {[['all', 'הכל'], ['missing', 'עם חוסר'], ['plan', 'תכניות סטטוטוריות']].map(([k, v]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setF(k)}>{v}</button>
          ))}
        </div>
        <input className="input" placeholder="חיפוש" value={q} onChange={(e) => setQ(e.target.value)} aria-label="חיפוש במרשם" />
        <span className="mono ls">{rows.length} מתוך {register.length}</span>
      </div>
      {msg && <div className="notice">{msg}</div>}
      <div className="table-wrap card">
        <table className="table">
          <thead><tr><th>מסמך</th><th>סוג</th><th>גורם</th><th>סטטוס</th><th>תאריך</th><th>ודאות</th><th>חוסר</th>{canWrite && <th />}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b>{r.plan_number && <div className="mono ls">{r.plan_number}</div>}</td>
                <td>{r.type || 'חסר'}</td>
                <td>{r.owner || 'חסר'}</td>
                <td>{editing === r.id ? <input className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} /> : r.status || 'חסר'}</td>
                <td className="mono">{r.date || 'חסר'}</td>
                <td><CertaintyChip certainty={r.certainty ?? 'missing'} /></td>
                <td>{editing === r.id ? <input className="input" value={draft.gap_note} onChange={(e) => setDraft({ ...draft, gap_note: e.target.value })} /> : r.gap_note ?? ''}</td>
                {canWrite && <td>{editing === r.id
                  ? <div className="row-actions"><button type="button" className="btn small primary" onClick={() => save(r.id)}>שמירה</button><button type="button" className="btn small ghost" onClick={() => setEditing(null)}>ביטול</button></div>
                  : <button type="button" className="btn small ghost" onClick={() => { setEditing(r.id); setDraft({ status: r.status ?? '', gap_note: r.gap_note ?? '' }); }}>עריכה</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
