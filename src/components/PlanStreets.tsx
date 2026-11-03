// "רחובות התכנית": from which street do you enter the plan. Card for the plan page; computation in src/lib/planStreets.ts.
import { Fragment } from 'react';
import { BUFFER_M, readStreets, type PlanStreetsResult } from '../lib/planStreets';
import { CertaintyChip } from './ui';

// `**word**` becomes bold; nothing else is parsed
export function Marked({ text }: { text: string }) {
  return <>{text.split('**').map((t, i) => (i % 2 ? <b key={i}>{t}</b> : <Fragment key={i}>{t}</Fragment>))}</>;
}
const m = (x: number) => (x > 0 ? `${x.toLocaleString('en-US')} מ'` : '-');

export default function PlanStreets({ result, netUnits, error }: { result: PlanStreetsResult | null; netUnits: number | null; error?: string | null }) {
  const read = result ? readStreets(result, netUnits) : null;
  return (
    <section className="card ps-card" data-testid="plan-streets">
      <div className="card-head"><h2>רחובות התכנית</h2></div>
      {!result && <div className="ls">{error ? `שכבת הרחובות לא נטענה: ${error}` : 'טוען את שכבת הרחובות העירונית'}</div>}
      {read && result && <>
        <p className="ps-insight" data-testid="ps-insight"><Marked text={read.insight} /></p>
        <p className="ps-explain"><Marked text={read.explain} /></p>
        {result.streets.length > 0 && (
          <table className="ps-table">
            <thead><tr><th>רחוב</th><th>דרגה (הערכה)</th><th>בתוך</th><th>לאורך</th></tr></thead>
            <tbody>
              {result.streets.map((s) => (
                <tr key={s.key} data-rank={s.rank}>
                  <td className="ps-name">{s.name}</td>
                  <td className="ps-rank"><span className={`ps-w ps-w-${Math.min(s.rank, 9)}`} />{s.rankLabel}</td>
                  <td className="mono">{m(s.inside_m)}</td>
                  <td className="mono">{m(s.along_m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="ps-means" data-testid="ps-means">
          <h3>מה זה אומר לתכנון</h3>
          {read.entry && <div>כניסה מרכזית: <b>{read.entry.name}</b>, {read.entry.rankLabel}.</div>}
          <div><Marked text={read.perMetreNote} /></div>
        </div>
        <div className="ls ps-how" data-testid="ps-how">
          איך נבדק: קטעי רחוב במרחק עד {BUFFER_M} מ' מהקו הכחול. "לאורך" = קטע שרץ במקביל לקו הכחול (עד 30 מעלות), "בתוך" = שאר הקטע שבתוך התכנית. רחוב ראשי = שדרה ראשית ורחוב ראשי. רצועות חניה הוסרו.
          {' '}מקור: שכבת צירי הרחובות של העירייה (rehevot.shp), 03.11.2026 <CertaintyChip certainty="municipal" />
          {' '}דרגות הרחוב: הערכה מתוך שמות הרחובות, העירייה לא מסרה את המקרא <CertaintyChip certainty="assumption" />
        </div>
      </>}
    </section>
  );
}
