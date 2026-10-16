import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { fmt } from '../lib/data';
import { population } from '../lib/rules';
import { toInput } from '../lib/data';
import MapView from '../components/MapView';
import { CertaintyChip, Disclaimer, Gauge, Loading, StatusChip } from '../components/ui';

export default function Home() {
  const { city, districts, plans, gates, renewal, loading, error } = useStore();
  const { isMember } = useAuth();
  if (loading || !city) return <main className="page"><Loading error={error} /></main>;

  const approvedPop = plans.filter((p) => p.status === 'approved').reduce((a, p) => a + (population(toInput(p)).values.population as number), 0);
  const pipePop = plans.filter((p) => !['approved', 'rejected'].includes(p.status)).reduce((a, p) => a + (population(toInput(p)).values.population as number), 0);

  return (
    <main className="page home">
      <section className="hero">
        <motion.div className="hero-text" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <div className="kicker mono">תאום עירוני לתכנית המתאר הכוללנית</div>
          <h1 className="display">כל תכנית היא דלתא בתאום העיר</h1>
          <p className="lead">בודקים תכנית מול כללי המדיניות, גוזרים ביקוש ציבורי, ורואים את ההשפעה המצטברת על המתחם מול הספים שהתכנית עצמה קובעת (סעיפים 6.1, 6.2 ו-6.3).</p>
          <div className="row-actions">
            <Link className="btn primary" to="/map">מפה ושכבות</Link>
            <Link className="btn" to="/plan/new">בדיקת תכנית</Link>
            <Link className="btn" to={`/report/${new Date().getFullYear()}`}>דוח 6.2</Link>
          </div>
        </motion.div>
        <motion.div className="hero-gauge card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div className="card-head"><h2>מד עירוני</h2><CertaintyChip certainty="plan-draft" /></div>
          <Gauge label="תושבים היום" value={city.current_pop} target={city.plan_target_pop}
            marks={[{ v: city.plan_capacity_pop, label: 'קיבולת' }, { v: city.pipeline_pop, label: 'צנרת' }]}
            note={`${city.current_pop_date}. ${city.current_pop_source}`} />
          <div className="stats">
            <div><span className="mono big">{fmt(city.current_pop)}</span><span>קיים</span></div>
            <div><span className="mono big">{isMember ? fmt(approvedPop) : 'לצוות'}</span><span>מאושר בתאום</span></div>
            <div><span className="mono big">{isMember ? fmt(pipePop) : 'לצוות'}</span><span>צנרת בתאום</span></div>
            <div><span className="mono big">{fmt(city.plan_target_pop)}</span><span>יעד {city.plan_target_year}</span></div>
          </div>
          <div className="phasing">
            {city.phasing.map((s) => (
              <div key={s.stage} className="phase"><span className="mono">שלב {s.stage}</span><span>התחדשות {fmt(s.renewal_pop_added)}, עתודות {fmt(s.reserves_pop_added)}</span><span className="mono">מצטבר {fmt(s.cumulative_target)}</span></div>
            ))}
          </div>
          <div className="ls">צנרת עירונית לפי מסמך המדיניות: {fmt(city.pipeline_pop)}. {city.pipeline_pop_source}</div>
        </motion.div>
      </section>

      <section className="home-map card">
        <div className="card-head"><h2>מפת המתחמים</h2><span className="ls">לחיצה על מתחם פותחת סיכום. שכבות וצביעה בכפתורים שעל המפה.</span></div>
        <MapView />
      </section>

      <section>
        <div className="section-head"><h2>תשעת המתחמים</h2>{isMember && <StatusChip status={renewal.status} />}{isMember && <span className="ls">{renewal.message}</span>}</div>
        <div className="grid-cards">
          {districts.map((d, i) => (
            <motion.div key={d.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link to={`/district/${d.id}`} className="d-card" data-testid={`district-card-${d.id}`}>
                <div className="d-num mono">{d.id}</div>
                <div className="d-body">
                  <h3>{d.name}</h3>
                  <div className="d-meta"><span>יעד <b className="mono">{fmt(d.target_pop)}</b></span><span>תוספת יח"ד <b className="mono">{fmt(d.units_added)}</b></span></div>
                  <div className="d-status"><StatusChip status={gates[d.id]?.status ?? 'missing'} gate />{!d.geom && <span className="chip st-missing">גבול חסר</span>}</div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
      <Disclaimer />
    </main>
  );
}
