import { Link } from 'react-router-dom';
import { fmt, type District, type Plan } from '../lib/data';
import { FLAG_LABEL, type Domain, type Flag, type Ledger, type LedgerCell } from '../lib/ledger';
import { CertaintyChip } from './ui';

export const pctText = (p: number | null) => (p == null ? 'חסר' : `${Math.round(p * 100)}%`);

export function Flags({ flags, estimated }: { flags: Flag[]; estimated?: boolean }) {
  return (
    <span className="flags">
      {flags.map((f) => <span key={f} className={`chip flag-${f}`}>{FLAG_LABEL[f]}</span>)}
      {estimated && <span className="chip st-warn">הערכה</span>}
    </span>
  );
}

export function Progress({ p, scenario }: { p: number | null; scenario?: number | null }) {
  return (
    <div className="ledger-progress">
      <div className="bar" aria-label={pctText(p)}>
        {scenario != null && <span className="scn" style={{ width: `${Math.min(100, scenario * 100)}%` }} />}
        <span style={{ width: `${Math.min(100, (p ?? 0) * 100)}%` }} className={p != null && p >= 1 ? 'done' : ''} />
      </div>
      <span className="mono ls">{pctText(p)}</span>
    </div>
  );
}

function Remaining({ c }: { c: LedgerCell }) {
  if (c.remaining != null) return <span className={`mono ${c.remaining < 0 ? 'neg' : ''}`}>{fmt(c.remaining)}</span>;
  if (c.target == null) return <span className="mono">חסר</span>;
  return <span><span className="mono">חסר קיים</span><span className="ls">. יעד פחות תכניות: <span className="mono">{fmt(c.remainingBeforeExisting)}</span></span></span>;
}

// District summary: per domain, target, existing, each approved plan, total, remaining, % and the in-process scenario.
export function DistrictLedger({ districtId, ledger, domains, plans, isMember }: { districtId: number; ledger: Ledger; domains: Domain[]; plans: Plan[]; isMember: boolean }) {
  const row = ledger[districtId];
  if (!row) return null;
  const contributing = plans.filter((p) => Object.values(row).some((c) => c.contributions.some((x) => x.plan_id === p.id && x.bucket === 'approved')));
  const scenarioPlans = plans.filter((p) => Object.values(row).some((c) => c.contributions.some((x) => x.plan_id === p.id && x.bucket === 'scenario')));
  const inExisting = plans.filter((p) => Object.values(row).some((c) => c.contributions.some((x) => x.plan_id === p.id && x.bucket === 'in-existing')));
  return (
    <>
      <div className="table-wrap">
        <table className="table ledger" data-testid="district-ledger">
          <thead><tr>
            <th>תחום</th><th>יעד</th><th>קיים</th>
            {contributing.map((p) => <th key={p.id}><Link to={`/plans/${p.id}`} className="mono">{p.plan_number ?? p.name}</Link></th>)}
            <th>סה"כ מאושר</th><th>יתרה</th><th>מימוש</th><th>תרחיש בהליך</th><th>סימון</th>
          </tr></thead>
          <tbody>{domains.map((dm) => {
            const c = row[dm.key]; if (!c) return null;
            return (
              <tr key={dm.key} data-domain={dm.key}>
                <td><b>{dm.title}</b> <span className="ls">{dm.unit}</span>{c.drafts > 0 && <div className="ls">{c.drafts} נתונים ממתינים לאישור</div>}</td>
                <td><span className="mono">{fmt(c.target)}</span> <CertaintyChip certainty={c.t?.target_certainty ?? 'missing'} />{c.t?.target_source && <div className="ls">{c.t.target_source}{c.t.target_page ? `, עמ' ${c.t.target_page}` : ''}</div>}</td>
                <td><span className="mono">{fmt(c.existing)}</span>{c.t?.existing_source && <div className="ls">{c.t.existing_source}{c.t.existing_date ? `, ${c.t.existing_date.split('-').reverse().join('.')}` : ''}</div>}</td>
                {contributing.map((p) => { const x = c.contributions.find((y) => y.plan_id === p.id && y.bucket === 'approved'); return <td key={p.id} className="mono">{x ? <>{fmt(x.value)}{x.split === 'area' && <span className="ls"> הערכה</span>}</> : ''}</td>; })}
                <td className="mono">{isMember ? fmt(c.approved) : 'לצוות'}</td>
                <td><Remaining c={c} /></td>
                <td><Progress p={c.progress} scenario={c.scenarioProgress} /></td>
                <td className="mono">{isMember ? <>{fmt(c.scenario)}{c.scenarioProgress != null && <span className="ls"> עד {pctText(c.scenarioProgress)}</span>}</> : 'לצוות'}</td>
                <td><Flags flags={c.flags} estimated={c.estimated} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <div className="ls">יתרה = יעד, פחות קיים, פחות תכניות מאושרות. נספר רק נתון מאושר. בתרחיש: תכניות בצנרת ובהפקדה, מחוץ לסה"כ. הפס הבהיר מראה את המימוש בתרחיש.</div>
      {isMember && scenarioPlans.length > 0 && <div className="ls">בתרחיש: {scenarioPlans.map((p) => p.plan_number ?? p.name).join(', ')}</div>}
      {isMember && inExisting.length > 0 && <div className="ls">כלולות כבר בקיים (אושרו לפני תאריך הקיים): {inExisting.map((p) => p.plan_number ?? p.name).join(', ')}</div>}
    </>
  );
}

// City summary: every district and domain, progress with flags.
export function CityLedger({ ledger, domains, districts }: { ledger: Ledger; domains: Domain[]; districts: District[] }) {
  return (
    <div className="table-wrap">
      <table className="table ledger city" data-testid="city-ledger">
        <thead><tr><th>מתחם</th>{domains.map((d) => <th key={d.key}>{d.title}</th>)}</tr></thead>
        <tbody>{districts.map((d) => (
          <tr key={d.id}>
            <td><Link to={`/district/${d.id}`}><span className="mono">{d.id}</span> {d.name}</Link></td>
            {domains.map((dm) => {
              const c = ledger[d.id]?.[dm.key];
              return (
                <td key={dm.key} data-cell={`${d.id}:${dm.key}`}>
                  {c && c.target != null ? <>
                    <Progress p={c.progress} scenario={c.scenarioProgress} />
                    <div className="ls">יתרה <Remaining c={c} /></div>
                    <Flags flags={c.flags} estimated={c.estimated} />
                  </> : <span className="mono ls">חסר יעד</span>}
                </td>
              );
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
