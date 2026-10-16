// Port of reference/rules-engine.mjs. data/test_expected.json must match exactly (tests/rules.test.ts).
export type Status = 'pass' | 'fail' | 'warn' | 'info' | 'missing';
export type Certainty = 'statutory' | 'plan-draft' | 'policy-draft' | 'assumption' | 'missing';

export interface RuleResult {
  id: string;
  title: string;
  status: Status;
  values: Record<string, unknown>;
  message: string;
  source: string;
  certainty: Certainty;
}

export interface Mix { small: number; medium: number; rest: number; restAvgArea: number }
export interface Yard { green: number; hard: number; roofs: number; schoolyards: number }

export interface PlanInput {
  id?: string;
  name?: string;
  districtId?: number | null;
  status: 'idea' | 'pipeline' | 'deposited' | 'approved' | 'rejected';
  sector: 'general' | 'haredi';
  fabric: 'existing' | 'new';
  isRenewal: boolean;
  unitsAdded: number;
  householdOverride?: number | null;
  mix?: Mix | null;
  addedAboveGroundArea?: number | null;
  publicBuiltArea?: number | null;
  intensive?: boolean;
  yard?: Yard | null;
  distanceToMassTransit?: number | null;
  lotArea?: number | null;
  percolationArea?: number | null;
  effectiveGreenArea?: number | null;
  greenRoofArea?: number | null;
  far?: number | null;
  rahakRow?: number | null;
}

export type RahakRow = [string, string, number | string, number | string];
export interface DistrictInput {
  id: number;
  name?: string;
  target_pop: number | null;
  existing_pop: number | null;
  rahak: RahakRow[];
}

export const PARAMS = {
  household: { general_existing: 3.3, general_new: 3.5, haredi: 5.5 },
  cohortShare: { general_existing: 0.02, general_new: 0.022, haredi: 0.03 },
  classSize: 30, // ASSUMPTION: not in source documents. City must set.
  elementaryGrades: 6,
  dunamPerClass: { C: { general: 0.3, haredi_boys: 0.2 }, B: { general: 0.5, haredi_boys: 0.25 } },
  publicBenefitShare: 0.055,
  thresholdYard: { residential: 3.0, intensive: 2.0 },
  thresholdYardMinUnits: 100,
  hardInfraCap: 0.2,
  roofsCapOfComplementary: 0.3,
  schoolyardsCapOfComplementary: 0.2,
  minContinuousArea: 300,
  parkingZoneA: 300,
  parkingZoneB: 600,
  percolationMin: 0.15,
  effectiveGreenMin: 0.2,
  greenRoofCredit: 0.05,
  mix: { smallMax: 55, smallShare: 0.2, mediumMax: 80, mediumShare: 0.1, restAvg: 125 },
  highRise: { maxUnitsPerFloor: 6, maxUnitsPerFloorPodium: 8, minNonHighRiseShare: 0.25 },
  renewalShareTarget: 1 / 3,
  cityTargetPop: 350000,
} as const;

const SRC = {
  policy2: 'מסמך מדיניות עירונית תכנונית, טיוטה 09/2026, פרק 2 דמוגרפיה',
  policy4: 'מסמך מדיניות, פרק 4 מדיניות בינוי ומגורים',
  policy7: 'מסמך מדיניות, פרק 7 מרחב ציבורי, סף-בית',
  policy6: 'מסמך מדיניות, פרק 6 תחבורה; תקנות התו"ב (התקנת מקומות חניה)',
  policyEdu: 'מסמך מדיניות, פרק 7 מוסדות חינוך (טיפוס C/B)',
  benefit: 'מסמך מדיניות מנגנון תועלות ציבוריות (05/2024, עדכון 07/2025)',
  plan61: 'תכנית 603-0528026, סעיף 6.1',
  plan63: 'תכנית 603-0528026, סעיף 6.3',
  plan415: 'תכנית 603-0528026, סעיף 4.1.5 ופרק 4.3 (טבלת רח"ק למתחם)',
};

type PopKey = 'general_existing' | 'general_new' | 'haredi';
function popKey(p: PlanInput): PopKey {
  if (p.sector === 'haredi') return 'haredi';
  return p.fabric === 'new' ? 'general_new' : 'general_existing';
}

export function population(p: PlanInput): RuleResult {
  const k = popKey(p);
  const hh = p.householdOverride ?? PARAMS.household[k];
  const pop = p.unitsAdded * hh;
  return {
    id: 'R02', title: 'אוכלוסייה נגזרת', status: 'info',
    values: { householdSize: hh, population: Math.round(pop) },
    message: `${p.unitsAdded} יח"ד כפול ${hh} = ${Math.round(pop)} תושבים`,
    source: SRC.policy2, certainty: 'policy-draft',
  };
}

export function education(p: PlanInput): RuleResult {
  const k = popKey(p);
  const pop = population(p).values.population as number;
  const perCohort = pop * PARAMS.cohortShare[k];
  const classes = Math.ceil((perCohort * PARAMS.elementaryGrades) / PARAMS.classSize);
  const type = p.fabric === 'new' ? 'B' : 'C';
  const perClass = p.sector === 'haredi' ? PARAMS.dunamPerClass[type].haredi_boys : PARAMS.dunamPerClass[type].general;
  return {
    id: 'R03', title: 'ביקוש לחינוך יסודי', status: 'info',
    values: {
      pupilsPerCohort: +perCohort.toFixed(1), elementaryClasses: classes, schoolType: type,
      dunamPerClass: perClass, dunamRequired: +(classes * perClass).toFixed(2), classSizeAssumed: PARAMS.classSize,
    },
    message: `${perCohort.toFixed(1)} ילדים בשנתון, כ-${classes} כיתות יסודי, ${(classes * perClass).toFixed(2)} דונם (טיפוס ${type})`,
    source: SRC.policy2 + '; ' + SRC.policyEdu, certainty: 'assumption',
  };
}

export function unitMix(p: PlanInput): RuleResult {
  if (!p.mix) return { id: 'R01', title: 'תמהיל יח"ד', status: 'missing', values: {}, message: 'לא הוזן תמהיל', source: SRC.policy4, certainty: 'policy-draft' };
  const { small, medium, rest, restAvgArea } = p.mix;
  const total = small + medium + rest;
  const s = small / total;
  const m = medium / total;
  const ok = s >= PARAMS.mix.smallShare && m >= PARAMS.mix.mediumShare && restAvgArea <= PARAMS.mix.restAvg;
  return {
    id: 'R01', title: 'תמהיל יח"ד', status: ok ? 'pass' : 'fail',
    values: { smallShare: +s.toFixed(3), mediumShare: +m.toFixed(3), restAvgArea },
    message: `קטנות ${(s * 100).toFixed(1)}% (נדרש 20%), עד 80 מ"ר ${(m * 100).toFixed(1)}% (נדרש 10%), ממוצע יתרה ${restAvgArea} מ"ר (עד 125)`,
    source: SRC.policy4, certainty: 'policy-draft',
  };
}

export function publicBenefit(p: PlanInput): RuleResult {
  if (!p.isRenewal) return { id: 'R04', title: 'תועלות ציבוריות 5.5%', status: 'info', values: {}, message: 'חל על תכניות התחדשות עירונית בלבד', source: SRC.benefit, certainty: 'policy-draft' };
  const req = (p.addedAboveGroundArea as number) * PARAMS.publicBenefitShare;
  const given = p.publicBuiltArea ?? 0;
  return {
    id: 'R04', title: 'תועלות ציבוריות 5.5%', status: given >= req ? 'pass' : 'fail',
    values: { required: Math.round(req), provided: given },
    message: `נדרש ${Math.round(req)} מ"ר שימושים ציבוריים, הוקצו ${given}`,
    source: SRC.benefit, certainty: 'policy-draft',
  };
}

export function thresholdYard(p: PlanInput): RuleResult {
  if (p.unitsAdded < PARAMS.thresholdYardMinUnits) return { id: 'R05', title: 'סף-בית', status: 'info', values: {}, message: 'פחות מ-100 יח"ד: הסעיף אינו חל', source: SRC.policy7, certainty: 'policy-draft' };
  const pop = population(p).values.population as number;
  const rate = p.intensive ? PARAMS.thresholdYard.intensive : PARAMS.thresholdYard.residential;
  const required = pop * rate;
  const y = p.yard ?? { green: 0, hard: 0, roofs: 0, schoolyards: 0 };
  const hardCounted = Math.min(y.hard, required * PARAMS.hardInfraCap);
  const complementary = y.roofs + y.schoolyards;
  const roofsCounted = Math.min(y.roofs, complementary * PARAMS.roofsCapOfComplementary);
  const schoolCounted = Math.min(y.schoolyards, complementary * PARAMS.schoolyardsCapOfComplementary);
  const counted = y.green + hardCounted + roofsCounted + schoolCounted;
  const warn: string[] = [];
  if (p.intensive && y.green < pop * PARAMS.thresholdYard.intensive) warn.push('תשתית ירוקה מתחת למינימום 2 מ"ר לנפש');
  return {
    id: 'R05', title: 'סף-בית', status: counted >= required && warn.length === 0 ? 'pass' : 'fail',
    values: { requiredM2: Math.round(required), countedM2: Math.round(counted), hardCounted: Math.round(hardCounted), roofsCounted: Math.round(roofsCounted) },
    message: `נדרש ${Math.round(required)} מ"ר (${rate} לנפש), נספר ${Math.round(counted)}${warn.length ? '. ' + warn.join('. ') : ''}`,
    source: SRC.policy7, certainty: 'policy-draft',
  };
}

export function parkingZone(p: PlanInput): RuleResult {
  const d = p.distanceToMassTransit;
  if (d == null) return { id: 'R06', title: 'אזור חניה', status: 'missing', values: {}, message: 'לא הוזן מרחק מציר מתע"ן', source: SRC.policy6, certainty: 'statutory' };
  const zone = d <= PARAMS.parkingZoneA ? 'א' : d <= PARAMS.parkingZoneB ? 'ב' : 'ג';
  return {
    id: 'R06', title: 'אזור חניה', status: 'info', values: { zone, distance: d, nationalStandardRelief: d <= 300 },
    message: `אזור ${zone}${d <= 300 ? ': זכאות להקלה מתקן עירוני לתקן ארצי' : ''}`, source: SRC.policy6, certainty: 'statutory',
  };
}

export function landscape(p: PlanInput): RuleResult {
  if (p.lotArea == null) return { id: 'R07', title: 'חלחול ושטח מגונן', status: 'missing', values: {}, message: 'לא הוזן שטח מגרש', source: SRC.policy4, certainty: 'policy-draft' };
  const perc = (p.percolationArea ?? 0) / p.lotArea;
  const roofCredit = Math.min((p.greenRoofArea ?? 0) / p.lotArea, PARAMS.greenRoofCredit);
  const green = (p.effectiveGreenArea ?? 0) / p.lotArea + roofCredit;
  const ok = perc >= PARAMS.percolationMin && green >= PARAMS.effectiveGreenMin;
  return {
    id: 'R07', title: 'חלחול ושטח מגונן', status: ok ? 'pass' : 'fail', values: { percolationShare: +perc.toFixed(3), effectiveGreenShare: +green.toFixed(3) },
    message: `חלחול ${(perc * 100).toFixed(1)}% (נדרש 15%), מגונן אפקטיבי ${(green * 100).toFixed(1)}% (נדרש 20%, עד 5% מגגות)`, source: SRC.policy4, certainty: 'policy-draft',
  };
}

export function rahak(p: PlanInput, district?: DistrictInput | null): RuleResult {
  if (!district || p.far == null || p.rahakRow == null) return { id: 'R11', title: 'רח"ק מול טבלת המתחם', status: 'missing', values: {}, message: 'חסר רח"ק מוצע או שורת ייעוד', source: SRC.plan415, certainty: 'plan-draft' };
  const row = district.rahak[p.rahakRow];
  if (!row) return { id: 'R11', title: 'רח"ק מול טבלת המתחם', status: 'missing', values: {}, message: 'שורת הייעוד אינה קיימת בטבלת המתחם', source: SRC.plan415, certainty: 'plan-draft' };
  const [, , base, max] = row;
  if (typeof base !== 'number') return { id: 'R11', title: 'רח"ק', status: 'warn', values: {}, message: 'רח"ק לפי תכנית מאושרת: בדיקה ידנית', source: SRC.plan415, certainty: 'plan-draft' };
  const maxN = max as number;
  const status: Status = p.far <= base ? 'pass' : p.far <= maxN ? 'warn' : 'fail';
  return {
    id: 'R11', title: 'רח"ק מול טבלת המתחם', status, values: { proposed: p.far, base, max },
    message: status === 'pass' ? `בתוך רח"ק הבסיס ${base}` : status === 'warn' ? `מעל הבסיס ${base}, עד המרבי ${max}: מותנה בתנאי 4.1.5 (הקצאה לציבור, תרומה למרחב, שיקול דעת)` : `חורג מהרח"ק המרבי ${max}`,
    source: SRC.plan415, certainty: 'plan-draft',
  };
}

export function districtGate(district: DistrictInput, plans: PlanInput[]): RuleResult {
  const sum = (f: (p: PlanInput) => number) => plans.reduce((a, p) => a + f(p), 0);
  const existing = district.existing_pop ?? 0;
  const approved = sum((p) => (p.status === 'approved' ? (population(p).values.population as number) : 0));
  const pipeline = sum((p) => (p.status !== 'approved' && p.status !== 'rejected' ? (population(p).values.population as number) : 0));
  const projected = existing + approved + pipeline;
  const ratio = district.target_pop ? projected / district.target_pop : null;
  const r = ratio as number;
  return {
    id: 'G63', title: 'סף יעד אוכלוסייה למתחם',
    status: district.existing_pop == null ? 'missing' : r > 1 ? 'fail' : r > 0.9 ? 'warn' : 'pass',
    values: { existing, approved, pipeline, projected, target: district.target_pop, ratio: ratio && +ratio.toFixed(3) },
    message: district.existing_pop == null
      ? 'חסרה אוכלוסייה קיימת למתחם: לא ניתן לחשב סף'
      : `צפי ${projected} מול יעד ${district.target_pop} (${(r * 100).toFixed(0)}%)${r > 1 ? ': חציית סף, נדרשת החלטת ועדה מקומית על בסיס בחינת תשתיות' : ''}`,
    source: SRC.plan63, certainty: 'plan-draft',
  };
}

export function renewalBalance(plans: PlanInput[]): RuleResult {
  const added = plans.filter((p) => p.status !== 'rejected');
  const total = added.reduce((a, p) => a + p.unitsAdded, 0);
  const renewal = added.filter((p) => p.isRenewal).reduce((a, p) => a + p.unitsAdded, 0);
  const share = total ? renewal / total : 0;
  return {
    id: 'G61', title: 'חלק ההתחדשות בתוספת', status: Math.abs(share - PARAMS.renewalShareTarget) <= 0.05 ? 'pass' : 'warn',
    values: { renewalUnits: renewal, totalUnits: total, share: +share.toFixed(3), target: 0.333 },
    message: `${(share * 100).toFixed(0)}% מהתוספת בהתחדשות (יעד כשליש)`, source: SRC.plan61, certainty: 'plan-draft',
  };
}

export function checkPlan(p: PlanInput, district?: DistrictInput | null): RuleResult[] {
  return [unitMix(p), population(p), education(p), publicBenefit(p), thresholdYard(p), parkingZone(p), landscape(p), rahak(p, district)];
}

export const STATUS_LABEL: Record<Status, string> = { pass: 'עומד', fail: 'לא עומד', warn: 'מותנה', info: 'נגזר', missing: 'חסר' };
export const CERTAINTY_LABEL: Record<string, string> = {
  statutory: 'חוק / תקנה', 'plan-draft': 'תכנית בהכנה', 'policy-draft': 'מדיניות טיוטה', assumption: 'הנחת עבודה', missing: 'חסר', osm: 'OpenStreetMap', municipal: 'GIS עירוני',
};
