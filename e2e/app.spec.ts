import { test, expect, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8')) as Record<string, unknown[]>;
const REF = 'cbhexpybdggwzyakgagd';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
fs.mkdirSync(SHOTS, { recursive: true });

interface Captured { method: string; table: string; body: unknown; url: string }

async function mock(page: Page, opts: { admin: boolean }) {
  const writes: Captured[] = [];
  const reads: string[] = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname === 'localhost') return route.continue();
    if (url.hostname.endsWith('supabase.co')) {
      if (url.pathname === '/auth/v1/settings') return route.fulfill({ json: { external: { google: false, email: true } } });
      if (url.pathname.startsWith('/auth/v1/otp')) { writes.push({ method: 'POST', table: 'auth/otp', body: req.postDataJSON(), url: req.url() }); return route.fulfill({ json: {} }); }
      if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
      const m = url.pathname.match(/\/rest\/v1\/(\w+)/);
      if (m) {
        const table = m[1];
        if (req.method() === 'GET') {
          reads.push(table);
          let rows = (FX[table] ?? []) as unknown[];
          if (!opts.admin && ['mt_plans', 'mt_decisions', 'mt_members', 'mt_checks', 'mt_snapshots'].includes(table)) rows = [];
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
    if (url.hostname.includes('cartocdn') || url.hostname.includes('fonts.')) return route.abort();
    return route.abort();
  });
  if (opts.admin) {
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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'כל תכנית היא דלתא בתאום העיר' })).toBeVisible();
  await expect(page.locator('[data-testid^="district-card-"]')).toHaveCount(9);
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.map-label')).toHaveCount(8);
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
  await page.getByRole('button', { name: 'כניסה' }).click();
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
  for (const key of ['base', 'city', 'districts', 'labels', 'cells', 'qpoints', 'plans', 'extrude']) {
    const box = page.locator(`input[data-layer="${key}"]`);
    const before = await box.isChecked();
    await box.click();
    await expect(box).toBeChecked({ checked: !before });
    const layers = new URL(page.url()).searchParams.get('layers') ?? '';
    expect(layers.split(',').includes(key)).toBe(!before);
  }
  // restore richer view for screenshot
  for (const key of ['cells', 'qpoints']) { const b = page.locator(`input[data-layer="${key}"]`); if (!(await b.isChecked())) await b.click(); }
  for (const key of ['base', 'city', 'districts', 'labels', 'plans']) { const b = page.locator(`input[data-layer="${key}"]`); if (!(await b.isChecked())) await b.click(); }
  for (const t of ['יעד אוכלוסייה', 'תוספת יח"ד', 'סף 6.3']) {
    await page.getByRole('tab', { name: t }).click();
    await expect(page.getByRole('tab', { name: t })).toHaveAttribute('aria-selected', 'true');
  }
  await page.locator('.map-label[data-district="2"]').click();
  await expect(page.locator('.map-card h3')).toHaveText('מרכז מתחדש');
  expect(new URL(page.url()).searchParams.get('d')).toBe('2');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOTS + 'map-layers.png' });
  await page.getByRole('button', { name: 'העתקת קישור' }).click();
  await expect(page.getByRole('button', { name: 'הקישור הועתק' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('d=2');
  expect(clip).toContain('layers=');
  await page.getByRole('link', { name: 'לדף המתחם' }).click();
  await expect(page).toHaveURL(/\/district\/2$/);
  // extrusion view
  await page.goto('/map?layers=base,city,districts,extrude&theme=target');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + 'map-3d.png' });
});

test('admin: top bar links, district edit, plan create + decision, rules, register, report', async ({ page }) => {
  const { writes } = await mock(page, { admin: true });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'מנהלת' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'שיחת הפיתוח' })).toHaveAttribute('href', /claude\.ai\/code\/session_/);
  await expect(page.getByRole('link', { name: 'פרויקט המחקר' })).toHaveAttribute('href', /claude\.ai/);
  // brand goes home
  await page.getByRole('link', { name: 'מפה ושכבות' }).first().click();
  await expect(page).toHaveURL(/\/map/);
  await page.getByRole('link', { name: 'דף הבית' }).click();
  await expect(page).toHaveURL(/\/$/);

  // district
  await page.getByTestId('district-card-2').click();
  await expect(page.getByRole('heading', { name: 'מרכז מתחדש' })).toBeVisible();
  await expect(page.getByText('דוגמה: פינוי-בינוי')).toBeVisible();
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
  await page.getByRole('button', { name: 'שמירת תכנית' }).click();
  await expect.poll(() => writes.filter((w) => w.table === 'mt_checks').length).toBe(1);
  const planWrite = writes.find((w) => w.table === 'mt_plans')!;
  expect(planWrite.method).toBe('POST');
  expect(planWrite.body).toMatchObject({ name: 'תכנית בדיקה', district_id: 2, units_added: 300, is_renewal: true, far: 4, rahak_row: 2 });
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
  await page.getByRole('button', { name: 'מנהלת' }).click();
  await page.getByRole('button', { name: 'יציאה' }).click();
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible();
});

test('magic link request sends otp for typed email', async ({ page }) => {
  const { writes } = await mock(page, { admin: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'כניסה' }).click();
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
  for (const path of ['/', '/map', '/district/2', '/district/8', '/plan/new', `/plan/${t1}`, '/rules', '/register', `/report/${new Date().getFullYear()}`]) {
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
  for (const h of hosts) expect(['localhost', `${REF}.supabase.co`, 'a.basemaps.cartocdn.com', 'b.basemaps.cartocdn.com', 'fonts.googleapis.com', 'fonts.gstatic.com']).toContain(h);
});
