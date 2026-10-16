import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || 'https://cbhexpybdggwzyakgagd.supabase.co';
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string) || 'sb_publishable_1KSwG6rqTzBSHmI2RxX6Fw_EEcuKzk3';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const LINKS = {
  devChat: 'https://claude.ai/code/session_01PiW2cPeXSPYYL3BM4dL76Q',
  // Assumption: no direct link was supplied for the research project; points to the Claude projects list.
  research: 'https://claude.ai/projects',
};
