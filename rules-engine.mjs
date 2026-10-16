// Reference implementation of the policy rules (test oracle).
// Claude Code should port this to src/lib/rules.ts and keep tests/rules.test passing.
// Every rule returns: { id, title, status: 'pass'|'fail'|'warn'|'info'|'missing', values, message, source, certainty }
// certainty: 'plan-draft' (603-0528026, not in force) | 'policy-draft' (policy doc, Sept 2026 draft)
//            | 'statutory' (national law/regulation) | 'assumption' (needs city decision)

export const PARAMS = {
  household: { general_existing: 3.3, general_new: 3.5, haredi: 5.5 },        // policy doc ch.2
  cohortShare: { general_existing: 0.020, general_new: 0.022, haredi: 0.030 }, // policy doc ch.2
  classSize: 30,            // ASSUMPTION: not in source documents. City must set.
  elementaryGrades: 6,      // grades 1-6
  dunamPerClass: {          // policy doc, education: type C (existing fabric) / type B (new)
    C: { general: 0.3, haredi_boys: 0.2 },
    B: { general: 0.5, haredi_boys: 0.25 },
  },
  publicBenefitShare: 0.055,               // policy doc: 5.5% of added above-ground area (main+service)
  thresholdYard: { residential: 3.0, intensive: 2.0 }, // m2/person, policy doc ch.7
  thresholdYardMinUnits: 100,
  hardInfraCap: 0.20,                      // of total threshold-yard
  roofsCapOfComplementary: 0.30,
  schoolyardsCapOfComplementary: 0.20,
  minContinuousArea: 300,                  // m2
  parkingZoneA: 300, parkingZoneB: 600,    // meters to mass transit axis
  percolationMin: 0.15, effectiveGreenMin: 0.20, greenRoofCredit: 0.05,
  mix: { smallMax: 55, smallShare: 0.20, mediumMax: 80, mediumShare: 0.10, restAvg: 125 },
  highRise: { maxUnitsPerFloor: 6, maxUnitsPerFloorPodium: 8, minNonHighRiseShare: 0.25 },
  renewalShareTarget: 1 / 3,
  cityTargetPop: 350000,
};

const SRC = {
  policy2: 'מסמך מדיניות עירונית תכנונית, טיוטה 09/2026, פרק 2 דמוגרפיה',
  policy4: 'מסמך מדיניות, פרק 4 מדיניות בינוי ומגורים',
  policy7: 'מסמך מדיניות, פרק 7 מרחב ציבורי, סף-בית',
  policy6: 'מסמך מדיניות, פרק 6 תחבורה; תקנות התו"ב (התקנת מקומות חניה)',
  policyEdu: 'מסמך מדיניות, פרק 7 מוסדות חינוך (טיפוס C/B)',
  plan61: 'תכנית 603-0528026, סעיף 6.1',
  plan63: 'תכנית 603-0528026, סעיף 6.3',
  plan415: 'תכנית 603-0528026, סעיף 4.1.5 ופרק 4.3 (טבלת רח"ק למתחם)',
};

function popKey(p) {
  if (p.sector === 'haredi') return 'haredi';
  return p.fabric === 'new' ? 'general_new' : 'general_existing';
}

export function population(p) {
  const k = popKey(p);
  const hh = p.householdOverride ?? PARAMS.household[k];
  const pop = p.unitsAdded * hh;
  return { id: 'R02', title: 'אוכלוסייה נגזרת', status: 'info',
    values: { householdSize: hh, population: Math.round(pop) },
    message: `${p.unitsAdded} יח"ד כפול ${hh} = ${Math.round(pop)} תושבים`,
    source: SRC.policy2, certainty: 'policy-draft' };
}

export function education(p) {
  const k = popKey(p);
  const pop = population(p).values.population;
  const perCohort = pop * PARAMS.cohortShare[k];
  const classes = Math.ceil((perCohort * PARAMS.elementaryGrades) / PARAMS.classSize);
  const type = p.fabric === 'new' ? 'B' : 'C';
  const perClass = p.sector === 'haredi' ? PARAMS.dunamPerClass[type].haredi_boys : PARAMS.dunamPerClass[type].general;
  return { id: 'R03', title: 'ביקוש לחינוך יסודי', status: 'info',
    values: { pupilsPerCohort: +perCohort.toFixed(1), elementaryClasses: classes, schoolType: type, dunamPerClass: perClass, dunamRequired: +(classes * perClass).toFixed(2), classSizeAssumed: PARAMS.classSize },
    message: `${perCohort.toFixed(1)} ילדים בשנתון, כ-${classes} כיתות יסודי, ${(classes * perClass).toFixed(2)} דונם (טיפוס ${type})`,
    source: SRC.policy2 + '; ' + SRC.policyEdu, certainty: 'assumption' };
}

export function unitMix(p) {
  if (!p.mix) return { id: 'R01', title: 'תמהיל יח"ד', status: 'missing', values: {}, message: 'לא הוזן תמהיל', source: SRC.policy4, certainty: 'policy-draft' };
  const { small, medium, rest, restAvgArea } = p.mix;
  const total = small + medium + rest;
  const s = small / total, m = medium / total;
  const ok = s >= PARAMS.mix.smallShare && m >= PARAMS.mix.mediumShare && restAvgArea <= PARAMS.mix.restAvg;
  return { id: 'R01', title: 'תמהיל יח"ד', status: ok ? 'pass' : 'fail',
    values: { smallShare: +s.toFixed(3), mediumShare: +m.toFixed(3), restAvgArea },
    message: `קטנות ${(s * 100).toFixed(1)}% (נדרש 20%), עד 80 מ"ר ${(m * 100).toFixed(1)}% (נדרש 10%), ממוצע יתרה ${restAvgArea} מ"ר (עד 125)`,
    source: SRC.policy4, certainty: 'policy-draft' };
}

export function publicBenefit(p) {
  if (!p.isRenewal) return { id: 'R04', title: 'תועלות ציבוריות 5.5%', status: 'info', values: {}, message: 'חל על תכניות התחדשות עירונית בלבד', source: 'מסמך מדיניות מנגנון תועלות ציבוריות (05/2024, עדכון 07/2025)', certainty: 'policy-draft' };
  const req = p.addedAboveGroundArea * PARAMS.publicBenefitShare;
  const given = p.publicBuiltArea ?? 0;
  return { id: 'R04', title: 'תועלות ציבוריות 5.5%', status: given >= req ? 'pass' : 'fail',
    values: { required: Math.round(req), provided: given },
    message: `נדרש ${Math.round(req)} מ"ר שימושים ציבוריים, הוקצו ${given}`,
    source: 'מסמך מדיניות מנגנון תועלות ציבוריות (05/2024, עדכון 07/2025)', certainty: 'policy-draft' };
}

export function thresholdYard(p) {
  if (p.unitsAdded < PARAMS.thresholdYardMinUnits) return { id: 'R05', title: 'סף-בית', status: 'info', values: {}, message: 'פחות מ-100 יח"ד: הסעיף אינו חל', source: SRC.policy7, certainty: 'policy-draft' };
  const pop = population(p).values.population;
  const rate = p.intensive ? PARAMS.thresholdYard.intensive : PARAMS.thresholdYard.residential;
  const required = pop * rate;
  const y = p.yard ?? { green: 0, hard: 0, roofs: 0, schoolyards: 0 };
  const hardCounted = Math.min(y.hard, required * PARAMS.hardInfraCap);
  const complementary = y.roofs + y.schoolyards;
  const roofsCounted = Math.min(y.roofs, complementary * PARAMS.roofsCapOfComplementary);
  const schoolCounted = Math.min(y.schoolyards, complementary * PARAMS.schoolyardsCapOfComplementary);
  const counted = y.green + hardCounted + roofsCounted + schoolCounted;
  const warn = [];
  if (p.intensive && y.green < pop * PARAMS.thresholdYard.intensive) warn.push('תשתית ירוקה מתחת למינימום 2 מ"ר לנפש');
  return { id: 'R05', title: 'סף-בית', status: counted >= required && warn.length === 0 ? 'pass' : 'fail',
    values: { requiredM2: Math.round(required), countedM2: Math.round(counted), hardCounted: Math.round(hardCounted), roofsCounted: Math.round(roofsCounted) },
    message: `נדרש ${Math.round(required)} מ"ר (${rate} לנפש), נספר ${Math.round(counted)}${warn.length ? '. ' + warn.join('. ') : ''}`,
    source: SRC.policy7, certainty: 'policy-draft' };
}

export function parkingZone(p) {
  const d = p.distanceToMassTransit;
  if (d == null) return { id: 'R06', title: 'אזור חניה', status: 'missing', values: {}, message: 'לא הוזן מרחק מציר מתע"ן', source: SRC.policy6, certainty: 'statutory' };
  const zone = d <= PARAMS.parkingZoneA ? 'א' : d <= PARAMS.parkingZoneB ? 'ב' : 'ג';
  return { id: 'R06', title: 'אזור חניה', status: 'info', values: { zone, distance: d, nationalStandardRelief: d <= 300 },
    message: `אזור ${zone}${d <= 300 ? ': זכאות להקלה מתקן עירוני לתקן ארצי' : ''}`, source: SRC.policy6, certainty: 'statutory' };
}

export function landscape(p) {
  if (p.lotArea == null) return { id: 'R07', title: 'חלחול ושטח מגונן', status: 'missing', values: {}, message: 'לא הוזן שטח מגרש', source: SRC.policy4, certainty: 'policy-draft' };
  const perc = (p.percolationArea ?? 0) / p.lotArea;
  const roofCredit = Math.min((p.greenRoofArea ?? 0) / p.lotArea, PARAMS.greenRoofCredit);
  const green = (p.effectiveGreenArea ?? 0) / p.lotArea + roofCredit;
  const ok = perc >= PARAMS.percolationMin && green >= PARAMS.effectiveGreenMin;
  return { id: 'R07', title: 'חלחול ושטח מגונן', status: ok ? 'pass' : 'fail', values: { percolationShare: +perc.toFixed(3), effectiveGreenShare: +green.toFixed(3) },
    message: `חלחול ${(perc * 100).toFixed(1)}% (נדרש 15%), מגונן אפקטיבי ${(green * 100).toFixed(1)}% (נדרש 20%, עד 5% מגגות)`, source: SRC.policy4, certainty: 'policy-draft' };
}

export function rahak(p, district) {
  if (!district || p.far == null || p.rahakRow == null) return { id: 'R11', title: 'רח"ק מול טבלת המתחם', status: 'missing', values: {}, message: 'חסר רח"ק מוצע או שורת ייעוד', source: SRC.plan415, certainty: 'plan-draft' };
  const row = district.rahak[p.rahakRow];
  const [, , base, max] = row;
  if (typeof base !== 'number') return { id: 'R11', title: 'רח"ק', status: 'warn', values: {}, message: 'רח"ק לפי תכנית מאושרת: בדיקה ידנית', source: SRC.plan415, certainty: 'plan-draft' };
  const status = p.far <= base ? 'pass' : p.far <= max ? 'warn' : 'fail';
  return { id: 'R11', title: 'רח"ק מול טבלת המתחם', status, values: { proposed: p.far, base, max },
    message: status === 'pass' ? `בתוך רח"ק הבסיס ${base}` : status === 'warn' ? `מעל הבסיס ${base}, עד המרבי ${max}: מותנה בתנאי 4.1.5 (הקצאה לציבור, תרומה למרחב, שיקול דעת)` : `חורג מהרח"ק המרבי ${max}`,
    source: SRC.plan415, certainty: 'plan-draft' };
}

// District-level gate (clause 6.3) and renewal balance (clause 6.1)
export function districtGate(district, plans) {
  const sum = (f) => plans.reduce((a, p) => a + f(p), 0);
  const existing = district.existing_pop ?? 0;
  const approved = sum((p) => (p.status === 'approved' ? population(p).values.population : 0));
  const pipeline = sum((p) => (p.status !== 'approved' && p.status !== 'rejected' ? population(p).values.population : 0));
  const projected = existing + approved + pipeline;
  const ratio = district.target_pop ? projected / district.target_pop : null;
  return { id: 'G63', title: 'סף יעד אוכלוסייה למתחם', status: district.existing_pop == null ? 'missing' : ratio > 1 ? 'fail' : ratio > 0.9 ? 'warn' : 'pass',
    values: { existing, approved, pipeline, projected, target: district.target_pop, ratio: ratio && +ratio.toFixed(3) },
    message: district.existing_pop == null ? 'חסרה אוכלוסייה קיימת למתחם: לא ניתן לחשב סף' : `צפי ${projected} מול יעד ${district.target_pop} (${(ratio * 100).toFixed(0)}%)${ratio > 1 ? ': חציית סף, נדרשת החלטת ועדה מקומית על בסיס בחינת תשתיות' : ''}`,
    source: SRC.plan63, certainty: 'plan-draft' };
}

export function renewalBalance(plans) {
  const added = plans.filter((p) => p.status !== 'rejected');
  const total = added.reduce((a, p) => a + p.unitsAdded, 0);
  const renewal = added.filter((p) => p.isRenewal).reduce((a, p) => a + p.unitsAdded, 0);
  const share = total ? renewal / total : 0;
  return { id: 'G61', title: 'חלק ההתחדשות בתוספת', status: Math.abs(share - PARAMS.renewalShareTarget) <= 0.05 ? 'pass' : 'warn',
    values: { renewalUnits: renewal, totalUnits: total, share: +share.toFixed(3), target: 0.333 },
    message: `${(share * 100).toFixed(0)}% מהתוספת בהתחדשות (יעד כשליש)`, source: SRC.plan61, certainty: 'plan-draft' };
}

export function checkPlan(p, district) {
  return [unitMix(p), population(p), education(p), publicBenefit(p), thresholdYard(p), parkingZone(p), landscape(p), rahak(p, district)];
}
