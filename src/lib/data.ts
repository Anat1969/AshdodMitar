import { supabase } from './supabase';
import type { DistrictInput, Mix, PlanInput, RahakRow, Yard } from './rules';
import type { PlanForTopics, Program } from './topics';
import type { Domain, Quantity, Target } from './ledger';

export interface City {
  current_pop: number; current_pop_date: string; current_pop_source: string; current_units: number;
  plan_target_pop: number; plan_target_year: number; plan_capacity_pop: number; pipeline_pop: number; pipeline_pop_source: string;
  phasing: { stage: string; renewal_pop_added: number; reserves_pop_added: number; cumulative_target: number }[];
}

export interface District extends DistrictInput {
  name: string; total_area_m2: number | null; res_area_m2: number | null; units_added: number | null; units_total: number | null;
  employment_m2: number | null; tourism_m2: number | null; notes: string | null; source: string | null; page: number | null;
  quarters: string[]; geom: GeoJSON.Geometry | null; existing_pop_source: string | null; rahak: RahakRow[]; mapped_area_m2: number | null; label_pt: GeoJSON.Point | null;
}

export interface Plan {
  id: string; plan_number: string | null; name: string; district_id: number | null; status: PlanInput['status'];
  sector: 'general' | 'haredi'; fabric: 'existing' | 'new'; is_renewal: boolean; units_added: number;
  mix: Mix | null; added_above_ground_m2: number | null; public_built_m2: number | null; intensive: boolean; yard: Yard | null;
  distance_mass_transit_m: number | null; lot_area_m2: number | null; percolation_m2: number | null; effective_green_m2: number | null;
  green_roof_m2: number | null; far: number | null; rahak_row: number | null; location: GeoJSON.Point | null;
  is_example: boolean; note: string | null; data_certainty: string; updated_at?: string; program: Program | null;
  approval_date: string | null; boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon | null; boundary_source: string | null; area_m2: number | null;
  lots?: GeoJSON.FeatureCollection | null; mavat_number?: string | null; quarter?: string | null; mavat_url?: string | null; deposit_date?: string | null; source?: string | null; status_note?: string | null;
}

export interface Rule { id: string; title: string; formula: string; source: string; certainty: string; scope: string; version: number; active: boolean }
export interface PolicyDoc { id: number; name: string; type: string | null; owner: string | null; plan_number: string | null; status: string | null; date: string | null; certainty: string | null; gap_note: string | null }
export interface MapFeature { id: string; layer: string; name: string; props: Record<string, unknown>; geom: GeoJSON.Geometry; source: string; certainty: string }
export interface Decision { id: string; plan_id: string; forum: string | null; decision: string; rationale: string | null; deviations: unknown; decided_at: string | null; created_at: string }

export interface Existing { id: string; topic: string; subtype: string | null; name: string | null; qty: { classes?: number | null; students?: number | null; ages?: string | null; stream?: string | null }; geom: GeoJSON.Point; district_id: number | null; quarter_id: string | null; source: string; certainty: string }
export interface PublicData { city: City | null; districts: District[]; features: MapFeature[]; rules: Rule[]; register: PolicyDoc[]; existing: Existing[]; domains: Domain[]; targets: Target[] }

async function must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export async function loadPublic(): Promise<PublicData> {
  const [city, districts, features, rules, register, existing, domains, targets] = await Promise.all([
    must<{ data: City }[]>(supabase.from('mt_city').select('data').eq('id', 1)),
    must<District[]>(supabase.from('mt_districts').select('*').order('id')),
    must<MapFeature[]>(supabase.from('mt_map_features').select('*').in('layer', ['city', 'quarters_official'])),
    must<Rule[]>(supabase.from('mt_rules').select('*').order('id')),
    must<PolicyDoc[]>(supabase.from('mt_policy_register').select('*').order('id')),
    must<Existing[]>(supabase.from('mt_existing').select('id,topic,subtype,name,qty,geom,district_id,quarter_id,source,certainty')),
    must<Domain[]>(supabase.from('mt_domains').select('*').order('sort')),
    must<Target[]>(supabase.from('mt_targets').select('*')),
  ]);
  return { city: city[0]?.data ?? null, districts, features, rules, register, existing, domains, targets };
}

export async function loadPlans(): Promise<Plan[]> {
  return must<Plan[]>(supabase.from('mt_plans').select('*').order('updated_at', { ascending: false }));
}

export async function loadQuantities(): Promise<Quantity[]> {
  return must<Quantity[]>(supabase.from('mt_plan_quantities').select('*').order('created_at'));
}

export async function loadDecisions(): Promise<Decision[]> {
  return must<Decision[]>(supabase.from('mt_decisions').select('*').order('created_at', { ascending: false }));
}

export function toInput(p: Plan): PlanForTopics {
  return {
    program: p.program ?? {},
    id: p.id, name: p.name, districtId: p.district_id, status: p.status, sector: p.sector, fabric: p.fabric,
    isRenewal: p.is_renewal, unitsAdded: p.units_added, mix: p.mix, addedAboveGroundArea: p.added_above_ground_m2,
    publicBuiltArea: p.public_built_m2, intensive: p.intensive, yard: p.yard, distanceToMassTransit: p.distance_mass_transit_m,
    lotArea: p.lot_area_m2, percolationArea: p.percolation_m2, effectiveGreenArea: p.effective_green_m2, greenRoofArea: p.green_roof_m2,
    far: p.far, rahakRow: p.rahak_row,
  };
}

export const PLAN_STATUS_LABEL: Record<Plan['status'], string> = {
  idea: 'רעיון', pipeline: 'בצנרת', deposited: 'הופקדה', approved: 'אושרה', rejected: 'נדחתה',
};

export const fmt = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? 'חסר' : n.toLocaleString('he-IL', { maximumFractionDigits: digits });
