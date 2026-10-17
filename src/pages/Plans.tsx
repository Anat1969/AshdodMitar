import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { fmt, PLAN_STATUS_LABEL } from '../lib/data';
import { IN_PROCESS } from '../lib/ledger';
import { Loading, Page } from '../components/ui';

type Filter = 'approved' | 'process' | 'all';

export default function PlansPage() {
  const { plans, quantities, loading, error } = useStore();
  const { isMember, canWrite } = useAuth();
  const [f, setF] = useState<Filter>('all');
  if (loading) return <main className="page"><Loading error={error} /></main>;
  const shown = plans.filter((p) => f === 'all' ? p.status !== 'rejected' : f === 'approved' ? p.status === 'approved' : IN_PROCESS.includes(p.status));

  return (
    <Page kicker="תכניות" title="תכניות מפורטות: מסמכים, נתונים וגבול" actions={canWrite && <Link className="btn primary" to="/plans/new">תכנית חדשה</Link>}>
      <p className="lead">לכל תכנית: מעלים את המסמכים (הוראות, טבלת זכויות, קובץ GIS), המערכת מחלצת כמויות, ואחרי אישור הן נכנסות למאזן המימוש של המתחם.</p>
      {!isMember ? <div className="notice">רשימת התכניות פתוחה לחברי הצוות אחרי כניסה, מכפתור "מערכת".</div> : (
        <>
          <div className="row-actions tabs" role="tablist" aria-label="סינון">
            {([['all', 'הכל'], ['approved', 'מאושרות'], ['process', 'בהליך']] as const).map(([k, t]) => <button key={k} type="button" role="tab" aria-selected={f === k} className={`btn small ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{t}</button>)}
          </div>
          <div className="table-wrap">
            <table className="table" data-testid="plans-table">
              <thead><tr><th>מספר</th><th>שם</th><th>סטטוס</th><th>תאריך אישור</th><th>נתונים מאושרים</th><th>ממתינים לאישור</th><th>גבול</th></tr></thead>
              <tbody>{shown.map((p) => {
                const qs = quantities.filter((q) => q.plan_id === p.id);
                return (
                  <tr key={p.id}>
                    <td className="mono"><Link to={`/plans/${p.id}`}>{p.plan_number ?? 'ללא מספר'}</Link></td>
                    <td><Link to={`/plans/${p.id}`}>{p.name}</Link>{p.is_example && <span className="chip st-info">דוגמה</span>}</td>
                    <td><span className={`chip ${p.status === 'approved' ? 'st-pass' : 'st-info'}`}>{PLAN_STATUS_LABEL[p.status]}</span></td>
                    <td className="mono">{p.approval_date ? p.approval_date.split('-').reverse().join('.') : 'חסר'}</td>
                    <td className="mono">{fmt(qs.filter((q) => q.status === 'approved').length)}</td>
                    <td className="mono">{fmt(qs.filter((q) => q.status === 'draft').length)}</td>
                    <td>{p.boundary ? <span className="chip st-pass">{p.boundary_source === 'drawn' ? 'שורטט' : 'מקובץ'}</span> : <span className="chip st-missing">חסר</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {!shown.length && <div className="notice">אין תכניות בסינון הזה.</div>}
        </>
      )}
    </Page>
  );
}
