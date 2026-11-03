// "ברחוב": the plan's own layers as a first-person walk at eye height (shared <space-walk>, appofapp-gh/walk.js).
// Today = existing + buildings to demolish. Per the plan = existing (without demolished) + the proposed volumes,
// with the allowed envelope as glass. Map coordinates become metres around the blue line's centre.
import { useEffect, useMemo, useRef } from 'react';
import type { MapLayerData } from './PlanMap3D';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX { interface IntrinsicElements { 'space-walk': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> } }
}

type Pt = [number, number];
interface Item { id: string; type: string; points?: Pt[]; h?: number; y0?: number; color?: string; glass?: boolean; layer?: number; mapColor?: string; solid?: boolean }

const n1 = (v: number) => v.toLocaleString('he-IL', { maximumFractionDigits: 1 });

function rings(g: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates[0]];
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0]);
  return [];
}

export function buildStreetPlan(layers: MapLayerData[], bbox: [number, number, number, number], title: string) {
  const [w, s, e, n] = bbox;
  const lon0 = (w + e) / 2, lat0 = (s + n) / 2;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110540;
  const xy = ([lon, lat]: number[]): Pt => [+((lon - lon0) * kx).toFixed(2), +(-(lat - lat0) * kz).toFixed(2)];
  const fc = (k: string) => layers.find((l) => l.kind === k)?.geojson?.features ?? [];
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

  const blue: Item[] = fc('blue_line').flatMap((f, i) => rings(f.geometry).map((r, j) => ({ id: `blue-${i}-${j}`, type: 'prism', points: r.map(xy), h: 0.02, color: '#dbe6f3', mapColor: '#c9d9ee' })));
  const prisms = (k: string, color: string, def: number) => fc(k).flatMap((f, i) => rings(f.geometry).map((r, j) => {
    const p = f.properties ?? {};
    const base = num(p.base, 0);
    const top = num(p.top ?? p.height, def);
    return { id: `${k}-${i}-${j}`, type: 'prism', points: r.map(xy), y0: base, h: Math.max(0.5, top - base), color, kind: String(p.kind ?? '') } as Item & { kind: string };
  }));
  const existing = prisms('existing', '#c3c7cc', 9);
  const demolish = prisms('demolish', '#c2554d', 9);
  const proposedAll = prisms('proposed', '#ece8df', 30);
  const envelope = proposedAll.filter((p) => p.kind === 'envelope').map((p) => ({ ...p, glass: true, solid: false, color: '#9fb4c2' }));
  const volumes = proposedAll.filter((p) => p.kind !== 'envelope').map((p) => ({ ...p, color: p.kind === 'podium' ? '#c9c1b3' : '#ece8df' }));

  const pts = [...blue, ...existing, ...demolish, ...proposedAll].flatMap((it) => it.points ?? []);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const minX = Math.min(...xs, -60), maxX = Math.max(...xs, 60), minZ = Math.min(...zs, -60), maxZ = Math.max(...zs, 60);
  const top = (list: Item[]) => list.reduce((m, it) => Math.max(m, (it.y0 ?? 0) + (it.h ?? 0)), 0);
  const today = top([...existing, ...demolish]), planned = top([...existing, ...volumes]);
  // start on the street just south of the buildings' centre, looking north at them
  const bp = [...existing, ...demolish, ...volumes].flatMap((it) => it.points ?? []);
  const cx = bp.length ? bp.reduce((a, p) => a + p[0], 0) / bp.length : (minX + maxX) / 2;
  const cz = bp.length ? bp.reduce((a, p) => a + p[1], 0) / bp.length : (minZ + maxZ) / 2;
  const southOfAll = bp.length ? Math.max(...bp.filter((p) => Math.abs(p[0] - cx) < 40).map((p) => p[1]), cz) : maxZ;
  const spawn = { x: +cx.toFixed(1), z: +(southOfAll + 18).toFixed(1), yaw: 0 };

  return {
    id: 'street-' + title,
    title,
    bounds: [minX - 40, minZ - 40, maxX + 40, maxZ + 40],
    ground: '#dcd8ce',
    speed: 6,
    spawn,
    heights: [{ cm: 160, label: 'מבוגר עומד' }, { cm: 95, label: 'ילד בן 3' }],
    rule: 'גבהים מהשכבות של התכנית: מבנה בלי גובה נרשם **9 מ\'** (קיים) או **30 מ\'** (מוצע), כמו במפת התלת-ממד. **הנחה**, לא מדידה. מעטפת מותרת בזכוכית: קווי הבניין כפול הגובה המרבי.',
    source: 'כלי תומך החלטה. אינו מחליף הוראות דין, תכנית תקפה או שיקול דעת מוסד התכנון.',
    items: blue,
    variants: [
      {
        id: 'today', label: 'היום',
        note: demolish.length ? `**${demolish.length}** מבנים להריסה, באדום.` : 'אין בתכנית שכבת מבנים להריסה.',
        summary: { insight: existing.length + demolish.length ? `היום: עד **${n1(today)} מ'**` : 'היום: אין שכבת מבנים', explain: `**${existing.length + demolish.length}** מבנים בשכבות הקיים וההריסה.` },
        items: [...existing, ...demolish],
      },
      {
        id: 'plan', label: 'לפי התכנית', tone: 'solution',
        note: `**${volumes.length}** נפחים מוצעים${envelope.length ? `, ו-**${envelope.length}** מעטפות מותרות בזכוכית` : ''}.`,
        summary: { insight: `לפי התכנית: עד **${n1(planned)} מ'**`, explain: today > 0 ? `פי **${n1(planned / today)}** מהגובה המרבי היום. הנפח הוא דוגמה מתוך הזכויות, לא תכנון מפורט.` : 'הנפח הוא דוגמה מתוך הזכויות, לא תכנון מפורט.' },
        items: [...existing, ...volumes, ...envelope],
      },
    ],
  };
}

export default function StreetWalk({ layers, bbox, title }: { layers: MapLayerData[]; bbox: [number, number, number, number] | null; title: string }) {
  const ref = useRef<HTMLElement & { plan?: unknown }>(null);
  const plan = useMemo(() => (bbox ? buildStreetPlan(layers, bbox, title) : null), [layers, bbox, title]);
  useEffect(() => { if (ref.current && plan) ref.current.plan = plan; }, [plan]);
  if (!bbox) return <div className="notice">אין לתכנית קו כחול, ולכן אין נקודת מוצא להליכה.</div>;
  return <space-walk ref={ref} className="pv-walk" data-testid="street-walk" />;
}
