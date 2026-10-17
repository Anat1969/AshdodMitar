// In-page panel: a plan or a district opens on top of the current page (?peek=plan:<key> | district:<id>),
// so buttons serve the page they are on. The panel shows what the plan adds to each target, out of the whole.
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../lib/store';
import { fmt } from '../lib/data';
import { cityCell } from '../lib/ledger';
import { fact, findPlan, planKey, STATUS_GROUP_LABEL, statusGroup } from '../lib/plansapi';
import { GapLegend, GapRow, gapRows } from './GapBars';
import { shareText, usePeek } from '../lib/peek';

export default function Peek() {
  const { kind, key, close } = usePeek();
  return (
    <AnimatePresence>
      {kind && (
        <motion.aside key={`${kind}:${key}`} className="peek" role="dialog" aria-label={kind === 'plan' ? 'תכנית' : 'מתחם'} data-testid="peek"
          initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.22 }}>
          <button type="button" className="btn small ghost peek-close" onClick={close}>סגירה</button>
          {kind === 'plan' ? <PlanPeek k={key} /> : <DistrictPeek id={Number(key)} />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function PlanPeek({ k }: { k: string }) {
  const { plans, districts, quantities, ledger, domains } = useStore();
  const p = findPlan(plans, k);
  if (!p) return <div className="notice">תכנית לא נמצאה.</div>;
  const d = districts.find((x) => x.id === p.district_id);
  const f = (key: string) => fact(quantities, p.id, key, true).value;
  // what the plan adds in each domain, against the district's whole and the city's whole
  const rows = domains.map((dm) => {
    const c = d ? ledger[d.id]?.[dm.key] : undefined;
    const v = c?.contributions.filter((x) => x.plan_id === p.id).reduce((a, x) => a + x.value, 0) ?? 0;
    const need = c?.target != null ? c.target - (c.existing ?? 0) : null;
    const city = cityCell(ledger, dm.key);
    return { dm, v, need, target: c?.target ?? null, cityTarget: city.target, remaining: c?.remaining ?? null };
  }).filter((r) => r.v !== 0);
  return (
    <div className="peek-body" data-testid="peek-plan">
      <div className="kicker mono">תכנית {p.plan_number}</div>
      <h2>{p.name}</h2>
      <div className="peek-meta">
        <span className={`chip status-${statusGroup(p.status)}`}>{STATUS_GROUP_LABEL[statusGroup(p.status)]}</span>
        <span className="ls">{p.quarter ?? 'רובע חסר'}{d ? `, מתחם ${d.id} ${d.name}` : ''}</span>
      </div>
      <dl className="kv peek-kv">
        <div className="kv-row"><dt>יח"ד מוצעות</dt><dd className="mono">{fmt(f('units_proposed'))}</dd></div>
        <div className="kv-row"><dt>יח"ד קיימות להריסה</dt><dd className="mono">{fmt(f('units_existing'))}</dd></div>
        <div className="kv-row"><dt>קומות עד</dt><dd className="mono">{fmt(f('floors_max'))}</dd></div>
      </dl>
      <h3>החלק של התכנית ביעד</h3>
      {rows.length ? (
        <ul className="share-list" data-testid="peek-shares">
          {rows.map((r) => (
            <li key={r.dm.key}>
              <div className="share-head"><b>{r.dm.title}</b> <span className="mono">{r.v >= 0 ? '+' : ''}{fmt(r.v)}</span> <span className="ls">{r.dm.unit}</span></div>
              <div className="share-bar" role="img" aria-label={`${fmt(r.v)} מתוך ${fmt(r.need ?? r.target)}`}><span style={{ width: `${Math.min(100, Math.max(0, (r.v / Math.max(1, r.need ?? r.target ?? r.v)) * 100))}%` }} /></div>
              <div className="ls">
                {r.need != null ? `${fmt(r.v)} מתוך ${fmt(r.need)} שצריך במתחם (${shareText(r.v, r.need)})` : r.target != null ? `${fmt(r.v)} מתוך יעד ${fmt(r.target)} (בלי קיים)` : 'אין יעד במתחם'}
                {r.cityTarget ? `. בעיר: ${shareText(r.v, r.cityTarget)} מהיעד` : ''}
                {r.remaining != null ? `. נשאר במתחם אחרי כל התכניות: ${fmt(Math.max(0, r.remaining))}` : ''}
              </div>
            </li>
          ))}
        </ul>
      ) : <div className="ls">לתכנית אין עדיין נתון שנספר ביעד.</div>}
      <Link className="linklike" to={`/plan/${planKey(p)}`}>לדף התכנית: שכבות, תשריט ותלת-ממד</Link>
    </div>
  );
}

function DistrictPeek({ id }: { id: number }) {
  const { districts, ledger, domains, plans } = useStore();
  const d = districts.find((x) => x.id === id);
  if (!d) return <div className="notice">מתחם לא נמצא.</div>;
  return (
    <div className="peek-body" data-testid="peek-district">
      <div className="kicker mono">מתחם {d.id}</div>
      <h2>{d.name}</h2>
      <div className="ls">רובעים: {(d.quarters ?? []).map((q) => q.replace('rova-', '')).join(', ') || 'חסר'}. יעד לפי תכנית המתאר 603-0528026 (לא בתוקף).</div>
      <GapLegend />
      {gapRows(ledger, domains, plans, [d.id]).map((r) => <GapRow key={r.key} r={r} compact />)}
    </div>
  );
}
