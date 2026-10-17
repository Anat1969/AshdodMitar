import { Link } from 'react-router-dom';
import { CertaintyChip, Page } from '../components/ui';
import { TOPICS } from '../lib/topics';

const SOURCES: { name: string; what: string; certainty: string }[] = [
  { name: 'הוראות תכנית 603-0528026 (נוסח 2019)', what: 'יעדי אוכלוסייה, תוספת יח"ד, שטחי תעסוקה וטבלאות רח"ק לכל מתחם. התכנית אינה בתוקף ומשמשת כהנחיה בלבד', certainty: 'plan-draft' },
  { name: 'מסמך מדיניות עירונית תכנונית, טיוטה 09/2026', what: 'גודל משק בית, שיעורי שנתון, סף-בית, תמהיל, חלחול, תועלות ציבוריות', certainty: 'policy-draft' },
  { name: 'GIS עירוני, עיריית אשדוד', what: 'גבולות 35 רובעים, ו-876 מוסדות חינוך עם מספר כיתות', certainty: 'municipal' },
  { name: 'OpenStreetMap', what: 'גבול השיפוט, ודרך OpenFreeMap: גנים, מבנים, כבישים, מסחר ומבני ציבור', certainty: 'osm' },
  { name: 'הנחות עבודה', what: 'שיוך רובעים למתחמים, 30 תלמידים בכיתה, 30 ילדים בגן, 3 שנתוני גן', certainty: 'assumption' },
];

export default function AboutPage() {
  return (
    <Page kicker="איך זה עובד" title="קלט, חישוב ופלט">
      <div className="row-actions">
        <Link className="btn primary" to="/overview">לתמונת העיר</Link>
        <Link className="btn" to="/map">מפה ושכבות</Link>
        <Link className="btn" to="/plan/new">בדיקת תכנית</Link>
      </div>
      <p className="lead">התאום מחזיק תמונה אחת של העיר: מה קיים היום, מה מתוכנן, ומה היעד שתכנית המתאר קובעת. כל תכנית שנכנסת היא תוספת לתמונה הזו, והמפה והמספרים מתעדכנים בהתאם.</p>

      <section className="flow" aria-label="זרימת העבודה">
        <div className="flow-step card">
          <div className="kicker">1. קלט</div>
          <h2>תכנית</h2>
          <ul>
            <li>זיהוי: שם, מספר, מתחם, סטטוס, מגזר ומרקם</li>
            <li>יח"ד ותמהיל דירות</li>
            <li>שטחים: תוספת בנייה, שטח ציבורי, סף-בית, מגרש, חלחול</li>
            <li>מיקום: מרחק ממתע"ן, רח"ק ושורת ייעוד</li>
            <li>פרוגרמה: כיתות, גנים, קרקע לחינוך, שצ"פ, מסחר, משרדים, כבישים</li>
          </ul>
        </div>
        <div className="flow-step card">
          <div className="kicker">2. חישוב</div>
          <h2>מנוע הכללים</h2>
          <ul>
            <li>8 כללי תכנית: תמהיל, אוכלוסייה, חינוך, תועלות, סף-בית, חניה, חלחול, רח"ק</li>
            <li>2 כללי מתחם: סף אוכלוסייה (6.3) ואיזון התחדשות (6.1)</li>
            <li>כתב כמויות: מה התכנית מספקת מול מה שהיא מייצרת</li>
            <li>מטריצת נושאים: קיים ועוד מתוכנן מול יעד, לכל מתחם</li>
          </ul>
        </div>
        <div className="flow-step card">
          <div className="kicker">3. פלט</div>
          <h2>החלטה מנומקת</h2>
          <ul>
            <li>כרטיס לכל כלל, עם מקור ורמת ודאות</li>
            <li>כתב כמויות: עונה, חסר מענה, או חסר נתון</li>
            <li>השפעה על המתחם: לפני ואחרי התכנית</li>
            <li>מפה שמתעדכנת: התקדמות כל מתחם ליעד בכל נושא</li>
            <li>דוח שנתי לפי סעיף 6.2</li>
          </ul>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>הנושאים, והיעד של כל אחד</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>נושא</th><th>יחידה</th><th>איך נקבע היעד</th><th>ודאות</th></tr></thead>
            <tbody>{TOPICS.map((t) => <tr key={t.key}><td><b>{t.title}</b></td><td>{t.unit}</td><td>{t.targetRule}</td><td><CertaintyChip certainty={t.targetCertainty} /></td></tr>)}</tbody>
          </table>
        </div>
        <div className="ls">התקדמות היא קיים ועוד מתוכנן, חלקי היעד. ביח"ד היעד הוא התוספת שבתכנית, ולכן נמדד רק המתוכנן.</div>
      </section>

      <section className="card">
        <div className="card-head"><h2>מקורות המידע</h2></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>מקור</th><th>מה נלקח ממנו</th><th>ודאות</th></tr></thead>
            <tbody>{SOURCES.map((s) => <tr key={s.name}><td><b>{s.name}</b></td><td>{s.what}</td><td><CertaintyChip certainty={s.certainty} /></td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>מה עוד חסר</h2></div>
        <ul className="missing-list">
          <li>אוכלוסייה קיימת לכל מתחם. בלעדיה סף 6.3 מוצג "חסר"</li>
          <li>מלאי יח"ד, שטחי מסחר ומשרדים קיימים לפי מתחם</li>
          <li>נספח המתחמים הרשמי (כרגע: רובעים רשמיים לפי שיוך משוער)</li>
          <li>פרוגרמה לצרכי ציבור, נספח תנועה ותוואי מתע"ן</li>
          <li>רשימת התכניות האמיתיות בצנרת</li>
        </ul>
        <div className="row-actions"><Link className="btn primary" to="/plan/new">לבדיקת תכנית</Link><Link className="btn" to="/map">למפה</Link></div>
      </section>
    </Page>
  );
}
