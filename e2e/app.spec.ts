import { test, expect, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')) as Record<string, unknown[]>;
const REF = 'cbhexpybdggwzyakgagd';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

const FAKE_USER = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'shtanat5@gmail.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-16T00:00:00Z' };
function fakeJwt(tag = 'ok') {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: FAKE_USER.id, email: FAKE_USER.email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, tag })}.${tag}`;
}

interface Captured { method: string; table: string; body: unknown; url: string }

async function mock(page: Page, opts: { admin: boolean; noSession?: boolean }) {
  const writes: Captured[] = [];
  const reads: string[] = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost') return route.continue();
    if (url.hostname.endsWith('supabase.co')) {
      if (url.pathname.startsWith('/storage/v1/')) {
        writes.push({ method: req.method(), table: 'storage:' + url.pathname.replace('/storage/v1/', ''), body: req.method() === 'DELETE' ? req.postDataJSON() : null, url: req.url() });
        if (url.pathname.includes('/object/sign/')) return route.fulfill({ json: { signedURL: '/object/sign/mt-documents/x?token=t' } });
        if (req.method() === 'DELETE') return route.fulfill({ json: [] });
        return route.fulfill({ json: { Key: url.pathname, Id: 'obj' } });
      }
      if (url.pathname.startsWith('/functions/v1/mt-extract')) {
        if (req.method() === 'GET') return route.fulfill({ json: { ready: true, model: 'claude-opus-5-5' } });
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, body: '' });
        writes.push({ method: req.method(), table: 'fn:mt-extract', body: req.postDataJSON(), url: req.url() });
        return route.fulfill({ status: 202, json: { extraction_id: 'ex-2', status: 'running' } });
      }
      if (url.pathname === '/rest/v1/rpc/mt_area_split') {
        writes.push({ method: 'POST', table: 'rpc:mt_area_split', body: req.postDataJSON(), url: req.url() });
        return route.fulfill({ json: { area_m2: 50000, parts: [{ district_id: 2, area_m2: 30000 }, { district_id: 3, area_m2: 20000 }] } });
      }
      if (url.pathname === '/auth/v1/settings') return route.fulfill({ json: { external: { google: false, email: true } } });
      if (url.pathname.startsWith('/auth/v1/otp')) { writes.push({ method: 'POST', table: 'auth/otp', body: req.postDataJSON(), url: req.url() }); return route.fulfill({ json: {} }); }
      if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
      if (url.pathname === '/auth/v1/user') {
        const auth = req.headers()['authorization'] ?? '';
        if (auth.includes('expired')) return route.fulfill({ status: 401, json: { msg: 'invalid JWT' } });
        return route.fulfill({ json: FAKE_USER });
      }
      if (url.pathname === '/auth/v1/verify') {
        writes.push({ method: 'POST', table: 'auth/verify', body: req.postDataJSON(), url: req.url() });
        const body = req.postDataJSON() as { token_hash?: string };
        if (body.token_hash === 'used') return route.fulfill({ status: 403, json: { error_code: 'otp_expired', msg: 'Email link is invalid or has expired' } });
        return route.fulfill({ json: { access_token: fakeJwt(), refresh_token: 'r2', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: FAKE_USER } });
      }
      const m = url.pathname.match(/\/rest\/v1\/(\w+)/);
      if (m) {
        const table = m[1];
        if (req.method() === 'GET') {
          reads.push(table);
          let rows = (FX[table] ?? []) as unknown[];
          if (!opts.admin && ['mt_plans', 'mt_decisions', 'mt_members', 'mt_checks', 'mt_snapshots', 'mt_documents', 'mt_plan_quantities', 'mt_extractions'].includes(table)) rows = [];
          // simple eq filters (col=eq.value) on columns the fixture rows have
          for (const [k, val] of url.searchParams) if (val.startsWith('eq.') && rows.length && k in (rows[0] as object)) rows = rows.filter((r) => String((r as Record<string, unknown>)[k]) === val.slice(3));
          const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
          if (single) return rows[0] ? route.fulfill({ json: rows[0] }) : route.fulfill({ status: 406, json: { code: 'PGRST116', message: 'no rows' } });
          return route.fulfill({ json: rows });
        }
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, body: '' });
        writes.push({ method: req.method(), table, body: req.postDataJSON(), url: req.url() });
        const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
        return route.fulfill({ status: 201, json: single ? { id: '00000000-0000-4000-8000-00000000abcd' } : [] });
      }
      return route.fulfill({ json: {} });
    }
    if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/styles/')) {
      return route.fulfill({ json: { version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: { openmaptiles: { type: 'vector', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'] } }, layers: [{ id: 'ofm-bg', type: 'background', paint: { 'background-color': '#f2f3f0' } }, { id: 'ofm-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', layout: { 'text-field': ['get', 'name_en'] } }] } });
    }
    if (url.hostname.includes('cartocdn') || url.hostname.includes('fonts.') || url.hostname.includes('openfreemap') || url.hostname.includes('arcgisonline')) return route.abort();
    return route.abort();
  });
  if (opts.admin && !opts.noSession) {
    await page.addInitScript((ref) => {
      const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
      const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
      const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'shtanat5@gmail.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
      const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', exp })}.sig`;
      localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify({ access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: exp, user }));
    }, REF);
  }
  await page.addInitScript(() => { (window as unknown as { print: () => void }).print = () => { (window as unknown as { __printed: boolean }).__printed = true; }; });
  return { writes, reads };
}

async function noHScroll(page: Page) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw, `horizontal scroll ${r.sw} > ${r.cw}`).toBeLessThanOrEqual(r.cw + 1);
}

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (e) => errors.push(e.message));
});
test.afterEach(() => { expect(errors, errors.join('\n')).toEqual([]); });

test('anonymous: home, map layers, district card, no members data', async ({ page }) => {
  const { reads } = await mock(page, { admin: false });
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'כל תכנית היא דלתא בתאום העיר' })).toBeVisible();
  await expect(page.locator('[data-testid^="district-card-"]')).toHaveCount(9);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.map-label')).toHaveCount(9);
  await expect(page.locator('.map-label[data-district="8"]')).toBeVisible();
  await expect(page.getByTestId('city-topics').locator('tr[data-topic="education"]')).toContainText('1,');
  expect(reads).toContain('mt_districts');
  expect(reads).not.toContain('mt_plans');
  // disclaimer
  await expect(page.getByText('כלי תומך החלטה. אינו מחליף הוראות דין').first()).toBeVisible();
  // open layers panel, members-only layer locked
  await page.getByRole('button', { name: 'שכבות' }).click();
  await expect(page.locator('input[data-layer="plans"]')).toBeDisabled();
  await expect(page.locator('input[data-layer="transit"]')).toBeDisabled();
  await page.screenshot({ path: SHOTS + 'anon-home.png', fullPage: true });
  // login drawer shows Google-off message and no password field
  await expect(page.locator('.sys-btn')).toHaveText('מערכת');
  await page.locator('.sys-btn').click();
  await expect(page.locator('#sys-panel')).toBeVisible();
  await expect(page.getByText('כניסה עם Google עדיין לא הופעלה')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('map page: every layer toggle, themes, district selection, copy link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mock(page, { admin: true });
  await page.goto('/map');
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.waitForTimeout(500);
  if (!(await page.locator('.layer-panel').isVisible())) await page.getByRole('button', { name: 'שכבות' }).click();
  await expect(page.locator('.layer-panel')).toBeVisible();
  for (const key of ['city', 'quarters', 'districts', 'labels', 'existing', 'plans', 'extrude']) {
    const box = page.locator(`input[data-layer="${key}"]`);
    const before = await box.isChecked();
    await box.click();
    await expect(box).toBeChecked({ checked: !before });
    const layers = new URL(page.url()).searchParams.get('layers') ?? '';
    expect(layers.split(',').includes(key)).toBe(!before);
  }
  // restore richer view for screenshot
  for (const key of ['quarters', 'existing']) { const b = page.locator(`input[data-layer="${key}"]`); if (!(await b.isChecked())) await b.click(); }
  for (const key of ['city', 'districts', 'labels', 'plans']) { const b = page.locator(`input[data-layer="${key}"]`); if (!(await b.isChecked())) await b.click(); }
  for (const t of ['יעד אוכלוסייה', 'סף 6.3', 'התקדמות ליעד']) {
    await page.getByRole('tab', { name: t }).click();
    await expect(page.getByRole('tab', { name: t })).toHaveAttribute('aria-selected', 'true');
  }
  // background maps: overlay must survive every switch
  const srcs = () => page.evaluate(() => { try { return Object.keys((window as unknown as { __map: { getStyle: () => { sources: Record<string, unknown> } | undefined } }).__map.getStyle()?.sources ?? {}); } catch { return []; } });
  await expect.poll(srcs).toContain('openmaptiles');
  for (const [key, src] of [['sat', 'esri'], ['plain', 'carto'], ['streets', 'openmaptiles']] as const) {
    await page.locator(`button[data-base="${key}"]`).click();
    expect(new URL(page.url()).searchParams.get('base')).toBe(key);
    await expect.poll(srcs).toContain(src);
    await expect.poll(srcs).toContain('districts');
    await expect(page.locator('.map-label')).toHaveCount(9);
  }
  const labelField = await page.evaluate(() => JSON.stringify((window as unknown as { __map: { getLayoutProperty: (l: string, p: string) => unknown } }).__map.getLayoutProperty('ofm-label', 'text-field')));
  expect(labelField).toContain('name:latin');
  await page.locator('button[data-base="sat"]').click();
  await expect.poll(srcs).toContain('esri');
  await page.locator('.map-label[data-district="2"]').click();
  await expect(page.locator('.map-card h3')).toHaveText('מרכז מתחדש');
  expect(new URL(page.url()).searchParams.get('d')).toBe('2');
  await expect(page.getByTestId('topic-cell')).toContainText('חינוך יסודי');
  await expect(page.getByTestId('topic-cell')).toContainText('352');
  for (const t of ['housing', 'kinder', 'openspace', 'public', 'commerce', 'employment', 'roads', 'education']) {
    await page.getByLabel('נושא', { exact: true }).selectOption(t);
    expect(new URL(page.url()).searchParams.get('topic')).toBe(t);
    const vis = await page.evaluate(() => { const m = (window as unknown as { __map: { getLayoutProperty: (l: string, p: string) => string } }).__map; return ['ex-edu', 'ex-parks', 'ex-buildings', 'ex-roads', 'ex-shops', 'ex-public'].filter((l) => m.getLayoutProperty(l, 'visibility') === 'visible'); });
    const expected: Record<string, string[]> = { housing: ['ex-buildings'], kinder: ['ex-edu'], openspace: ['ex-parks'], public: ['ex-public'], commerce: ['ex-shops'], employment: [], roads: ['ex-roads'], education: ['ex-edu'] };
    expect(vis).toEqual(expected[t]);
  }
  await expect(page.locator('.map-label[data-district="2"]')).toContainText('חינוך יסודי');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOTS + 'map-layers.png' });
  await page.locator('.sys-btn').click();
  await page.getByRole('button', { name: 'העתקת קישור' }).click();
  await expect(page.getByRole('button', { name: 'הקישור הועתק' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('d=2');
  expect(clip).toContain('layers=');
  expect(clip).toContain('base=sat');
  await page.getByRole('link', { name: 'לדף המתחם' }).click();
  await expect(page).toHaveURL(/\/district\/2$/);
  // extrusion view
  await page.goto('/map?layers=city,districts,extrude&theme=target');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + 'map-3d.png' });
});

test('admin: top bar links, district edit, plan create + decision, rules, register, report', async ({ page }) => {
  const { writes } = await mock(page, { admin: true });
  await page.goto('/overview');
  await expect(page.locator('.sys-btn')).toContainText('מנהלת');
  await page.locator('.sys-btn').click();
  await expect(page.getByRole('button', { name: 'התקנת האפליקציה' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'העתקת קישור' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'שיחת הפיתוח' })).toHaveAttribute('href', /claude\.ai\/code\/session_/);
  await expect(page.getByRole('link', { name: 'פרויקט המחקר' })).toHaveAttribute('href', /claude\.ai/);
  await page.locator('#sys-panel').getByRole('button', { name: 'סגירה' }).click();
  await expect(page.locator('#sys-panel')).toHaveCount(0);
  // brand goes home
  await page.getByRole('link', { name: 'מפה ושכבות' }).first().click();
  await expect(page).toHaveURL(/\/map/);
  await page.getByRole('link', { name: 'דף הבית' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'קלט, חישוב ופלט' })).toBeVisible();
  await page.locator('.tb-nav').getByRole('link', { name: 'תמונת העיר' }).click();
  await expect(page).toHaveURL(/\/overview$/);

  // district
  await page.getByTestId('district-card-2').click();
  await expect(page.getByRole('heading', { name: 'מרכז מתחדש' })).toBeVisible();
  await expect(page.getByText('דוגמה: פינוי-בינוי')).toBeVisible();
  await expect(page.getByTestId('district-ledger').locator('tr[data-domain="education"]')).toContainText('208');
  await expect(page.getByTestId('district-ledger').locator('tr[data-domain="public"]')).toContainText('חסר');
  await page.getByRole('button', { name: 'עדכון אוכלוסייה קיימת' }).click();
  await page.getByLabel('אוכלוסייה קיימת').fill('70000');
  await page.getByLabel('מקור הנתון').fill('בדיקה');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_districts')).toBeTruthy();
  expect(writes.find((w) => w.table === 'mt_districts')!.body).toMatchObject({ existing_pop: 70000, existing_pop_source: 'בדיקה' });
  await page.screenshot({ path: SHOTS + 'district.png', fullPage: true });

  // new plan through all steps
  await page.getByRole('link', { name: 'הוספת תכנית' }).click();
  await expect(page).toHaveURL(/\/plan\/new\?district=2/);
  await page.getByLabel('שם התכנית').fill('תכנית בדיקה');
  await page.getByLabel('מספר תכנית').fill('603-TEST');
  await page.getByLabel('התחדשות עירונית').check();
  await page.getByRole('button', { name: 'הבא' }).click();
  await page.getByLabel('תוספת יח"ד').fill('300');
  await page.getByLabel('דירות עד 55 מ"ר').fill('60');
  await page.getByLabel('דירות 55 עד 80 מ"ר').fill('30');
  await page.getByLabel('יתר הדירות').fill('210');
  await page.getByLabel('ממוצע שטח היתרה, מ"ר').fill('118');
  await expect(page.locator('.rule-card').filter({ hasText: 'R01' }).locator('.chip').first()).toHaveText('עומד');
  await page.getByRole('tab', { name: /שטחים וסף-בית/ }).click();
  await page.getByLabel('תוספת שטח מעל הקרקע, מ״ר').fill('30000');
  await page.getByLabel('שטח ציבורי בנוי, מ״ר').fill('1000');
  await expect(page.locator('.rule-card').filter({ hasText: 'R04' }).locator('.chip').first()).toHaveText('לא עומד');
  await page.getByRole('tab', { name: /מיקום ורח"ק/ }).click();
  await page.getByLabel('מרחק מציר מתע"ן, מ׳').fill('250');
  await page.getByLabel('רח"ק מוצע').fill('4');
  await page.getByLabel('שורת ייעוד בטבלת הרח"ק').selectOption('2');
  await expect(page.locator('.rule-card').filter({ hasText: 'R11' }).locator('.chip').first()).toHaveText('מותנה');
  await page.getByRole('button', { name: 'הקודם' }).click();
  await expect(page.getByRole('tab', { name: /שטחים וסף-בית/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.rule-card .cert').first()).toBeVisible();
  await page.screenshot({ path: SHOTS + 'plan-new.png', fullPage: true });
  // program step and bill of quantities
  await page.getByRole('tab', { name: /פרוגרמה/ }).click();
  await page.getByLabel('כיתות יסודי').fill('3');
  await page.getByLabel('כיתות גן').fill('5');
  await page.getByLabel('שצ"פ, מ"ר').fill('1200');
  await page.getByLabel('מסחר, מ"ר').fill('800');
  const boq = page.getByTestId('boq');
  await expect(boq.locator('tr[data-boq="classrooms"]')).toContainText('חסר מענה');
  await expect(boq.locator('tr[data-boq="kinder"]')).toContainText('עונה');
  await expect(boq.locator('tr[data-boq="commerce"]')).toContainText('אין יעד');
  await expect(boq.locator('tr[data-boq="roads"]')).toContainText('חסר נתון');
  await page.screenshot({ path: SHOTS + 'plan-boq.png', fullPage: true });
  await page.getByRole('button', { name: 'שמירת תכנית' }).click();
  await expect.poll(() => writes.filter((w) => w.table === 'mt_checks').length).toBe(1);
  const planWrite = writes.find((w) => w.table === 'mt_plans')!;
  expect(planWrite.method).toBe('POST');
  expect(planWrite.body).toMatchObject({ name: 'תכנית בדיקה', district_id: 2, units_added: 300, is_renewal: true, far: 4, rahak_row: 2, program: { classrooms: 3, kindergartens: 5, open_space_m2: 1200, commerce_m2: 800 } });
  expect((writes.find((w) => w.table === 'mt_checks')!.body as unknown[]).length).toBe(8);

  // existing example plan: decision
  const t1 = (FX.mt_plans as { id: string; plan_number: string }[]).find((p) => p.plan_number === 'דוגמה T1')!;
  await page.goto(`/plan/${t1.id}`);
  await expect(page.getByText('תכנית דוגמה בדויה')).toBeVisible();
  await page.getByLabel('החלטה', { exact: true }).fill('לאשר בתנאים');
  await page.getByLabel('נימוק').fill('עומד בסף');
  await page.getByLabel(/חריגות שאושרו/).fill('סף-בית');
  await page.getByRole('button', { name: 'רישום החלטה' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_decisions')).toBeTruthy();
  expect(writes.find((w) => w.table === 'mt_decisions')!.body).toMatchObject({ plan_id: t1.id, decision: 'לאשר בתנאים', deviations: ['סף-בית'] });
  await page.getByRole('button', { name: 'שמירה והרצת בדיקה' }).click();
  await expect.poll(() => writes.filter((w) => w.table === 'mt_plans' && w.method === 'PATCH').length).toBe(1);

  // rules
  await page.getByRole('link', { name: 'כללים' }).click();
  await expect(page.getByTestId('rule-R03')).toContainText('הנחת עבודה');
  await page.getByTestId('rule-R01').getByRole('button', { name: 'עריכה' }).click();
  await page.getByTestId('rule-R01').getByLabel('נוסחה').fill('נוסחה מעודכנת');
  await page.getByTestId('rule-R01').getByRole('button', { name: 'שמירה' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_rules')).toBeTruthy();
  expect(writes.find((w) => w.table === 'mt_rules')!.body).toMatchObject({ formula: 'נוסחה מעודכנת', version: 2 });
  await page.getByTestId('rule-R03').getByRole('button', { name: 'עריכה' }).click();
  await page.getByTestId('rule-R03').getByRole('button', { name: 'ביטול' }).click();

  // register
  await page.getByRole('link', { name: 'מרשם מדיניות' }).click();
  const total = await page.locator('tbody tr').count();
  expect(total).toBe(32);
  await page.getByRole('tab', { name: 'עם חוסר' }).click();
  const miss = await page.locator('tbody tr').count();
  expect(miss).toBeLessThan(32);
  await page.getByRole('tab', { name: 'תכניות סטטוטוריות' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('tab', { name: 'הכל' }).click();
  await page.getByLabel('חיפוש במרשם').fill('ניקוז');
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.locator('tbody tr').first().getByRole('button', { name: 'עריכה' }).click();
  await page.locator('tbody tr').first().locator('input').first().fill('בבדיקה');
  await page.locator('tbody tr').first().getByRole('button', { name: 'שמירה' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_policy_register')).toBeTruthy();
  expect(writes.find((w) => w.table === 'mt_policy_register')!.body).toMatchObject({ status: 'בבדיקה' });
  await page.screenshot({ path: SHOTS + 'register.png', fullPage: true });

  // report
  await page.getByRole('link', { name: 'דוח 6.2' }).click();
  await expect(page.getByRole('heading', { name: 'דוח מלאי תכנון ומעקב שנתי' })).toBeVisible();
  await page.getByRole('button', { name: 'הדפסה' }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: boolean }).__printed)).toBe(true);
  await page.getByRole('button', { name: 'שמירת תמונת מצב' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_snapshots')).toBeTruthy();
  const y = new Date().getFullYear();
  await page.getByRole('link', { name: String(y - 1) }).click();
  await expect(page).toHaveURL(new RegExp(`/report/${y - 1}`));
  await page.getByRole('link', { name: String(y) }).click();
  await page.screenshot({ path: SHOTS + 'report.png', fullPage: true });

  // sign out from drawer
  await page.locator('.sys-btn').click();
  await page.getByRole('button', { name: 'יציאה' }).click();
  await expect(page.locator('.sys-btn')).toHaveText('מערכת');
});

test('magic link request sends otp for typed email', async ({ page }) => {
  const { writes } = await mock(page, { admin: false });
  await page.goto('/');
  await page.locator('.sys-btn').click();
  await page.getByLabel('כתובת דואר').fill('someone@ashdod.muni.il');
  await page.getByRole('button', { name: 'שליחת קישור כניסה' }).click();
  await expect(page.getByText('נשלח קישור כניסה')).toBeVisible();
  expect(writes.find((w) => w.table === 'auth/otp')!.body).toMatchObject({ email: 'someone@ashdod.muni.il' });
  await page.getByRole('button', { name: 'סגירה' }).click();
});

test('mobile: no horizontal scroll on every page', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'he-IL' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await mock(page, { admin: true });
  const t1 = (FX.mt_plans as { id: string }[])[0].id;
  for (const path of ['/', '/overview', '/ledger', '/plans', '/plans/e4a38cd3-ec00-4589-b820-f185ae2eda17', '/targets', '/documents', '/map', '/district/2', '/district/8', '/plan/new', `/plan/${t1}`, '/rules', '/register', `/report/${new Date().getFullYear()}`]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await noHScroll(page);
    if (path === '/' || path === '/map' || path === '/plan/new') await page.screenshot({ path: SHOTS + `mobile${path.replace(/\//g, '_') || '_home'}.png`, fullPage: true });
  }
  await ctx.close();
});

test('installability: no errors, manifest and service worker', async ({ page }) => {
  await mock(page, { admin: false });
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== undefined);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await page.context().newCDPSession(page);
  const res = await cdp.send('Page.getInstallabilityErrors');
  expect(res.installabilityErrors).toEqual([]);
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
});

test('requests made on home are only to allowed hosts', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r: Request) => hosts.add(new URL(r.url()).hostname));
  await mock(page, { admin: false });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  for (const h of hosts) expect(['localhost', `${REF}.supabase.co`, 'a.basemaps.cartocdn.com', 'b.basemaps.cartocdn.com', 'tiles.openfreemap.org', 'server.arcgisonline.com', 'fonts.googleapis.com', 'fonts.gstatic.com']).toContain(h);
});

test('documents: upload any file with name and date, open, delete, members only', async ({ page }) => {
  FX.mt_documents = [{ id: 'd1', name: 'פרוטוקול ועדה', doc_date: '2026-09-01', file_path: '2026/a.pdf', file_name: 'protocol.pdf', mime: 'application/pdf', size_bytes: 204800, district_id: 2, plan_id: null, note: null, uploaded_by: 'shtanat5@gmail.com', created_at: '2026-09-02' }];
  const { writes } = await mock(page, { admin: true });
  await page.addInitScript(() => { (window as unknown as { open: () => unknown }).open = () => { const o = { location: { href: '' }, close() {} }; (window as unknown as { __opened: unknown }).__opened = o; return o; }; });
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.getByRole('link', { name: 'מסמכים' }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByTestId('doc-row')).toHaveCount(1);
  await expect(page.getByTestId('doc-row')).toContainText('01.09.2026');
  await page.getByLabel('בחירת קובץ').setInputFiles({ name: 'תשריט מתחם 2.dwg', mimeType: 'application/acad', buffer: Buffer.from('dwg-bytes') });
  await expect(page.getByLabel('שם המסמך')).toHaveValue('תשריט מתחם 2');
  await page.getByLabel('תאריך המסמך').fill('2026-10-01');
  await page.getByLabel('מתחם המסמך').selectOption('2');
  await page.getByLabel('הערה').fill('גרסה לדיון');
  await page.screenshot({ path: SHOTS + 'documents.png', fullPage: true });
  await page.getByRole('button', { name: 'שמירת מסמך' }).click();
  await expect(page.getByText('המסמך נשמר')).toBeVisible();
  const obj = writes.find((w) => w.table.startsWith('storage:object/mt-documents/2026/'));
  expect(obj, 'storage upload').toBeTruthy();
  expect(obj!.table).toMatch(/\.dwg$/);
  expect(writes.find((w) => w.table === 'mt_documents')!.body).toMatchObject({ name: 'תשריט מתחם 2', doc_date: '2026-10-01', file_name: 'תשריט מתחם 2.dwg', district_id: 2, note: 'גרסה לדיון', size_bytes: 9 });
  await page.getByLabel('חיפוש מסמכים').fill('פרוטוקול');
  await expect(page.getByTestId('doc-row')).toHaveCount(1);
  await page.getByTestId('doc-row').getByRole('button', { name: 'פתיחה' }).click();
  await expect.poll(() => page.evaluate(() => ((window as unknown as { __opened?: { location: { href: string } } }).__opened?.location.href ?? ''))).toContain('token=t');
  await page.getByTestId('doc-row').getByRole('button', { name: 'מחיקה' }).click();
  await expect.poll(() => writes.find((w) => w.method === 'DELETE' && w.table === 'mt_documents')).toBeTruthy();
  expect(writes.find((w) => w.method === 'DELETE' && w.table.startsWith('storage:'))!.body).toMatchObject({ prefixes: ['2026/a.pdf'] });
  delete FX.mt_documents;
});

test('documents: anonymous sees members-only notice', async ({ page }) => {
  await mock(page, { admin: false });
  await page.goto('/documents');
  await expect(page.getByText('ספריית המסמכים פתוחה לחברי הצוות בלבד')).toBeVisible();
  await expect(page.getByLabel('בחירת קובץ')).toHaveCount(0);
});

test('sign-in by pasting the emailed link or the dead-end address, then a clear connected banner', async ({ page }) => {
  // reads of mt_members return admin once a session exists
  const { writes } = await mock(page, { admin: true, noSession: true });
  await page.goto('/');
  await page.locator('.sys-btn').click();
  await page.getByLabel('כתובת דואר').fill('shtanat5@gmail.com');
  await page.getByRole('button', { name: 'שליחת קישור כניסה' }).click();
  await expect(page.locator('.paste-login.lit')).toBeVisible();
  // a used link shows a clear message
  await page.getByLabel('קישור הכניסה מהמייל').fill('https://cbhexpybdggwzyakgagd.supabase.co/auth/v1/verify?token=used&type=magiclink&redirect_to=http://localhost:3000');
  await page.getByRole('button', { name: 'כניסה עם הקישור' }).click();
  await expect(page.locator('.paste-login .notice')).toContainText('פג תוקף או כבר נוצל');
  // garbage
  await page.getByLabel('קישור הכניסה מהמייל').fill('hello');
  await page.getByRole('button', { name: 'כניסה עם הקישור' }).click();
  await expect(page.locator('.paste-login .notice')).toContainText('לא נראה כמו קישור');
  // the address the link landed on (localhost:3000/#access_token=…)
  await page.getByLabel('קישור הכניסה מהמייל').fill(`http://localhost:3000/#access_token=${fakeJwt()}&expires_at=9999999999&expires_in=3600&refresh_token=abc&token_type=bearer&type=magiclink`);
  await page.getByRole('button', { name: 'כניסה עם הקישור' }).click();
  await expect(page.getByTestId('signed-banner')).toContainText('מחוברת');
  await expect(page.getByTestId('signed-banner')).toContainText('shtanat5@gmail.com');
  await expect(page.getByTestId('signed-banner')).toContainText('הרשאה: מנהלת');
  await expect(page.locator('.sys-btn')).toContainText('מנהלת');
  await page.screenshot({ path: SHOTS + 'signed-in.png' });
  await page.getByTestId('signed-banner').getByRole('button', { name: 'סגירה' }).click();
  await expect(page.getByTestId('signed-banner')).toHaveCount(0);
  // sign out, then the original email link (verify?token=…)
  await page.locator('.sys-btn').click();
  await page.getByRole('button', { name: 'יציאה' }).click();
  await page.locator('.sys-btn').click();
  await page.getByLabel('קישור הכניסה מהמייל').fill('https://cbhexpybdggwzyakgagd.supabase.co/auth/v1/verify?token=pkce_abc123&type=magiclink&redirect_to=http://localhost:3000');
  await page.getByRole('button', { name: 'כניסה עם הקישור' }).click();
  await expect(page.getByTestId('signed-banner')).toContainText('הרשאה: מנהלת');
  expect(writes.filter((w) => w.table === 'auth/verify').map((w) => (w.body as { token_hash: string }).token_hash)).toContain('pkce_abc123');
});

test('about page explains input, computation and output', async ({ page }) => {
  await mock(page, { admin: false });
  await page.goto('/');
  // the opening page is "how it works", and it is the first item in the top navigation
  await expect(page.getByRole('heading', { name: 'קלט, חישוב ופלט' })).toBeVisible();
  await expect(page.locator('.tb-nav a').first()).toHaveText('איך זה עובד');
  await expect(page.locator('.tb-nav a').first()).toHaveClass(/active/);
  for (const t of ['1. קלט', '2. חישוב', '3. פלט']) await expect(page.getByText(t)).toBeVisible();
  await expect(page.locator('table').first().locator('tbody tr')).toHaveCount(8);
  await page.screenshot({ path: SHOTS + 'about.png', fullPage: true });
  await page.getByRole('link', { name: 'למפה' }).click();
  await expect(page).toHaveURL(/\/map$/);
});

test('ledger, plan file: documents, extraction, approval with source page, area split, boundary, targets, exports', async ({ page }) => {
  const AP = 'e4a38cd3-ec00-4589-b820-f185ae2eda17';
  FX.mt_documents = FX.mt_documents_plan;
  const { writes } = await mock(page, { admin: true });
  await page.goto('/');
  await page.locator('.tb-nav').getByRole('link', { name: 'מאזן מימוש' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  const housing = page.getByTestId('city-totals').locator('tr[data-domain="housing"]');
  await expect(housing).toContainText('1,200');
  await expect(page.getByTestId('city-ledger').locator('[data-cell="5:housing"]')).toContainText('יתרה');
  await expect(page.getByText('נתונים מחולצים ממתינים לאישור')).toBeVisible();
  await expect(page.getByTestId('attention')).toContainText('מה לקדם');
  await page.screenshot({ path: SHOTS + 'ledger.png', fullPage: true });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא לאקסל' }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.getByRole('button', { name: 'ייצוא ל-PDF' }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed?: boolean }).__printed)).toBe(true);

  // plans list and filters
  await page.locator('.tb-nav').getByRole('link', { name: 'תכניות' }).click();
  await expect(page.getByTestId('plans-table').locator('tbody tr')).toHaveCount(3);
  await page.getByRole('tab', { name: 'מאושרות' }).click();
  await expect(page.getByTestId('plans-table').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('tab', { name: 'בהליך' }).click();
  await expect(page.getByTestId('plans-table').locator('tbody tr')).toHaveCount(2);
  await page.getByRole('tab', { name: 'הכל' }).click();
  await page.getByRole('link', { name: '603-0900001' }).click();
  await expect(page).toHaveURL(new RegExp(`/plans/${AP}$`));

  // documents and extraction
  await expect(page.getByTestId('extract-ready')).toHaveText('חילוץ אוטומטי זמין');
  await expect(page.getByTestId('plan-docs')).toContainText('הוראות התכנית');
  await expect(page.getByTestId('plan-docs')).toContainText('לא נמצא במסמך: אורך כבישים');
  await page.getByTestId('plan-docs').getByRole('button', { name: 'חילוץ נתונים' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'fn:mt-extract')?.body).toMatchObject({ plan_id: AP, doc_id: 'doc-1' });
  await expect(page.getByTestId('plan-msg')).toContainText('החילוץ רץ');
  await page.getByLabel('קובץ מסמך').setInputFiles({ name: 'טבלת זכויות.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('x') });
  await expect(page.getByLabel('שם המסמך')).toHaveValue('טבלת זכויות');
  await page.getByRole('button', { name: 'העלאת מסמך' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_documents')?.body).toMatchObject({ name: 'טבלת זכויות', plan_id: AP });
  expect(writes.find((w) => w.table.startsWith(`storage:object/mt-documents/plans/${AP}/`))).toBeTruthy();

  // approval screen: source opens the document at the page
  const rows = page.getByTestId('plan-approve').locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await page.locator('tr[data-qty="q-a1"]').getByRole('button', { name: 'מקור' }).click();
  await expect(page.getByTestId('doc-viewer').locator('iframe')).toHaveAttribute('src', /token=t#page=7$/);
  await page.screenshot({ path: SHOTS + 'plan-approve.png', fullPage: true });
  await page.getByTestId('doc-viewer').getByRole('button', { name: 'סגירה' }).click();
  // area split of the unassigned draft
  await expect(page.getByTestId('area-split')).toContainText('60%');
  await page.locator('tr[data-qty="q-a3"]').getByRole('button', { name: 'חלוקה לפי שטח' }).click();
  await expect.poll(() => writes.find((w) => w.method === 'PATCH' && w.table === 'mt_plan_quantities' && w.url.includes('q-a3'))?.body).toMatchObject({ district_id: 2, value: 10800, split: 'area', status: 'draft' });
  expect(writes.find((w) => w.method === 'POST' && w.table === 'mt_plan_quantities')!.body).toMatchObject([{ district_id: 3, value: 7200, split: 'area' }]);
  // approve all: nothing complete; then assign and approve one row
  await page.getByRole('button', { name: 'אישור כל הטיוטות השלמות' }).click();
  await expect(page.getByTestId('plan-msg')).toContainText('אין טיוטות שלמות');
  await page.locator('tr[data-qty="q-a3"]').getByLabel('מתחם').selectOption('5');
  await page.locator('tr[data-qty="q-a3"]').getByRole('button', { name: 'אישור' }).click();
  await expect.poll(() => writes.find((w) => w.method === 'PATCH' && w.url.includes('q-a3') && (w.body as { status?: string }).status === 'approved')?.body).toMatchObject({ district_id: 5, approved_by: 'shtanat5@gmail.com' });
  // edit an approved row returns it to draft
  await page.locator('tr[data-qty="q-a2"]').getByLabel('כמות').fill('14');
  await page.locator('tr[data-qty="q-a2"]').getByRole('button', { name: 'שמירה' }).click();
  await expect.poll(() => writes.find((w) => w.method === 'PATCH' && w.url.includes('q-a2'))?.body).toMatchObject({ value: 14, status: 'draft' });
  await page.locator('tr[data-qty="q-a2"]').getByRole('button', { name: 'מחיקה' }).click();
  await expect.poll(() => writes.find((w) => w.method === 'DELETE' && w.url.includes('q-a2'))).toBeTruthy();
  await page.getByRole('button', { name: 'הוספת שורה ידנית' }).click();
  await expect.poll(() => writes.filter((w) => w.method === 'POST' && w.table === 'mt_plan_quantities').length).toBe(2);
  await page.getByRole('button', { name: 'העתקה מטופס הבדיקה' }).click();
  await expect.poll(() => writes.filter((w) => w.method === 'POST' && w.table === 'mt_plan_quantities').length).toBe(3);

  // boundary from an ITM GeoJSON, then drawn by hand
  const ring = [[166000, 633500], [166600, 633500], [166600, 634100], [166000, 634100], [166000, 633500]];
  await page.getByLabel('קובץ GIS').setInputFiles({ name: 'gvul.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] })) });
  await expect.poll(() => writes.find((w) => w.method === 'PATCH' && w.table === 'mt_plans')?.body).toMatchObject({ boundary_source: 'gis', area_m2: 50000 });
  const b = (writes.find((w) => w.method === 'PATCH' && w.table === 'mt_plans')!.body as { boundary: { coordinates: number[][][] } }).boundary;
  expect(b.coordinates[0][0][0]).toBeGreaterThan(34.6); expect(b.coordinates[0][0][1]).toBeGreaterThan(31.75);
  await page.getByRole('button', { name: 'שרטוט גבול ידני' }).click();
  const box = (await page.getByTestId('boundary-map').boundingBox())!;
  for (const [x, y] of [[0.3, 0.3], [0.7, 0.3], [0.6, 0.7]]) await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await expect(page.getByText('3 נקודות')).toBeVisible();
  await page.getByRole('button', { name: 'ביטול נקודה אחרונה' }).click();
  await expect(page.getByText('2 נקודות')).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.7);
  await page.getByRole('button', { name: 'סיום שרטוט' }).click();
  await expect.poll(() => writes.filter((w) => w.method === 'PATCH' && w.table === 'mt_plans').some((w) => (w.body as { boundary_source?: string }).boundary_source === 'drawn')).toBe(true);
  await page.getByRole('button', { name: 'מחיקת הגבול' }).click();
  await expect.poll(() => writes.some((w) => w.method === 'PATCH' && w.table === 'mt_plans' && (w.body as { boundary?: unknown }).boundary === null)).toBe(true);

  // bill of quantities vs the district target
  await expect(page.getByTestId('plan-boq').locator('tbody tr').first()).toContainText('1,200');
  await expect(page.getByTestId('plan-boq').locator('tbody tr').first()).toContainText('15,800');
  // plan details save
  await page.getByLabel('תאריך אישור (מתן תוקף)').fill('2026-04-01');
  await page.getByRole('button', { name: 'שמירת הפרטים' }).click();
  await expect.poll(() => writes.filter((w) => w.method === 'PATCH' && w.table === 'mt_plans').some((w) => (w.body as { approval_date?: string }).approval_date === '2026-04-01')).toBe(true);

  // district summary shows the plan's contribution
  await page.goto('/district/5');
  await expect(page.getByTestId('district-ledger').locator('thead')).toContainText('603-0900001');
  await expect(page.getByTestId('district-ledger').locator('tr[data-domain="housing"]')).toContainText('1,200');
  const dl2 = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא לאקסל' }).click();
  expect((await dl2).suggestedFilename()).toBe('ashdod-ledger-district-5.xlsx');

  // targets
  await page.goto('/targets');
  await page.getByRole('tab', { name: 'חינוך יסודי' }).click();
  await page.getByTestId('targets-table').getByRole('button', { name: 'עריכה' }).first().click();
  await page.getByLabel('יעד', { exact: true }).fill('150');
  await page.getByLabel('תאריך הקיים').fill('2026-09-01');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_targets')?.body).toMatchObject({ district_id: 1, domain_key: 'education', target: 150, existing_date: '2026-09-01' });
  await page.getByLabel('שם התחום').fill('מלונאות');
  await page.getByLabel('יחידה').fill('חדרים');
  await page.getByRole('button', { name: 'הוספה' }).click();
  await expect.poll(() => writes.find((w) => w.table === 'mt_domains')?.body).toMatchObject({ title: 'מלונאות', unit: 'חדרים' });
  await expect.poll(() => (writes.filter((w) => w.table === 'mt_targets').pop()?.body as unknown[] | undefined)?.length).toBe(9);

  // new plan file
  await page.goto('/plans/new');
  await page.getByLabel('שם').fill('תכנית בדיקה');
  await page.getByRole('button', { name: 'פתיחת התיק' }).click();
  await expect.poll(() => writes.find((w) => w.method === 'POST' && w.table === 'mt_plans')?.body).toMatchObject({ name: 'תכנית בדיקה', status: 'approved' });
  delete FX.mt_documents;
});

test('ledger and plans: anonymous sees targets, not plan data', async ({ page }) => {
  await mock(page, { admin: false });
  await page.goto('/ledger');
  await expect(page.getByText('תרומת התכניות פתוחה לחברי הצוות')).toBeVisible();
  await expect(page.getByTestId('city-totals').locator('tr[data-domain="housing"]')).toContainText('לצוות');
  await page.goto('/plans');
  await expect(page.getByText('רשימת התכניות פתוחה לחברי הצוות')).toBeVisible();
});
