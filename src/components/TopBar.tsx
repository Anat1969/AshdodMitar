import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import { LINKS } from '../lib/supabase';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function TopBar() {
  const { session, role, googleEnabled, emailEnabled, signInGoogle, sendLink, signOut } = useAuth();
  const [copied, setCopied] = useState(false);
  const [install, setInstall] = useState<BIPEvent | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstall(e as BIPEvent); };
    window.addEventListener('beforeinstallprompt', h);
    window.addEventListener('appinstalled', () => setInstall(null));
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); } catch { /* clipboard blocked */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const roleLabel = role === 'admin' ? 'מנהלת' : role === 'editor' ? 'עורך' : role === 'viewer' ? 'צופה' : session ? 'לא חבר צוות' : null;

  return (
    <>
      <header className="topbar">
        <div className="tb-inner">
          <Link to="/" className="brand" aria-label="דף הבית">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">תאום מתאר אשדוד</span>
            <span className="brand-sub mono">603-0528026</span>
          </Link>
          <nav className="tb-nav" aria-label="ניווט ראשי">
            <NavLink to="/map">מפה ושכבות</NavLink>
            <NavLink to="/plan/new">בדיקת תכנית</NavLink>
            <NavLink to="/rules">כללים</NavLink>
            <NavLink to="/register">מרשם מדיניות</NavLink>
            <NavLink to={`/report/${new Date().getFullYear()}`}>דוח 6.2</NavLink>
          </nav>
          <div className="tb-actions">
            <button type="button" className="btn small" onClick={copy}>{copied ? 'הקישור הועתק' : 'העתקת קישור'}</button>
            <a className="btn small" href={LINKS.devChat} target="_blank" rel="noreferrer">שיחת הפיתוח</a>
            <a className="btn small" href={LINKS.research} target="_blank" rel="noreferrer">פרויקט המחקר</a>
            {install && <button type="button" className="btn small primary" onClick={async () => { await install.prompt(); setInstall(null); }}>התקנת האפליקציה</button>}
            <button type="button" className={`btn small ${session ? '' : 'primary'}`} onClick={() => setDrawer(!drawer)} aria-expanded={drawer}>
              {session ? roleLabel : 'כניסה'}
            </button>
          </div>
        </div>
      </header>
      <AnimatePresence>
        {drawer && (
          <motion.div className="drawer" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            {session ? (
              <div className="drawer-body">
                <div><span className="mono">{session.user.email}</span></div>
                <div>{role ? `הרשאה: ${roleLabel}` : 'החשבון אינו רשום בצוות (mt_members). אפשר לצפות במפה, בכללים ובמרשם. תכניות והחלטות פתוחות לחברי צוות בלבד.'}</div>
                <div className="row-actions">
                  <button type="button" className="btn" onClick={async () => { await signOut(); setDrawer(false); }}>יציאה</button>
                  <button type="button" className="btn ghost" onClick={() => setDrawer(false)}>סגירה</button>
                </div>
              </div>
            ) : (
              <div className="drawer-body">
                <p>המפה, הכללים ומרשם המדיניות פתוחים לצפייה. תכניות, בדיקות שמורות והחלטות פתוחות לחברי הצוות בלבד.</p>
                {googleEnabled ? (
                  <button type="button" className="btn primary" onClick={signInGoogle}>כניסה עם Google</button>
                ) : (
                  <div className="notice">כניסה עם Google עדיין לא הופעלה בפרויקט ה-Supabase של האפליקציה.</div>
                )}
                {emailEnabled !== false && (
                  <form className="row-actions" onSubmit={async (e) => { e.preventDefault(); setMsg('שולח'); const err = await sendLink(email); setMsg(err ? `שגיאה: ${err}` : 'נשלח קישור כניסה לתיבת הדואר'); }}>
                    <input className="input" type="email" required dir="ltr" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="כתובת דואר" />
                    <button type="submit" className="btn primary">שליחת קישור כניסה</button>
                  </form>
                )}
                {msg && <div className="notice">{msg}</div>}
                <button type="button" className="btn ghost" onClick={() => setDrawer(false)}>סגירה</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
