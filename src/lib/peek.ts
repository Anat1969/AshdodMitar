// The in-page panel's state lives in the URL (?peek=plan:<key> | district:<id>), so "העתקת קישור" shares it.
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type PeekKind = 'plan' | 'district';

export function usePeek() {
  const [sp, setSp] = useSearchParams();
  const open = useCallback((kind: PeekKind, key: string | number) => { const n = new URLSearchParams(sp); n.set('peek', `${kind}:${key}`); setSp(n, { replace: true }); }, [sp, setSp]);
  const close = useCallback(() => { const n = new URLSearchParams(sp); n.delete('peek'); setSp(n, { replace: true }); }, [sp, setSp]);
  const raw = sp.get('peek') ?? '';
  const i = raw.indexOf(':');
  return { open, close, kind: (i > 0 ? raw.slice(0, i) : null) as PeekKind | null, key: i > 0 ? raw.slice(i + 1) : '' };
}

// share of a value in a whole, as text: "12.5%"
export const shareText = (v: number, whole: number | null | undefined) => (whole && whole > 0 ? `${Math.round((v / whole) * 1000) / 10}%` : null);
