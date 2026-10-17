// More tools: every earlier page and button stays available here, each with one sentence on its purpose.
import { Link } from 'react-router-dom';
import { NextStep, Page } from '../components/ui';

export const TOOLS: { to: string; title: string; purpose: string | null }[] = [
  { to: '/about', title: 'איך זה עובד', purpose: 'הסבר על הקלט, החישוב והפלט של הכלי, והמקורות.' },
  { to: '/overview', title: 'תמונת העיר', purpose: 'מד אוכלוסייה עירוני מול יעד תכנית המתאר, ונושאים לפי מתחם.' },
  { to: '/ledger', title: 'מאזן מימוש', purpose: 'מאזן מלא לכל המתחמים והתחומים, עם ייצוא לאקסל ול-PDF.' },
  { to: '/plans', title: 'תיקי תכניות', purpose: 'מסמכים, חילוץ ואישור נתונים לכל תכנית.' },
  { to: '/tools/layers', title: 'מפה ושכבות', purpose: 'המפה המלאה: רובעים, מתחמים, מוסדות חינוך וצביעה לפי התקדמות.' },
  { to: '/tools/check/new', title: 'בדיקת תכנית מול כללי המדיניות', purpose: 'בודקת תכנית מול כללי מסמך המדיניות וסף האוכלוסייה במתחם.' },
  { to: '/targets', title: 'יעדים ומצב קיים', purpose: 'עריכת יעדי תכנית המתאר והמצב הקיים לכל מתחם ותחום.' },
  { to: '/documents', title: 'מסמכים', purpose: 'ספריית מסמכים מכל סוג, עם שם ותאריך.' },
  { to: '/rules', title: 'כללים', purpose: 'רשימת כללי המדיניות שהמנוע בודק, עם מקור וודאות.' },
  { to: '/register', title: 'מרשם מדיניות', purpose: 'רשימת מסמכי המדיניות והתכניות שהכלי נשען עליהם.' },
  { to: `/report/${new Date().getFullYear()}`, title: 'דוח 6.2', purpose: 'דוח שנתי לפי סעיף 6.2 בתכנית המתאר.' },
  { to: '/district/2', title: 'דף מתחם', purpose: 'סיכום מתחם: סף אוכלוסייה, מאזן ותכניות. נפתח מכל מתחם במפה.' },
];

export default function ToolsPage() {
  return (
    <Page kicker="כלים נוספים" title="כל הדפים הקודמים">
      <p className="lead">המסלול הראשי הוא חמישה דפים: בית, מפה, דף תכנית, הוספת תכנית והשוואה ליעד. כל השאר כאן, ולא נמחק.</p>
      <ul className="tools-list" data-testid="tools-list">
        {TOOLS.map((t) => <li key={t.to} className="card"><Link to={t.to}><b>{t.title}</b></Link><span>{t.purpose ?? 'מטרה לא מוגדרת'}</span></li>)}
      </ul>
      <div className="ls">כפתורי "העתקת קישור", "שיחת הפיתוח", "פרויקט המחקר", התקנה וחשבון נמצאים בכפתור "מערכת" בסרגל העליון.</div>
      <NextStep to="/" label="לדף הבית" />
    </Page>
  );
}
