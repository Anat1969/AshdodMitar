import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../lib/auth';
import { LINKS } from '../lib/supabase';

interface MenuElement extends HTMLElement {
  items: { label: string; hint?: string; onSelect: () => unknown }[];
  status: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'ai-menu': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { chat?: string; research?: string };
    }
  }
}

export default function TopBar() {
  const { session, role, ready, googleEnabled, emailEnabled, signInGoogle, sendLink, signInWithPastedLink, signOut, justSignedIn, dismissSignedIn } = useAuth();
  const [pasted, setPasted] = useState('');
  const [pasteMsg, setPasteMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const loc = useLocation();
  const menuRef = useRef<MenuElement>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { if (!justSignedIn) return; const t = setTimeout(dismissSignedIn, 9000); return () => clearTimeout(t); }, [justSignedIn, dismissSignedIn]);

  const roleLabel = role === 'admin' ? 'מנהלת' : role === 'editor' ? 'עורך' : role === 'viewer' ? 'צופה' : session ? 'לא חבר צוות' : null;

  // A&I logo button (https://appofapp-gh.vercel.app/ai-menu.js): copy link, dev chat, research and install come from it;
  // the account actions are its items, and the account drawer below opens from there.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    el.items = session
      ? [
          { label: 'חשבון', hint: roleLabel ?? undefined, onSelect: () => setOpen(true) },
          { label: 'יציאה', onSelect: async () => { await signOut(); setOpen(false); } },
        ]
      : [{ label: 'כניסה לחשבון', hint: 'קישור במייל', onSelect: () => setOpen(true) }];
    el.status = roleLabel ?? '';
  }, [session, roleLabel, signOut]);

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
            <NavLink to="/" end>בית</NavLink>
            <NavLink to="/map">מפה</NavLink>
            <NavLink to="/add">הוספת תכנית</NavLink>
            <NavLink to="/compare">השוואה ליעד</NavLink>
            <NavLink to="/tools" className={({ isActive }) => (isActive || /^\/(tools|about|overview|ledger|plans|targets|district|documents|rules|register|report)/.test(loc.pathname) ? 'active' : '')}>כלים נוספים</NavLink>
          </nav>
          <div className="tb-actions">
            <ai-menu ref={menuRef} chat={LINKS.devChat} research={LINKS.research} />
          </div>
        </div>
      </header>
      <AnimatePresence>
        {justSignedIn && session && ready && (
          <motion.div className={`signed-banner ${role ? '' : 'warn'}`} role="status" data-testid="signed-banner" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            <span>{role ? 'מחוברת' : 'מחוברת, אבל החשבון לא רשום בצוות'}</span>
            <span className="mono" dir="ltr">{session.user.email}</span>
            {role && <span className="chip st-pass">הרשאה: {roleLabel}</span>}
            <button type="button" className="btn small ghost" onClick={dismissSignedIn}>סגירה</button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div id="sys-panel" className="drawer sys-panel" role="dialog" aria-label="חשבון" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <div className="drawer-body">
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
                      <form className="row-actions sys-login" onSubmit={async (e) => { e.preventDefault(); setMsg('שולח'); const err = await sendLink(email); setSent(!err); setMsg(err ? `שגיאה: ${err}` : 'נשלח קישור כניסה לתיבת הדואר'); }}>
                        <input className="input" type="email" required dir="ltr" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="כתובת דואר" />
                        <button type="submit" className="btn primary">שליחת קישור כניסה</button>
                      </form>
                    )}
                    {msg && <div className="notice">{msg}</div>}
                    <form className={`paste-login ${sent ? 'lit' : ''}`} onSubmit={async (e) => {
                      e.preventDefault(); setPasteMsg('מתחבר');
                      const err = await signInWithPastedLink(pasted);
                      setPasteMsg(err); if (!err) { setPasted(''); setOpen(false); }
                    }}>
                      <label htmlFor="paste-link"><b>הדבקת הקישור מהמייל</b></label>
                      <div className="ls">במייל מ-Supabase: לחיצה ימנית על Log In, "העתקת כתובת הקישור", והדבקה כאן. אם כבר לחצת והגעת לדף שלא נפתח, אפשר להעתיק את הכתובת של אותו דף ולהדביק אותה כאן.</div>
                      <input id="paste-link" className="input" dir="ltr" placeholder="https://…" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="קישור הכניסה מהמייל" />
                      <div className="row-actions"><button type="submit" className="btn primary" disabled={!pasted.trim()}>כניסה עם הקישור</button></div>
                      {pasteMsg && <div className="notice" role="status">{pasteMsg}</div>}
                    </form>
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
