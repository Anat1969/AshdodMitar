import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './supabase';

export type Role = 'viewer' | 'editor' | 'admin' | null;
interface AuthState {
  session: Session | null; role: Role; ready: boolean; googleEnabled: boolean | null; emailEnabled: boolean | null;
  canWrite: boolean; isMember: boolean;
  signInGoogle: () => Promise<void>; sendLink: (email: string) => Promise<string | null>; signOut: () => Promise<void>;
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
  const signOut = useCallback(async () => { await supabase.auth.signOut(); setRole(null); }, []);

  return (
    <Ctx.Provider value={{
      session, role, ready, googleEnabled: providers.google, emailEnabled: providers.email,
      canWrite: role === 'editor' || role === 'admin', isMember: role !== null,
      signInGoogle, sendLink, signOut,
    }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
