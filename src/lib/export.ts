// Export the ledger to Excel (.xlsx, right-to-left sheets). PDF export uses the browser print dialog ("שמירה כ-PDF").
import type { District, Plan } from './data';
import type { Domain, Ledger, Quantity } from './ledger';
import { FLAG_LABEL } from './ledger';

const v = (n: number | null | undefined) => (n == null ? 'חסר' : n);
const pct = (p: number | null) => (p == null ? 'חסר' : Math.round(p * 100) / 100);

export function ledgerRows(ledger: Ledger, domains: Domain[], districts: District[], onlyDistrict?: number) {
  const rows: Record<string, string | number>[] = [];
  for (const d of districts) {
    if (onlyDistrict != null && d.id !== onlyDistrict) continue;
    for (const dm of domains) {
      const c = ledger[d.id]?.[dm.key]; if (!c) continue;
      rows.push({
        'מתחם': d.id, 'שם המתחם': d.name, 'תחום': dm.title, 'יחידה': dm.unit,
        'יעד': v(c.target), 'מקור היעד': c.t?.target_source ?? 'חסר', 'קיים': v(c.existing), 'מקור הקיים': c.t?.existing_source ?? 'חסר', 'תאריך הקיים': c.t?.existing_date ?? 'חסר',
        'סה"כ תכניות מאושרות': c.approved, 'יתרה': v(c.remaining), 'אחוז מימוש': pct(c.progress),
        'תרחיש: תכניות בהליך': c.scenario, 'מימוש בתרחיש': pct(c.scenarioProgress),
        'סימון': c.flags.map((f) => FLAG_LABEL[f]).join(', '), 'הערכה לפי שטח': c.estimated ? 'כן' : '', 'נתונים ממתינים לאישור': c.drafts,
      });
    }
  }
  return rows;
}

export function quantityRows(qs: Quantity[], plans: Plan[], domains: Domain[], onlyDistrict?: number) {
  const pmap = new Map(plans.map((p) => [p.id, p]));
  return qs.filter((q) => onlyDistrict == null || q.district_id === onlyDistrict).map((q) => {
    const p = pmap.get(q.plan_id); const dm = domains.find((x) => x.key === q.domain_key);
    return {
      'מספר תכנית': p?.plan_number ?? '', 'שם תכנית': p?.name ?? '', 'סטטוס תכנית': p?.status ?? '', 'תאריך אישור': p?.approval_date ?? '',
      'מתחם': q.district_id ?? 'חסר', 'תחום': dm?.title ?? q.domain_key, 'כמות': v(q.value), 'יחידה': dm?.unit ?? '',
      'עמוד במקור': q.page ?? '', 'ציטוט': q.quote ?? '', 'חלוקה': q.split === 'area' ? 'לפי שטח (הערכה)' : q.split === 'table' ? 'לפי טבלת זכויות' : 'מתחם אחד',
      'סטטוס נתון': q.status === 'approved' ? 'מאושר' : 'טיוטה', 'מאשר': q.approved_by ?? '', 'מקור הנתון': q.origin === 'ai' ? 'חילוץ אוטומטי' : 'הזנה ידנית',
    };
  });
}

export async function downloadXlsx(filename: string, sheets: { name: string; rows: Record<string, string | number>[] }[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ 'אין נתונים': '' }]), s.name.slice(0, 31));
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
