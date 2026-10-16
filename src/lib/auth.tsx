import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase';

export type Role = 'viewer' | 'editor' | 'admin' | null;
interface AuthState {
  session: Session | null; role: Role; ready: boolean; googleEnabled: boolean | null; emailEnabled: boolean | null;
  canWrite: boolean; isMember: boolean;
  signInGoogle: () => Promise<void>; sendLink: (email: string) => Promise<string | null>; signInWithPastedLink: (text: string) => Promise<string | null>; signOut: () => Promise<void>;
  justSignedIn: boolean; dismissSignedIn: () => void;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [ready, setReady] = useState(false);
  const [providers, setProviders] = useState<{ google: boolean | null; email: boolean | null }>({ google: null, email: null });

  useEffect(() => {
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json())
      .then((s) => setProviders({ google: !!s?.external?.google, email: !!s?.external?.email }))
      .catch(() => setProviders({ google: false, email: false }));
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const email = session?.user?.email;
    if (!email) { setRole(null); return; }
    supabase.from('mt_members').select('role').ilike('email', email).maybeSingle()
      .then(({ data }) => { setRole((data?.role as Role) ?? null); setReady(true); });
  }, [session]);

  const signInGoogle = useCallback(async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  }, []);
  const sendLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname, shouldCreateUser: true } });
    return error ? error.message : null;
  }, []);
  // The project's Site URL points elsewhere (localhost), so the emailed link may land on a dead page.
  // Accept either the link from the email (…/auth/v1/verify?token=…&type=…) or the address it landed on (#access_token=…).
  const signInWithPastedLink = useCallback(async (text: string) => {
    const raw = text.trim();
    if (!raw) return 'לא הודבק קישור';
    let url: URL;
    try { url = new URL(raw); } catch { return 'זה לא נראה כמו קישור. יש להדביק את הקישור המלא'; }
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    const access = hash.get('access_token') ?? url.searchParams.get('access_token');
    const refresh = hash.get('refresh_token') ?? url.searchParams.get('refresh_token');
    if (access && refresh) {
      const { error } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
      return error ? `הקישור פג תוקף או כבר נוצל. יש לשלוח קישור חדש (${error.message})` : null;
    }
    const errDesc = hash.get('error_description') ?? url.searchParams.get('error_description');
    if (errDesc) return `הקישור פג תוקף או כבר נוצל. יש לשלוח קישור חדש (${errDesc.replace(/\+/g, ' ')})`;
    const token = url.searchParams.get('token') ?? url.searchParams.get('token_hash');
    if (token) {
      const t = url.searchParams.get('type');
      const types = (t === 'signup' || t === 'invite' || t === 'magiclink' || t === 'recovery' || t === 'email_change') ? [t, 'email'] : ['magiclink', 'email'];
      let last = '';
      for (const type of types) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: type as 'magiclink' });
        if (!error) return null;
        last = error.message;
      }
      return `הקישור פג תוקף או כבר נוצל. יש לשלוח קישור חדש (${last})`;
    }
    return 'בקישור אין פרטי כניסה. יש להדביק את הקישור שבמייל, או את הכתובת שאליה הוא הוביל';
  }, []);
  const [justSignedIn, setJustSignedIn] = useState(false);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e) => { if (e === 'SIGNED_IN') setJustSignedIn(true); });
    return () => sub.subscription.unsubscribe();
  }, []);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); setRole(null); setJustSignedIn(false); }, []);

  return (
    <Ctx.Provider value={{
      session, role, ready, googleEnabled: providers.google, emailEnabled: providers.email,
      canWrite: role === 'editor' || role === 'admin', isMember: role !== null,
      signInGoogle, sendLink, signInWithPastedLink, signOut, justSignedIn, dismissSignedIn: () => setJustSignedIn(false),
    }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
