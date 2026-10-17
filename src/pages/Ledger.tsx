import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { fmt } from '../lib/data';
import { cityCell, FLAG_LABEL } from '../lib/ledger';
import { downloadXlsx, ledgerRows, quantityRows } from '../lib/export';
import { CityLedger, Flags, Progress, pctText } from '../components/ledger';
import { CertaintyChip, Loading, Page } from '../components/ui';

export default function LedgerPage() {
  const { districts, domains, ledger, plans, quantities, loading, error } = useStore();
  const { isMember } = useAuth();
  const shown = districts.filter((d) => domains.some((dm) => ledger[d.id]?.[dm.key]?.target != null));

  const attention = useMemo(() => {
    const over: string[] = [], lag: string[] = [], open: { label: string; ratio: number; to: string }[] = [];
    for (const d of districts) for (const dm of domains) {
      const c = ledger[d.id]?.[dm.key]; if (!c) continue;
      const label = `${d.name}: ${dm.title}`;
      if (c.flags.includes('over')) over.push(label);
      if (c.flags.includes('lag')) lag.push(`${label} (${pctText(c.progress)} מול יח"ד ${pctText(ledger[d.id].housing?.progress ?? null)})`);
      if (c.remaining != null && c.target && c.remaining > 0) open.push({ label: `${label}: חסרים ${fmt(c.remaining)} ${dm.unit}`, ratio: c.remaining / c.target, to: `/district/${d.id}` });
    }
    return { over, lag, open: open.sort((a, b) => b.ratio - a.ratio).slice(0, 6) };
  }, [districts, domains, ledger]);

  if (loading) return <main className="page"><Loading error={error} /></main>;
  const drafts = quantities.filter((q) => q.status === 'draft').length;

  const exportXlsx = () => downloadXlsx(`ashdod-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: 'מאזן לפי מתחם ותחום', rows: ledgerRows(ledger, domains, districts) },
    { name: 'כמויות לפי תכנית', rows: quantityRows(quantities, plans, domains) },
  ]);

  return (
    <Page kicker="מאזן מימוש" title="איפה העיר עומדת מול יעדי תכנית המתאר"
      actions={<>
        <button type="button" className="btn" onClick={exportXlsx}>ייצוא לאקסל</button>
        <button type="button" className="btn" onClick={() => window.print()}>ייצוא ל-PDF</button>
        <Link className="btn" to="/targets">יעדים ומצב קיים</Link>
        <Link className="btn primary" to="/plans">תכניות</Link>
      </>}>
      <p className="lead">לכל תחום: יעד תכנית המתאר, פחות מה שקיים, פחות מה שהתכניות המאושרות הוסיפו, שווה למה שעוד חסר. תכניות בהליך מוצגות כתרחיש בנפרד. רק נתון שאושר נכנס לחישוב.</p>
      {!isMember && <div className="notice">תרומת התכניות פתוחה לחברי הצוות אחרי כניסה. מוצגים כאן היעדים והמצב הקיים.</div>}
      {isMember && drafts > 0 && <div className="notice">{drafts} נתונים מחולצים ממתינים לאישור ואינם נספרים. <Link to="/plans">לתכניות</Link></div>}

      <section className="card">
        <div className="card-head"><h2>סיכום עירוני לפי תחום</h2></div>
        <div className="table-wrap">
          <table className="table ledger" data-testid="city-totals">
            <thead><tr><th>תחום</th><th>יעד</th><th>קיים</th><th>תכניות מאושרות</th><th>יתרה</th><th>מימוש</th><th>תרחיש בהליך</th><th>ודאות היעד</th><th>סימון</th></tr></thead>
            <tbody>{domains.map((dm) => {
              const c = cityCell(ledger, dm.key);
              return (
                <tr key={dm.key} data-domain={dm.key}>
                  <td><b>{dm.title}</b> <span className="ls">{dm.unit}</span></td>
                  <td className="mono">{fmt(c.target)}</td>
                  <td className="mono">{fmt(c.existing)}{c.coverage.known > 0 && c.coverage.known < c.coverage.of && <div className="ls">ב-{c.coverage.known} מתוך {c.coverage.of} מתחמים</div>}</td>
                  <td className="mono">{isMember ? fmt(c.approved) : 'לצוות'}</td>
                  <td className="mono">{c.remaining != null ? fmt(c.remaining) : c.target == null ? 'חסר' : 'חסר קיים'}{c.remaining != null && c.coverage.known < c.coverage.of && <div className="ls">חלקי: {c.coverage.known} מתוך {c.coverage.of} מתחמים</div>}</td>
                  <td><Progress p={c.progress} scenario={c.scenarioProgress} /></td>
                  <td className="mono">{isMember ? fmt(c.scenario) : 'לצוות'}</td>
                  <td><CertaintyChip certainty={dm.target_certainty} /></td>
                  <td><Flags flags={c.flags} estimated={c.estimated} /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <div className="ls">הסיכום העירוני כולל רק מתחמים שיש להם יעד בתחום. היתרה והמימוש מחושבים על המתחמים שיש להם מצב קיים, וכשחסר באחדים מסומן "חלקי".</div>
      </section>

      <div className="two-col">
        <section className="card" data-testid="attention">
          <div className="card-head"><h2>מה לקדם</h2></div>
          <h3 className="sub">הפער הגדול ביותר ביחס ליעד</h3>
          {attention.open.length ? <ul className="missing-list">{attention.open.map((o) => <li key={o.label}><Link to={o.to}>{o.label}</Link></li>)}</ul> : <div className="ls">אין עדיין תחום עם יעד וקיים ידועים.</div>}
          <h3 className="sub">{FLAG_LABEL.lag}</h3>
          {attention.lag.length ? <ul className="missing-list">{attention.lag.map((x) => <li key={x}>{x}</li>)}</ul> : <div className="ls">אין כרגע.</div>}
          <h3 className="sub">{FLAG_LABEL.over}</h3>
          {attention.over.length ? <ul className="missing-list">{attention.over.map((x) => <li key={x}>{x}</li>)}</ul> : <div className="ls">אין כרגע.</div>}
          <div className="ls">"מפגר אחרי יח"ד": מימוש התחום נמוך ביותר מ-15 נקודות ממימוש יח"ד באותו מתחם (הנחת עבודה).</div>
        </section>
        <section className="card">
          <div className="card-head"><h2>איך לקרוא</h2></div>
          <ul className="missing-list">
            <li>הפס הכהה: קיים ועוד מאושר, חלקי היעד. הפס הבהיר: כולל תכניות בהליך.</li>
            <li>"חסר קיים": אין עדיין מצב קיים מתועד, ולכן היתרה לא מחושבת. מוצג היעד פחות התכניות.</li>
            <li>"הערכה": חלק מהכמות חולק בין מתחמים לפי שטח, כי לא הייתה טבלת זכויות לפי מתחם.</li>
            <li>תכנית שאושרה לפני תאריך המצב הקיים כבר כלולה בקיים, ואינה נספרת שוב.</li>
          </ul>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>כל המתחמים והתחומים</h2><Link className="btn small" to="/map?theme=progress">במפה</Link></div>
        <CityLedger ledger={ledger} domains={domains} districts={shown.length ? shown : districts} />
      </section>
    </Page>
  );
}
