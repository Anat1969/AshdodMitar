// mt-extract: reads an uploaded plan document with the Claude API and writes draft quantities.
// Nothing written here counts until a member approves it in the app (status 'draft').
// Needs the project secret ANTHROPIC_API_KEY. GET returns { ready } so the app can say whether extraction is available.
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import * as XLSX from 'npm:xlsx@0.18.5';

const MODEL = 'claude-opus-5-5';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const nullable = (t: string) => ({ anyOf: [{ type: t }, { type: 'null' }] });
function schema(domainKeys: string[]) {
  return {
    type: 'object', additionalProperties: false,
    required: ['plan', 'quantities', 'missing'],
    properties: {
      plan: {
        type: 'object', additionalProperties: false,
        required: ['number', 'name', 'approval_date', 'status_hint', 'area_dunam'],
        properties: {
          number: nullable('string'), name: nullable('string'),
          approval_date: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
          status_hint: { anyOf: [{ type: 'string', enum: ['approved', 'deposited', 'pipeline'] }, { type: 'null' }] },
          area_dunam: nullable('number'),
        },
      },
      quantities: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['domain_key', 'value', 'district', 'page', 'quote', 'basis', 'note'],
          properties: {
            domain_key: { type: 'string', enum: domainKeys },
            value: { type: 'number' },
            district: nullable('string'),
            page: nullable('integer'),
            quote: { type: 'string' },
            basis: { type: 'string', enum: ['net_added', 'total_proposed'] },
            note: nullable('string'),
          },
        },
      },
      missing: { type: 'array', items: { type: 'string' } },
    },
  };
}

function b64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (req.method === 'GET') return json({ ready: !!key, model: MODEL });
  if (!key) return json({ error: 'missing_key' }, 503);

  const auth = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: role } = await sb.rpc('mt_role');
  if (role !== 'editor' && role !== 'admin') return json({ error: 'forbidden' }, 403);
  const { data: user } = await sb.auth.getUser();

  const { plan_id, doc_id } = await req.json().catch(() => ({}));
  if (!plan_id || !doc_id) return json({ error: 'plan_id and doc_id required' }, 400);
  const [{ data: doc }, { data: plan }, { data: domains }, { data: districts }] = await Promise.all([
    sb.from('mt_documents').select('*').eq('id', doc_id).single(),
    sb.from('mt_plans').select('id,plan_number,name').eq('id', plan_id).single(),
    sb.from('mt_domains').select('key,title,unit').order('sort'),
    sb.from('mt_districts').select('id,name'),
  ]);
  if (!doc || !plan) return json({ error: 'not_found' }, 404);

  const { data: ex, error: exErr } = await sb.from('mt_extractions')
    .insert({ plan_id, doc_id, status: 'running', model: MODEL, created_by: user.user?.email ?? null }).select('id').single();
  if (exErr) return json({ error: exErr.message }, 500);

  const work = async () => {
    try {
      const file = await sb.storage.from('mt-documents').download(doc.file_path);
      if (file.error) throw new Error(file.error.message);
      const buf = await file.data.arrayBuffer();
      const name = (doc.file_name ?? '').toLowerCase();
      const mime = doc.mime ?? '';
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (mime === 'application/pdf' || name.endsWith('.pdf')) {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(buf) }, title: doc.name });
      } else if (/\.(xlsx|xls|ods)$/.test(name) || mime.includes('spreadsheet') || mime.includes('excel')) {
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const text = wb.SheetNames.map((s) => `### גיליון ${s}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[s])).join('\n\n');
        content.push({ type: 'text', text: `תוכן גיליון אלקטרוני "${doc.name}" (CSV לכל גיליון; אין מספרי עמודים, page=null):\n${text}` });
      } else if (/^image\/(png|jpeg|webp|gif)$/.test(mime)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: mime as 'image/png', data: b64(buf) } });
      } else if (mime.startsWith('text/') || /\.(csv|txt|md)$/.test(name)) {
        content.push({ type: 'text', text: `תוכן הקובץ "${doc.name}":\n${new TextDecoder().decode(buf)}` });
      } else {
        throw new Error('סוג קובץ שאינו נתמך לחילוץ: PDF, Excel, CSV, טקסט או תמונה');
      }
      const domainList = (domains ?? []).map((d) => `- ${d.key}: ${d.title} (${d.unit})`).join('\n');
      const districtList = (districts ?? []).map((d) => `- ${d.id}: ${d.name}`).join('\n');
      content.push({ type: 'text', text: `זהו מסמך של תכנית מפורטת באשדוד: ${plan.plan_number ?? ''} ${plan.name}.
חלץ את הכמויות שהתכנית מוסיפה, לפי התחומים האלה בלבד:
${domainList}

מתחמי תכנית המתאר 603-0528026:
${districtList}

כללים:
- value הוא מספר ביחידה של התחום. המר דונם למ"ר (כפול 1000) כשהיחידה מ"ר.
- basis=net_added כשהמסמך מראה תוספת נטו (מוצע פחות קיים), או כשאפשר לחשב אותה מהמסמך. אחרת total_proposed.
- כשטבלת הזכויות מפרטת לפי מתחם או רובע, החזר שורה לכל מתחם, ובשדה district את שם המתחם או מספרו. אחרת district=null.
- page הוא מספר העמוד במסמך שבו מופיע המספר. quote הוא ציטוט קצר מהמקור, עד 20 מילים.
- אל תמציא מספר. מה שלא מופיע במסמך נכנס ל-missing כתיאור קצר.
- מבני ציבור: שטח בנוי לצרכי ציבור במ"ר. גנים ושצ"פ: שטח ציבורי פתוח במ"ר. כבישים: אורך במטרים אם מופיע.
- חינוך יסודי וגני ילדים: מספר כיתות, רק אם המסמך קובע אותו.
- בפרטי התכנית: מספר, שם, תאריך אישור (פרסום למתן תוקף) אם מופיע, סטטוס ושטח בדונם.` });

      const client = new Anthropic({ apiKey: key });
      const stream = client.beta.messages.stream({
        model: MODEL, max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: schema((domains ?? []).map((d) => d.key)) } },
        messages: [{ role: 'user', content }],
      } as unknown as Anthropic.Beta.MessageCreateParamsStreaming);
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') throw new Error('המודל סירב לקרוא את המסמך');
      if (msg.stop_reason === 'max_tokens') throw new Error('התשובה נקטעה: המסמך ארוך מדי');
      const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
      const out = JSON.parse(text);

      const resolve = (s: string | null) => {
        if (!s) return null;
        const n = Number(String(s).match(/\d+/)?.[0]);
        const byName = (districts ?? []).find((d) => d.name === s || s.includes(d.name) || d.name.includes(s));
        if (byName) return byName.id;
        return (districts ?? []).some((d) => d.id === n) ? n : null;
      };
      const rows = (out.quantities ?? []).map((q: Record<string, unknown>) => ({
        plan_id, doc_id, extraction_id: ex.id, domain_key: q.domain_key, value: q.value,
        district_id: resolve(q.district as string | null), page: q.page, quote: q.quote,
        split: q.district ? 'table' : 'single', status: 'draft', origin: 'ai',
        note: [q.basis === 'total_proposed' ? 'סה"כ מוצע, לא תוספת נטו: לבדוק' : null, q.note].filter(Boolean).join('. ') || null,
        created_by: user.user?.email ?? null,
      }));
      if (rows.length) { const ins = await sb.from('mt_plan_quantities').insert(rows); if (ins.error) throw new Error(ins.error.message); }
      await sb.from('mt_extractions').update({ status: 'done', result: { ...out, usage: msg.usage, served_by: msg.model }, finished_at: new Date().toISOString() }).eq('id', ex.id);
    } catch (e) {
      await sb.from('mt_extractions').update({ status: 'error', error: String((e as Error).message ?? e), finished_at: new Date().toISOString() }).eq('id', ex.id);
    }
  };
  // long documents take minutes: answer now, finish in the background; the app polls mt_extractions
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work()); else await work();
  return json({ extraction_id: ex.id, status: 'running' }, 202);
});
