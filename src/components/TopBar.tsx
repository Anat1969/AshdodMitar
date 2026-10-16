import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import { LINKS } from '../lib/supabase';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export default function TopBar() {
  const { session, role, googleEnabled, emailEnabled, signInGoogle, sendLink, signOut } = useAuth();
  const loc = useLocation();
  const [copied, setCopied] = useState(false);
  const [install, setInstall] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstall(e as BIPEvent); };
    const done = () => { setInstall(null); setInstalled(true); };
    window.addEventListener('beforeinstallprompt', h);
    window.addEventListener('appinstalled', done);
    if (window.matchMedia?.('(display-mode: standalone)').matches) setInstalled(true);
    return () => { window.removeEventListener('beforeinstallprompt', h); window.removeEventListener('appinstalled', done); };
  }, []);
  useEffect(() => { setOpen(false); }, [loc.pathname]);

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
            <NavLink to="/documents">מסמכים</NavLink>
            <NavLink to="/rules">כללים</NavLink>
            <NavLink to="/register">מרשם מדיניות</NavLink>
            <NavLink to={`/report/${new Date().getFullYear()}`}>דוח 6.2</NavLink>
          </nav>
          <div className="tb-actions">
            <button type="button" className={`btn small sys-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="sys-panel">
              מערכת{roleLabel ? <span className="sys-role">{roleLabel}</span> : null}
            </button>
          </div>
        </div>
      </header>
      <AnimatePresence>
        {open && (
          <motion.div id="sys-panel" className="drawer sys-panel" role="dialog" aria-label="מערכת" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="drawer-body">
              <section className="sys-group">
                <h3 className="sys-h">שיתוף ופיתוח</h3>
                <div className="sys-grid">
                  <button type="button" className="btn" onClick={copy}>{copied ? 'הקישור הועתק' : 'העתקת קישור'}</button>
                  <a className="btn" href={LINKS.devChat} target="_blank" rel="noreferrer">שיחת הפיתוח</a>
                  <a className="btn" href={LINKS.research} target="_blank" rel="noreferrer">פרויקט המחקר</a>
                  {install
                    ? <button type="button" className="btn primary" onClick={async () => { await install.prompt(); setInstall(null); }}>התקנת האפליקציה</button>
                    : <button type="button" className="btn" disabled title={installed ? 'האפליקציה מותקנת' : 'Chrome יציע התקנה כשהדף עומד בתנאים'}>{installed ? 'האפליקציה מותקנת' : 'התקנת האפליקציה'}</button>}
                </div>
                <div className="ls">העתקת קישור שומרת גם את המצב: מתחם, שכבות, צביעה ורקע.</div>
              </section>

              <section className="sys-group">
                <h3 className="sys-h">חשבון</h3>
                {session ? (
                  <>
                    <div className="mono">{session.user.email}</div>
                    <div>{role ? `הרשאה: ${roleLabel}` : 'החשבון אינו רשום בצוות (mt_members). אפשר לצפות במפה, בכללים ובמרשם. תכניות, מסמכים והחלטות פתוחים לחברי צוות בלבד.'}</div>
                    <div className="row-actions"><button type="button" className="btn" onClick={async () => { await signOut(); setOpen(false); }}>יציאה</button></div>
                  </>
                ) : (
                  <>
                    <p>המפה, הכללים ומרשם המדיניות פתוחים לצפייה. תכניות, מסמכים, בדיקות שמורות והחלטות פתוחים לחברי הצוות בלבד.</p>
                    {googleEnabled ? (
                      <button type="button" className="btn primary" onClick={signInGoogle}>כניסה עם Google</button>
                    ) : (
                      <div className="notice">כניסה עם Google עדיין לא הופעלה בפרויקט ה-Supabase של האפליקציה.</div>
                    )}
                    {emailEnabled !== false && (
                      <form className="row-actions sys-login" onSubmit={async (e) => { e.preventDefault(); setMsg('שולח'); const err = await sendLink(email); setMsg(err ? `שגיאה: ${err}` : 'נשלח קישור כניסה לתיבת הדואר'); }}>
                        <input className="input" type="email" required dir="ltr" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="כתובת דואר" />
                        <button type="submit" className="btn primary">שליחת קישור כניסה</button>
                      </form>
                    )}
                    {msg && <div className="notice">{msg}</div>}
                  </>
                )}
              </section>
              <div className="row-actions"><button type="button" className="btn ghost" onClick={() => setOpen(false)}>סגירה</button></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
