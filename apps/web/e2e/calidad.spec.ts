/**
 * Calidad de las pantallas principales (Fase 8): accesibilidad automática
 * (axe-core, WCAG 2.1 A/AA, impacto grave o crítico), errores de consola,
 * peticiones fallidas, enlaces rotos, desbordamiento horizontal en móvil y
 * cabeceras de seguridad. Datos de prueba propios en la base de datos de e2e.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const WEB = process.env.E2E_API_URL ?? '';
const HOST = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:4329').host;
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');

async function token(email: string) {
  const r = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return ((await r.json()) as { access_token: string }).access_token;
}
async function post(path: string, tok: string, body: unknown) {
  const r = await fetch(`${PROXY}/rest/v1${path}`, { method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body) });
  return (await r.json()) as Array<Record<string, string>>;
}
async function login(page: Page, email: string, next: string) {
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === next);
}

let ids: { customer: string; order: string; email: string } | null = null;
async function fixtures() {
  if (ids) return ids;
  const owner = await token('propietaria@e2e.test');
  const email = `calidad-${Date.now()}${Math.floor(Math.random() * 1000)}@e2e.test`;
  const [c] = await post('/customers', owner, { workshop_id: DEMO, full_name: 'Cliente Calidad', email });
  await fetch(`${PROXY}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
  const [inv] = await post('/rpc/create_customer_invitation', owner, { p_customer_id: c!.id });
  await post('/rpc/accept_customer_invitation', await token(email), { p_token: inv!.token });
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  const plate = `${Math.floor(1000 + Math.random() * 9000)}${Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * 20)]).join('')}`;
  const [v] = await post('/vehicles', owner, { workshop_id: DEMO, customer_id: c!.id, plate, make: 'Seat', model: 'Ibiza' });
  const [o] = await post('/repair_orders', owner, { workshop_id: DEMO, vehicle_id: v!.id, customer_id: c!.id, problem_description: 'Revisión general' });
  ids = { customer: c!.id!, order: o!.id!, email };
  return ids;
}

/** Visita cada página y comprueba consola, red, accesibilidad y anchura. */
async function audit(page: Page, paths: string[], isMobile: boolean) {
  const problems: string[] = [];
  // Los fallos de carga se comprueban abajo por la red (solo los de nuestra web: los vídeos de
  // demostración están en otro servidor que en este entorno de pruebas no es accesible).
  const onConsole = (m: { type(): string; text(): string }) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`consola: ${m.text().slice(0, 200)}`);
  };
  const onResponse = (r: { status(): number; url(): string }) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && (u.host === HOST || u.hostname === '127.0.0.1')) problems.push(`red ${r.status()}: ${u.pathname}`);
  };
  page.on('console', onConsole);
  page.on('response', onResponse);
  for (const path of paths) {
    const before = problems.length;
    const res = await page.goto(path);
    if ((res?.status() ?? 500) >= 400) { problems.push(`${path}: responde ${res?.status()}`); continue; }
    await page.waitForLoadState('networkidle');
    if (isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${path}: desborda ${overflow}px en horizontal`);
    } else {
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      for (const v of axe.violations.filter(x => x.impact === 'serious' || x.impact === 'critical')) {
        problems.push(`${path}: [${v.impact}] ${v.id} — ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
      }
    }
    for (let i = before; i < problems.length; i++) if (!problems[i]!.startsWith(path)) problems[i] = `${path} · ${problems[i]}`;
  }
  page.off('console', onConsole);
  page.off('response', onResponse);
  expect(problems, problems.join('\n')).toEqual([]);
}

test('web pública: accesibilidad, consola, enlaces y móvil', async ({ page, isMobile }) => {
  await audit(page, ['/', '/clasico', '/privacidad', '/aviso-legal', '/cookies', '/acceso', '/registro', '/recuperar', '/privacidad-cuenta', '/condiciones'], isMobile);
  // Enlaces internos de las dos portadas (premium y clásica): ninguno roto.
  for (const home of ['/', '/clasico']) {
    await page.goto(home);
    const hrefs = await page.locator('a[href^="/"]').evaluateAll(as => [...new Set(as.map(a => (a as HTMLAnchorElement).getAttribute('href')!.split('#')[0]!))]);
    for (const href of hrefs.filter(Boolean)) {
      // Node no resuelve *.localhost: se pide a 127.0.0.1 con la cabecera Host de la web.
      const r = await fetch(`${WEB}${href}`, { headers: { host: HOST }, redirect: 'manual' });
      expect(r.status, `enlace ${href} (${home})`).toBeLessThan(400);
    }
    // Las anclas (#servicios, #solicitar…) apuntan a secciones que existen.
    const anchors = await page.locator('a[href^="#"]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute('href')!.slice(1)))]);
    for (const id of anchors.filter(Boolean)) await expect(page.locator(`[id="${id}"]`), `ancla #${id} (${home})`).toHaveCount(1);
  }
});

test('panel del taller: accesibilidad, consola y móvil', async ({ page, isMobile }) => {
  const f = await fixtures();
  await login(page, 'propietaria@e2e.test', '/panel');
  await audit(page, [
    '/panel', '/panel/ordenes', `/panel/ordenes/${f.order}`, '/panel/ordenes/nueva', '/panel/vehiculos', '/panel/vehiculos/nuevo',
    '/panel/clientes', `/panel/clientes/${f.customer}`, '/panel/equipo', '/panel/avisos', '/panel/solicitudes', '/panel/taller',
  ], isMobile);
});

test('portal del cliente: accesibilidad, consola y móvil', async ({ page, isMobile }) => {
  const f = await fixtures();
  await login(page, f.email, '/portal');
  await audit(page, ['/portal', '/portal/vehiculos', '/portal/reparaciones', `/portal/reparaciones/${f.order}`, '/portal/avisos', '/portal/datos'], isMobile);
});

test('cabeceras de seguridad en la web pública y en el área privada', async () => {
  for (const path of ['/', '/acceso', '/panel', '/api/notificaciones/procesar']) {
    const r = await fetch(`${WEB}${path}`, { headers: { host: HOST }, redirect: 'manual' });
    const h = r.headers;
    expect(h.get('x-content-type-options'), `${path} nosniff`).toBe('nosniff');
    expect(h.get('content-security-policy') ?? '', `${path} CSP`).toContain("frame-ancestors 'none'");
    expect(h.get('permissions-policy') ?? '', `${path} permisos`).toContain('camera=()');
    expect(h.get('referrer-policy'), `${path} referrer`).toBeTruthy();
  }
  const priv = await fetch(`${WEB}/acceso`, { headers: { host: HOST } });
  expect(priv.headers.get('cache-control')).toContain('no-store');
});

test('teclado: el primer Tab lleva a «Saltar al contenido» en panel y portal', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Teclado: escritorio');
  const f = await fixtures();
  await login(page, 'propietaria@e2e.test', '/panel');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Saltar al contenido');
  await page.context().clearCookies();
  await login(page, f.email, '/portal');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Saltar al contenido');
});
