// Plan data for the simple flow: find a plan by its number, its map layers, facts and source files.
import { supabase } from './supabase';
import type { Plan } from './data';
import type { Quantity } from './ledger';
import type { LayerKind } from './planlayers';

export interface PlanLayerRow { id: string; plan_id: string; kind: LayerKind; geojson: GeoJSON.FeatureCollection | null; image_url: string | null; image_bounds: [number, number, number, number] | null; accuracy: 'exact' | 'approx'; source: string | null; note: string | null }

export type StatusGroup = 'approved' | 'process' | 'prep' | 'other';
export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = { approved: 'מאושרת', process: 'בהליך', prep: 'בהכנה', other: 'לא בתוקף' };
// Blue is kept for the blue line (the plan boundary) only; status is told by line style and by text
export const BLUE_LINE = '#1d4ed8';
export function statusGroup(s: Plan['status']): StatusGroup {
  if (s === 'approved') return 'approved';
  if (s === 'deposited') return 'process';
  if (s === 'pipeline' || s === 'idea') return 'prep';
  return 'other';
}

// URL key of a plan: the מבא"ת number when known, else the plan number (encoded: "תמל/2022" has a slash)
export const planKey = (p: Pick<Plan, 'mavat_number' | 'plan_number' | 'id'>) => encodeURIComponent(p.mavat_number || p.plan_number || p.id);
export const findPlan = (plans: Plan[], key: string) => {
  const k = decodeURIComponent(key).trim();
  return plans.find((p) => p.mavat_number === k || p.plan_number === k || p.id === k || (p.plan_number ?? '').replace(/\s/g, '') === k.replace(/\s/g, '')) ?? null;
};

export async function loadLayers(planId: string): Promise<PlanLayerRow[]> {
  const { data, error } = await supabase.from('mt_plan_layers').select('*').eq('plan_id', planId);
  if (error) throw new Error(error.message);
  return data as PlanLayerRow[];
}

// Facts for the data card: approved values first; a draft is shown only to members, labelled.
export interface Fact { value: number | null; status: 'approved' | 'draft' | null; q: Quantity | null }
export function fact(qs: Quantity[], planId: string, key: string, sum = false): Fact {
  const mine = qs.filter((q) => q.plan_id === planId && q.domain_key === key && q.value != null);
  const ok = mine.filter((q) => q.status === 'approved');
  const use = ok.length ? ok : mine;
  if (!use.length) return { value: null, status: null, q: null };
  return { value: sum ? use.reduce((a, q) => a + (q.value ?? 0), 0) : use[0].value, status: ok.length ? 'approved' : 'draft', q: use[0] };
}

export function bboxOfFC(fc: GeoJSON.FeatureCollection | GeoJSON.Geometry | null | undefined): [number, number, number, number] | null {
  const pts: number[][] = [];
  const walk = (c: unknown) => { if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as number[]); else if (Array.isArray(c)) c.forEach(walk); };
  if (!fc) return null;
  if ('features' in fc) fc.features.forEach((f) => f.geometry && walk((f.geometry as GeoJSON.Polygon).coordinates));
  else walk((fc as GeoJSON.Polygon).coordinates);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
