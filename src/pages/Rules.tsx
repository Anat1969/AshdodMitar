import { useState } from 'react';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { CERTAINTY_LABEL, PARAMS } from '../lib/rules';
import { CertaintyChip, Loading, Page } from '../components/ui';

const SCOPE: Record<string, string> = { plan: 'כללי תכנית', district: 'כללי מתחם', city: 'כללי עיר' };

export default function RulesPage() {
  const { rules, loading, error, refresh } = useStore();
  const { canWrite } = useAuth();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ formula: '', certainty: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (loading) return <main className="page"><Loading error={error} /></main>;

  const save = async (id: string, version: number) => {
    const { error: e } = await supabase.from('mt_rules').update({ formula: draft.formula, certainty: draft.certainty, version: version + 1, updated_at: new Date().toISOString() }).eq('id', id);
    setMsg(e ? `שגיאה: ${e.message}` : 'הכלל עודכן. גרסה חדשה נרשמה.');
    if (!e) { setEditing(null); refresh(); }
  };

  return (
    <Page kicker="קטלוג" title="כללי המדיניות">
      <p className="lead">כל כלל מחזיר עומד, לא עומד, מותנה, נגזר או חסר. כלל עם נתון חסר אינו מנחש. הנחת עבודה מוצגת תמיד עם תווית.</p>
      {msg && <div className="notice">{msg}</div>}
      {(['plan', 'district', 'city'] as const).map((scope) => (
        <section key={scope}>
          <div className="section-head"><h2>{SCOPE[scope]}</h2></div>
          <div className="rule-grid">
            {rules.filter((r) => r.scope === scope).map((r) => (
              <article key={r.id} className="rule-card" data-testid={`rule-${r.id}`}>
                <header><span className="mono code">{r.id}</span><h3>{r.title}</h3><span className="mono ls">גרסה {r.version}</span></header>
                {editing === r.id ? (
                  <div className="form-grid">
                    <label className="wide">נוסחה<textarea className="input" value={draft.formula} onChange={(e) => setDraft({ ...draft, formula: e.target.value })} /></label>
                    <label>ודאות<select className="input" value={draft.certainty} onChange={(e) => setDraft({ ...draft, certainty: e.target.value })}>
                      {['statutory', 'plan-draft', 'policy-draft', 'assumption', 'missing'].map((c) => <option key={c} value={c}>{CERTAINTY_LABEL[c]}</option>)}
                    </select></label>
                    <div className="row-actions"><button type="button" className="btn primary" onClick={() => save(r.id, r.version)}>שמירה</button><button type="button" className="btn ghost" onClick={() => setEditing(null)}>ביטול</button></div>
                  </div>
                ) : <p className="msg">{r.formula}</p>}
                <footer>
                  <CertaintyChip certainty={r.certainty} /><span className="src">{r.source}</span>
                  {canWrite && editing !== r.id && <button type="button" className="btn small ghost" onClick={() => { setEditing(r.id); setDraft({ formula: r.formula, certainty: r.certainty }); }}>עריכה</button>}
                </footer>
              </article>
            ))}
          </div>
        </section>
      ))}
      <section className="card">
        <div className="card-head"><h2>פרמטרים במנוע</h2><CertaintyChip certainty="assumption" /></div>
        <div className="ls">גודל כיתה {PARAMS.classSize} הוא הנחת עבודה: אינו מופיע במסמכי המקור, והעירייה צריכה לקבוע אותו. שינוי נוסחה בקטלוג אינו משנה את המנוע עד לעדכון קוד ובדיקה.</div>
        <pre className="params mono" dir="ltr">{JSON.stringify(PARAMS, null, 1)}</pre>
      </section>
    </Page>
  );
}
