// Topics model: for every topic, per district, what exists, what is planned, the target and the gap.
// And per plan: a bill of quantities (כתב כמויות) comparing what the plan provides with what it generates.
// Pure functions. Never invent a value: unknown => null, rendered as "חסר".
import { education, PARAMS, population, publicBenefit, thresholdYard, type Certainty, type PlanInput } from './rules';

export type TopicKey = 'housing' | 'education' | 'kinder' | 'openspace' | 'public' | 'commerce' | 'employment' | 'roads';

export interface TopicDef { key: TopicKey; title: string; unit: string; targetRule: string; targetCertainty: Certainty }
export const TOPICS: TopicDef[] = [
  { key: 'housing', title: 'יחידות דיור', unit: 'יח"ד', targetRule: 'תוספת יח"ד למתחם לפי טבלאות פרק 4.3', targetCertainty: 'plan-draft' },
  { key: 'education', title: 'חינוך יסודי', unit: 'כיתות', targetRule: 'יעד אוכלוסייה כפול שיעור שנתון כפול 6 שכבות חלקי 30 תלמידים בכיתה', targetCertainty: 'assumption' },
  { key: 'kinder', title: 'גני ילדים', unit: 'כיתות גן', targetRule: 'יעד אוכלוסייה כפול שיעור שנתון כפול 3 שנתונים (גילאי 3 עד 5) חלקי 30 ילדים בגן', targetCertainty: 'assumption' },
  { key: 'openspace', title: 'גנים ושצ"פ', unit: 'מ"ר', targetRule: 'סף-בית: 3 מ"ר לנפש כפול יעד האוכלוסייה', targetCertainty: 'policy-draft' },
  { key: 'public', title: 'מבני ציבור', unit: 'מ"ר', targetRule: 'חסר: פרוגרמה לצרכי ציבור עדכנית', targetCertainty: 'missing' },
  { key: 'commerce', title: 'מסחר', unit: 'מ"ר', targetRule: 'חסר: התכנית קובעת תעסוקה ותיירות, לא מסחר בנפרד', targetCertainty: 'missing' },
  { key: 'employment', title: 'משרדים ותעסוקה', unit: 'מ"ר', targetRule: 'שטחי תעסוקה למתחם לפי טבלאות פרק 4.3', targetCertainty: 'plan-draft' },
  { key: 'roads', title: 'כבישים', unit: 'מ"א', targetRule: 'חסר: נספח תנועה', targetCertainty: 'missing' },
];

export interface Program {
  classrooms?: number | null; kindergartens?: number | null; education_dunam?: number | null; open_space_m2?: number | null;
  commerce_m2?: number | null; office_m2?: number | null; roads_m?: number | null;
}
export interface PlanForTopics extends PlanInput { program?: Program | null; districtId?: number | null; publicBuiltArea?: number | null }
export interface DistrictForTopics { id: number; target_pop: number | null; units_added: number | null; employment_m2: number | null; sector_hint?: 'haredi' | 'general' }
export interface ExistingRow { topic: string; subtype: string | null; district_id: number | null; qty: { classes?: number | null; ages?: string | null } }

export interface TopicCell {
  existing: number | null; planned: number; approved: number; target: number | null;
  gap: number | null; progress: number | null; certainty: Certainty; existingSource: string | null;
}

const KINDER_GRADES = 3; // ASSUMPTION: ages 3-5
const KINDER_SIZE = 30;  // ASSUMPTION

function cohortShare(sector?: 'haredi' | 'general') { return sector === 'haredi' ? PARAMS.cohortShare.haredi : PARAMS.cohortShare.general_existing; }

export function targetFor(topic: TopicKey, d: DistrictForTopics): number | null {
  const pop = d.target_pop;
  switch (topic) {
    case 'housing': return d.units_added ?? null;
    case 'education': return pop ? Math.ceil((pop * cohortShare(d.sector_hint) * PARAMS.elementaryGrades) / PARAMS.classSize) : null;
    case 'kinder': return pop ? Math.ceil((pop * cohortShare(d.sector_hint) * KINDER_GRADES) / KINDER_SIZE) : null;
    case 'openspace': return pop ? Math.round(pop * PARAMS.thresholdYard.residential) : null;
    case 'employment': return d.employment_m2 ?? null;
    default: return null;
  }
}

export function plannedFor(topic: TopicKey, p: PlanForTopics): number {
  const g = p.program ?? {};
  switch (topic) {
    case 'housing': return p.unitsAdded ?? 0;
    case 'education': return g.classrooms ?? 0;
    case 'kinder': return g.kindergartens ?? 0;
    case 'openspace': return g.open_space_m2 ?? 0;
    case 'public': return p.publicBuiltArea ?? 0;
    case 'commerce': return g.commerce_m2 ?? 0;
    case 'employment': return g.office_m2 ?? 0;
    case 'roads': return g.roads_m ?? 0;
  }
}

export function existingFor(topic: TopicKey, districtId: number, rows: ExistingRow[]): { value: number | null; source: string | null } {
  if (topic === 'education') {
    const s = rows.filter((r) => r.topic === 'education' && r.district_id === districtId && r.subtype === 'בית ספר' && (r.qty.ages == null || r.qty.ages === 'יסודי'));
    if (!s.length) return { value: null, source: null };
    return { value: s.reduce((a, r) => a + (r.qty.classes ?? 0), 0), source: 'מוסדות חינוך, GIS עירוני' };
  }
  if (topic === 'kinder') {
    const s = rows.filter((r) => r.topic === 'education' && r.district_id === districtId && (r.subtype === 'גן ילדים' || r.subtype === 'גן ילדים פרטי'));
    if (!s.length) return { value: null, source: null };
    return { value: s.length, source: 'גני ילדים, GIS עירוני (גן אחד = כיתת גן אחת)' };
  }
  return { value: null, source: null };
}

export function topicCell(topic: TopicKey, d: DistrictForTopics, plans: PlanForTopics[], existing: ExistingRow[]): TopicCell {
  const mine = plans.filter((p) => p.districtId === d.id && p.status !== 'rejected');
  const planned = mine.reduce((a, p) => a + plannedFor(topic, p), 0);
  const approved = mine.filter((p) => p.status === 'approved').reduce((a, p) => a + plannedFor(topic, p), 0);
  const ex = existingFor(topic, d.id, existing);
  const target = targetFor(topic, d);
  const def = TOPICS.find((t) => t.key === topic)!;
  // housing target is the planned addition, so existing stock is not part of the balance
  const supply = topic === 'housing' ? planned : (ex.value ?? 0) + planned;
  const gap = target == null ? null : Math.max(0, target - supply);
  const progress = target ? Math.min(9.99, supply / target) : null;
  return { existing: ex.value, planned, approved, target, gap, progress: progress == null ? null : +progress.toFixed(3), certainty: def.targetCertainty, existingSource: ex.source };
}

// ---------- Bill of quantities for one plan ----------
export type BoqStatus = 'pass' | 'fail' | 'info' | 'missing';
export interface BoqRow { key: string; title: string; unit: string; provided: number | null; required: number | null; balance: number | null; status: BoqStatus; basis: string; certainty: Certainty }

export function billOfQuantities(p: PlanForTopics): BoqRow[] {
  const g = p.program ?? {};
  const pop = population(p).values.population as number;
  const edu = education(p).values as { elementaryClasses: number; dunamRequired: number };
  const share = p.sector === 'haredi' ? PARAMS.cohortShare.haredi : p.fabric === 'new' ? PARAMS.cohortShare.general_new : PARAMS.cohortShare.general_existing;
  const kinderReq = Math.ceil((pop * share * KINDER_GRADES) / KINDER_SIZE);
  const ty = thresholdYard(p);
  const pb = publicBenefit(p);
  const row = (key: string, title: string, unit: string, provided: number | null | undefined, required: number | null, basis: string, certainty: Certainty): BoqRow => {
    const prov = provided ?? null;
    if (required == null) return { key, title, unit, provided: prov, required: null, balance: null, status: prov == null ? 'missing' : 'info', basis, certainty };
    if (prov == null) return { key, title, unit, provided: null, required, balance: null, status: 'missing', basis, certainty };
    return { key, title, unit, provided: prov, required, balance: +(prov - required).toFixed(2), status: prov >= required ? 'pass' : 'fail', basis, certainty };
  };
  return [
    row('units', 'יחידות דיור', 'יח"ד', p.unitsAdded, null, `נגזרים ${pop} תושבים (R02)`, 'policy-draft'),
    row('classrooms', 'כיתות יסודי', 'כיתות', g.classrooms, edu.elementaryClasses, 'R03, גודל כיתה 30 (הנחת עבודה)', 'assumption'),
    row('kinder', 'כיתות גן', 'כיתות', g.kindergartens, kinderReq, '3 שנתונים, 30 ילדים בגן (הנחת עבודה)', 'assumption'),
    row('edu_land', 'קרקע לחינוך', 'דונם', g.education_dunam, edu.dunamRequired, 'R03, דונם לכיתה לפי טיפוס', 'assumption'),
    // R05 counts the detailed yard breakdown (step 3); when it is empty, the program's open-space total is used instead
    row('open_space', 'שצ"פ סף-בית', 'מ"ר', ty.values.requiredM2 == null ? g.open_space_m2 : ((ty.values.countedM2 as number) > 0 ? (ty.values.countedM2 as number) : (g.open_space_m2 ?? null)), (ty.values.requiredM2 as number | undefined) ?? null, ty.values.requiredM2 == null ? 'מתחת ל-100 יח"ד: סף-בית אינו חל' : (ty.values.countedM2 as number) > 0 ? 'R05, נספר לפי כללי ההכרה' : 'R05 נדרש; מוצע לפי הפרוגרמה, לפני כללי ההכרה', 'policy-draft'),
    row('public', 'שטחי ציבור בנויים', 'מ"ר', p.publicBuiltArea, (pb.values.required as number | undefined) ?? null, p.isRenewal ? 'R04, 5.5% מתוספת השטח' : 'תועלות 5.5% חלות בהתחדשות בלבד', 'policy-draft'),
    row('commerce', 'מסחר', 'מ"ר', g.commerce_m2, null, 'חסר יעד מסחר למתחם', 'missing'),
    row('office', 'משרדים ותעסוקה', 'מ"ר', g.office_m2, null, 'יעד התעסוקה נמדד ברמת המתחם', 'plan-draft'),
    row('roads', 'כבישים', 'מ"א', g.roads_m, null, 'חסר: נספח תנועה', 'missing'),
  ];
}

export const BOQ_LABEL: Record<BoqStatus, string> = { pass: 'עונה', fail: 'חסר מענה', info: 'מידע', missing: 'חסר נתון' };
