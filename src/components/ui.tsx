import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { CERTAINTY_LABEL, STATUS_LABEL, type RuleResult, type Status } from '../lib/rules';
import { TOPICS, type TopicCell, type TopicKey } from '../lib/topics';

export const GATE_LABEL: Record<Status, string> = { pass: 'תקין', warn: 'קרוב לסף', fail: 'חוצה סף', info: 'מידע', missing: 'חסר' };

export function StatusChip({ status, gate }: { status: Status; gate?: boolean }) {
  return <span className={`chip st-${status}`}>{gate ? GATE_LABEL[status] : STATUS_LABEL[status]}</span>;
}

export function CertaintyChip({ certainty }: { certainty: string }) {
  return <span className={`chip cert cert-${certainty}`}>{CERTAINTY_LABEL[certainty] ?? certainty}</span>;
}

export function RuleCard({ r, i = 0 }: { r: RuleResult; i?: number }) {
  return (
    <motion.article className={`rule-card st-border-${r.status}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
      <header>
        <span className="mono code">{r.id}</span>
        <h3>{r.title}</h3>
        <StatusChip status={r.status} />
      </header>
      <p className="msg">{r.message}</p>
      <footer>
        <CertaintyChip certainty={r.certainty} />
        <span className="src">{r.source}</span>
      </footer>
    </motion.article>
  );
}

export function Page({ children, title, kicker, actions }: { children: ReactNode; title: string; kicker?: string; actions?: ReactNode }) {
  return (
    <motion.main className="page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <div className="page-head">
        <div className="page-titles">
          {kicker && <div className="kicker mono">{kicker}</div>}
          <h1>{title}</h1>
        </div>
        {actions && <div className="row-actions">{actions}</div>}
      </div>
      {children}
      <Disclaimer />
    </motion.main>
  );
}

export function Disclaimer() {
  return (
    <footer className="disclaimer">
      כלי תומך החלטה. אינו מחליף הוראות דין, תכנית תקפה או שיקול דעת מוסד התכנון.
      <span className="mono"> תכנית 603-0528026 אינה בתוקף (בהכנה מחודשת) ואינה מחייבת.</span>
    </footer>
  );
}

export function Gauge({ label, value, target, marks, note }: { label: string; value: number | null; target: number; marks?: { v: number; label: string }[]; note?: string }) {
  const max = Math.max(target, ...(marks ?? []).map((m) => m.v), value ?? 0) * 1.05;
  const pct = value == null ? 0 : Math.min(100, (value / max) * 100);
  return (
    <div className="gauge">
      <div className="gauge-head"><span>{label}</span><span className="mono">{value == null ? 'חסר' : value.toLocaleString('he-IL')}</span></div>
      <div className="gauge-track">
        <motion.div className="gauge-fill" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} />
        <div className="gauge-target" style={{ insetInlineStart: `${(target / max) * 100}%` }}><span className="mono">יעד {target.toLocaleString('he-IL')}</span></div>
        {(marks ?? []).map((m) => (
          <div key={m.label} className="gauge-mark" style={{ insetInlineStart: `${(m.v / max) * 100}%` }}><span className="mono">{m.label}</span></div>
        ))}
      </div>
      {note && <div className="gauge-note">{note}</div>}
    </div>
  );
}

export function TopicsTable({ cells, isMember, testId }: { cells: Record<TopicKey, TopicCell>; isMember: boolean; testId?: string }) {
  const n = (v: number | null | undefined) => (v == null ? 'חסר' : v.toLocaleString('he-IL', { maximumFractionDigits: 0 }));
  return (
    <div className="table-wrap">
      <table className="table topics" data-testid={testId}>
        <thead><tr><th>נושא</th><th>קיים</th><th>מאושר ובהליך</th><th>יעד</th><th>יתרה</th><th>מימוש</th><th>ודאות היעד</th></tr></thead>
        <tbody>{TOPICS.map((t) => {
          const c = cells[t.key];
          if (!c) return null;
          const p = c.progress;
          return (
            <tr key={t.key} data-topic={t.key}>
              <td><b>{t.title}</b> <span className="ls">{t.unit}</span>{c.existingSource && <div className="ls">{c.existingSource}</div>}</td>
              <td className="mono">{n(c.existing)}</td>
              <td className="mono">{isMember ? n(c.planned) : 'לצוות'}</td>
              <td className="mono">{n(c.target)}</td>
              <td className="mono">{n(c.gap)}</td>
              <td><div className="bar" aria-label={p == null ? 'חסר' : `${Math.round(p * 100)}%`}><span style={{ width: `${Math.min(100, (p ?? 0) * 100)}%` }} className={p != null && p >= 1 ? 'done' : ''} /></div><span className="mono ls">{p == null ? 'חסר' : `${Math.round(p * 100)}%`}</span></td>
              <td><CertaintyChip certainty={c.certainty} /></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="loading">{error ? `שגיאה בטעינת נתונים: ${error}` : 'טוען נתונים'}</div>;
}

// Every page ends with one clear next step.
export function NextStep({ to, label, why }: { to: string; label: string; why?: string }) {
  return (
    <nav className="next-step" aria-label="הצעד הבא">
      <span className="kicker">הצעד הבא</span>
      <Link to={to} className="btn primary" data-testid="next-step">{label}</Link>
      {why && <span className="ls">{why}</span>}
    </nav>
  );
}
