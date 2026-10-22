/**
 * Calidad de las pantallas principales (Fase 8): accesibilidad automática
 * (axe-core, WCAG 2.1 A/AA, impacto grave o crítico), errores de consola,
 * peticiones fallidas, enlaces rotos, desbordamiento horizontal en móvil y
 * cabeceras de seguridad. Datos de prueba propios en la base de datos de e2e.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_PANEL_COLOR, PANEL_COLORS } from '../src/lib/panel/colors.ts';
import { acceptCookies } from './consent.ts';

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

let ids: { customer: string; order: string; vehicle: string; email: string } | null = null;
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
  const [v] = await post('/vehicles', owner, { workshop_id: DEMO, customer_id: c!.id, plate, make: 'Seat', model: 'Ibiza', year: 2015, year_kind: 'fabricacion' });
  const [o] = await post('/repair_orders', owner, { workshop_id: DEMO, vehicle_id: v!.id, customer_id: c!.id, problem_description: 'Revisión general' });
  // Un mantenimiento anotado, para que la ficha del vehículo y el portal lo enseñen.
  const iv = await fetch(`${PROXY}/rest/v1/service_intervals?select=id&workshop_id=eq.${DEMO}&name=eq.Pre-ITV`, { headers: { apikey: ANON, authorization: `Bearer ${owner}` } });
  const [pre] = (await iv.json()) as Array<{ id: string }>;
  await fetch(`${PROXY}/rest/v1/rpc/set_vehicle_service`, {
    method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${owner}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_vehicle_id: v!.id, p_interval_id: pre!.id, p_done_on: new Date(Date.now() - 350 * 86_400_000).toISOString().slice(0, 10) }),
  });
  ids = { customer: c!.id!, order: o!.id!, vehicle: v!.id!, email };
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
  test.setTimeout(180_000); // 23 pantallas
  const f = await fixtures();
  await login(page, 'propietaria@e2e.test', '/panel');
  await audit(page, [
    '/panel', '/panel/ordenes', `/panel/ordenes/${f.order}`, '/panel/ordenes/nueva', '/panel/vehiculos', '/panel/vehiculos/nuevo',
    '/panel/clientes', `/panel/clientes/${f.customer}`, '/panel/equipo', '/panel/avisos', '/panel/solicitudes', '/panel/taller',
    '/panel/planificacion', '/panel/planificacion?vista=semana', '/panel/presupuestos', '/panel/presupuestos/nuevo',
    '/panel/facturas', '/panel/facturas/nueva', '/panel/recordatorios', '/panel/estadisticas',
    '/panel/mantenimientos', `/panel/vehiculos/${f.vehicle}`, '/panel/copia',
  ], isMobile);
});

test('panel en cada color pastel: contraste y accesibilidad', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'El contraste se comprueba en escritorio');
  test.setTimeout(360_000);
  const f = await fixtures();
  await login(page, 'propietaria@e2e.test', '/panel');
  // En el panel el modo claro es el predeterminado; el oscuro se comprueba también (menos pantallas).
  for (const c of PANEL_COLORS.filter(x => x.id !== DEFAULT_PANEL_COLOR)) {
    await context.addCookies([{ name: 'color_panel', value: c.id, url: page.url() }, { name: 'tema', value: 'oscuro', url: page.url() }]);
    await audit(page, ['/panel', `/panel/ordenes/${f.order}`], false);
    await context.addCookies([{ name: 'tema', value: 'claro', url: page.url() }]);
    await audit(page, ['/panel', `/panel/ordenes/${f.order}`, `/panel/clientes/${f.customer}`, '/panel/solicitudes', '/panel/avisos'], false);
    await expect(page.locator('html')).toHaveAttribute('data-color', c.id);
    // El propio selector, abierto, también cumple.
    await page.locator('[data-color-pick] > summary').click();
    const axe = await new AxeBuilder({ page }).include('[data-color-pick]').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${c.id}: ${v.id}`)).toEqual([]);
  }
});

test('modo claro y oscuro: accesibilidad de la web, el acceso, el panel y el portal', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'El contraste se comprueba en escritorio');
  test.setTimeout(240_000);
  const f = await fixtures();
  for (const tema of ['claro', 'oscuro']) {
    await context.addCookies([{ name: 'tema', value: tema, url: page.url().startsWith('http') ? page.url() : `http://${HOST}` }]);
    await audit(page, ['/', '/clasico', '/acceso', '/cookies'], false);
    await expect(page.locator('html')).toHaveAttribute('data-theme', tema);
  }
  await login(page, 'propietaria@e2e.test', '/panel');
  for (const tema of ['claro', 'oscuro']) {
    await context.addCookies([{ name: 'tema', value: tema, url: page.url() }]);
    await audit(page, ['/panel', '/panel/ordenes', `/panel/ordenes/${f.order}`, '/panel/vehiculos/nuevo', '/panel/avisos', '/cuenta', '/panel/planificacion', '/panel/facturas', '/panel/estadisticas'], false);
  }
  await context.clearCookies(); await acceptCookies(context);
  await login(page, f.email, '/portal');
  for (const tema of ['claro', 'oscuro']) {
    await context.addCookies([{ name: 'tema', value: tema, url: page.url() }]);
    await audit(page, ['/portal', `/portal/reparaciones/${f.order}`, '/portal/datos'], false);
  }
});

test('modo claro y oscuro: cambia al momento, se recuerda y cada zona tiene el suyo por defecto', async ({ page, context }) => {
  const f = await fixtures();
  // Web pública: oscuro por defecto; el botón cambia sin recargar y se recuerda.
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'oscuro');
  await page.getByRole('button', { name: 'Modo claro' }).first().click();
  await expect(html).toHaveAttribute('data-theme', 'claro');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.pm')!).backgroundColor)).toBe('rgb(245, 241, 233)');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'claro');
  await page.getByRole('button', { name: 'Modo oscuro' }).first().click();
  await expect(html).toHaveAttribute('data-theme', 'oscuro');
  // Un valor manipulado no rompe nada: el de la zona.
  await context.addCookies([{ name: 'tema', value: '"><script>', url: page.url() }]);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'oscuro');
  // Panel del taller: claro si no se ha elegido; la elección se mantiene al navegar por el panel.
  const forget = async () => { await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await context.clearCookies(); await acceptCookies(context); };
  await forget();
  await login(page, 'propietaria@e2e.test', '/panel');
  await expect(html).toHaveAttribute('data-theme', 'claro');
  await page.getByRole('button', { name: 'Modo oscuro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'oscuro');
  await page.getByRole('link', { name: 'Órdenes', exact: true }).first().click();
  await page.waitForURL(/\/panel\/ordenes$/);
  await expect(html).toHaveAttribute('data-theme', 'oscuro');
  // Portal del cliente y acceso: también claro si no se ha elegido.
  await forget();
  await login(page, f.email, '/portal');
  await expect(html).toHaveAttribute('data-theme', 'claro');
  await page.goto('/cuenta');
  await expect(html).toHaveAttribute('data-theme', 'claro');
});

test.describe('aviso de cookies', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  const cookie = async (context: import('@playwright/test').BrowserContext, name: string) => (await context.cookies()).find(c => c.name === name)?.value;

  test('aparece hasta responder; aceptar guarda las preferencias y rechazar las borra', async ({ page, context, isMobile }) => {
    await page.goto('/');
    const html = page.locator('html');
    const bar = page.getByRole('region', { name: 'Cookies' });
    await expect(bar).toBeVisible();
    // «Rechazar» y «Aceptar» con el mismo peso (mismo estilo y tamaño).
    const reject = bar.getByRole('button', { name: 'Rechazar' }), accept = bar.getByRole('button', { name: 'Aceptar' });
    expect(await reject.getAttribute('class')).toBe(await accept.getAttribute('class'));
    const [rb, ab] = [await reject.boundingBox(), await accept.boundingBox()];
    expect(Math.abs(rb!.height - ab!.height)).toBeLessThan(1);
    if (!isMobile) {
      const axe = await new AxeBuilder({ page }).include('[data-cookie-bar]').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
    }
    // Sin responder, el modo se mantiene durante la visita (cookie de sesión), pero no se guarda en el dispositivo.
    const tema = async () => (await context.cookies()).find(c => c.name === 'tema');
    await page.getByRole('button', { name: 'Modo claro' }).first().click();
    await expect(html).toHaveAttribute('data-theme', 'claro');
    expect(await tema()).toMatchObject({ value: 'claro', expires: -1 });
    expect(await page.evaluate(() => localStorage.getItem('tema'))).toBeNull();
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'claro');
    // Aceptar: el aviso se va y lo elegido en la visita (también en páginas anteriores) se guarda 1 año.
    await accept.click();
    await expect(bar).toBeHidden();
    expect(await cookie(context, 'consentimiento')).toBe('aceptadas');
    expect((await tema())?.value).toBe('claro');
    expect((await tema())!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 3600);
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'claro');
    await expect(page.locator('[data-cookie-bar]')).toHaveCount(0);
    // Cambiar de idea en /cookies: rechazar borra lo guardado.
    await page.goto('/cookies');
    const choice = page.locator('.consent-choice');
    await expect(choice).toContainText('Aceptadas');
    await choice.getByRole('button', { name: 'Rechazar' }).click();
    await expect(choice).toContainText('Rechazadas');
    expect(await cookie(context, 'consentimiento')).toBe('rechazadas');
    // Se borra del dispositivo; lo elegido sigue solo hasta cerrar el navegador.
    expect(await tema()).toMatchObject({ value: 'claro', expires: -1 });
    expect(await page.evaluate(() => localStorage.getItem('tema'))).toBeNull();
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'claro');
    await expect(page.locator('[data-cookie-bar]')).toHaveCount(0);
    // Al cerrar el navegador (sin cookies de sesión), vuelve el modo de la zona.
    await context.clearCookies({ name: 'tema' });
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'oscuro');
  });

  test('el aviso no tapa nada: en un móvil pequeño se puede pulsar «Entrar» sin responderlo', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/acceso');
    await expect(page.getByRole('region', { name: 'Cookies' })).toBeVisible();
    await page.getByRole('button', { name: 'Entrar' }).click({ trial: true });
    await page.goto('/');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('link', { name: 'Cookies', exact: true }).last().click({ trial: true });
  });

  test('si se rechazan, el modo elegido en el panel se mantiene al cambiar de página', async ({ page }) => {
    await login(page, 'propietaria@e2e.test', '/panel');
    const html = page.locator('html');
    await page.getByRole('region', { name: 'Cookies' }).getByRole('button', { name: 'Rechazar' }).click();
    await page.getByRole('button', { name: 'Modo oscuro' }).click();
    await expect(html).toHaveAttribute('data-theme', 'oscuro');
    await page.getByRole('link', { name: 'Órdenes', exact: true }).first().click();
    await page.waitForURL(/\/panel\/ordenes$/);
    await expect(html).toHaveAttribute('data-theme', 'oscuro');
    await expect(page.locator('[data-cookie-bar]')).toHaveCount(0);
    // También al cargar cada sección de cero (lo pinta ya el servidor) y en «Mi cuenta».
    for (const path of ['/panel/clientes', '/panel/equipo', '/panel', '/cuenta']) {
      await page.goto(path);
      await expect(html).toHaveAttribute('data-theme', 'oscuro');
    }
    // Y al volver a claro, claro en todas.
    await page.goto('/panel');
    await page.getByRole('button', { name: 'Modo claro' }).click();
    for (const path of ['/panel/ordenes', '/panel/vehiculos', '/cuenta']) {
      await page.goto(path);
      await expect(html).toHaveAttribute('data-theme', 'claro');
    }
  });

  test('sin responder al aviso, el modo elegido sigue en todas las secciones del panel', async ({ page }) => {
    await login(page, 'propietaria@e2e.test', '/panel');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'claro');
    await page.getByRole('button', { name: 'Modo oscuro' }).click();
    for (const path of ['/panel/ordenes', '/panel/clientes', '/panel/equipo', '/panel/avisos', '/cuenta', '/panel']) {
      await page.goto(path);
      await expect(html, path).toHaveAttribute('data-theme', 'oscuro');
    }
  });
});

test.describe('aviso de cookies sin JavaScript', () => {
  test.use({ javaScriptEnabled: false, storageState: { cookies: [], origins: [] } });
  test('el formulario guarda la respuesta y vuelve a la misma página', async ({ page }) => {
    await page.goto('/cookies');
    await page.getByRole('region', { name: 'Cookies' }).getByRole('button', { name: 'Aceptar' }).click();
    await expect(page).toHaveURL(/\/cookies$/);
    await expect(page.locator('[data-cookie-bar]')).toHaveCount(0);
    await expect(page.locator('.consent-choice')).toContainText('Aceptadas');
    // Con las cookies aceptadas, el modo elegido sin JavaScript se recuerda.
    await page.getByRole('button', { name: 'Modo claro' }).first().click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');
  });
});

test.describe('modo claro y oscuro sin JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('el botón guarda el modo y vuelve a la misma página', async ({ page }) => {
    await page.goto('/cookies');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'oscuro');
    await page.getByRole('button', { name: 'Modo claro' }).first().click();
    await expect(page).toHaveURL(/\/cookies$/);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');
  });
});

test('todos los tamaños (móvil, tablet y PC, en vertical y horizontal): nada se sale de la pantalla', async ({ browser, isMobile }) => {
  test.skip(isMobile, 'Los tamaños se fijan a mano');
  test.setTimeout(240_000);
  const f = await fixtures();
  const sizes = [[320, 568], [360, 740], [412, 915], [740, 360], [768, 1024], [1024, 768], [1180, 820], [1366, 768], [1920, 1080]] as const;
  const problems: string[] = [];
  const check = async (page: Page, paths: string[]) => {
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      for (const path of paths) {
        await page.goto(path);
        const r = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const out = [...document.querySelectorAll('[data-theme-toggle], .pnl-top button, .auth-top a, .auth-top button, .pm-header a, .pm-menu')]
            .filter(el => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
            .filter(el => { const b = el.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; })
            .map(el => (el.textContent ?? '').trim().slice(0, 30));
          return { overflow: document.documentElement.scrollWidth - vw, out };
        });
        if (r.overflow > 0) problems.push(`${w}×${h} ${path}: desborda ${r.overflow}px`);
        for (const o of r.out) problems.push(`${w}×${h} ${path}: «${o}» fuera de la pantalla`);
        const pick = page.locator('[data-color-pick] > summary');
        if (await pick.count()) {
          await pick.click();
          const box = await page.locator('.color-pick-menu').boundingBox();
          if (!box || box.x < 0 || box.x + box.width > w + 1) problems.push(`${w}×${h} ${path}: el menú de colores se sale (${JSON.stringify(box)})`);
          await pick.click();
        }
      }
    }
  };
  for (const tema of ['oscuro', 'claro']) {
    const ctx = await acceptCookies(await browser.newContext({ baseURL: `http://${HOST}` }));
    await ctx.addCookies([{ name: 'tema', value: tema, url: `http://${HOST}` }]);
    const page = await ctx.newPage();
    await check(page, ['/', '/acceso']);
    await login(page, 'propietaria@e2e.test', '/panel');
    await check(page, ['/panel', `/panel/ordenes/${f.order}`, '/cuenta']);
    await ctx.clearCookies(); await acceptCookies(ctx);
    await ctx.addCookies([{ name: 'tema', value: tema, url: `http://${HOST}` }]);
    await login(page, f.email, '/portal');
    await check(page, ['/portal', '/portal/datos', '/cuenta']);
    await ctx.close();
  }
  expect(problems, problems.join('\n')).toEqual([]);
});

test('portal en cada color pastel: contraste y accesibilidad', async ({ page, context, isMobile }) => {
  test.skip(isMobile, 'El contraste se comprueba en escritorio');
  test.setTimeout(240_000);
  const f = await fixtures();
  await login(page, f.email, '/portal');
  for (const c of PANEL_COLORS.filter(x => x.id !== DEFAULT_PANEL_COLOR)) {
    await context.addCookies([{ name: 'color_panel', value: c.id, url: page.url() }]);
    await audit(page, ['/portal', `/portal/reparaciones/${f.order}`, '/portal/vehiculos', '/portal/datos'], false);
  }
});

test('color del panel: se aplica al momento, se recuerda y un valor inventado se ignora', async ({ page, context }) => {
  await login(page, 'propietaria@e2e.test', '/panel');
  await expect(page.locator('html')).toHaveAttribute('data-color', DEFAULT_PANEL_COLOR);
  await page.getByRole('button', { name: 'Color del panel' }).or(page.locator('[data-color-pick] > summary')).first().click();
  await page.getByRole('button', { name: 'Lavanda' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-color', 'lavanda');
  // El menú se cierra al elegir; la opción queda marcada como la actual.
  await expect(page.locator('.color-pick-option[value="lavanda"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-color', 'lavanda');
  // La tarjeta cambia de verdad de color y su texto pasa a oscuro.
  const card = page.locator('.kpi').first();
  expect(await card.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(227, 220, 244)');
  expect(await card.evaluate(el => getComputedStyle(el).color)).toBe('rgb(28, 30, 29)');
  // Un valor manipulado en la cookie no rompe nada: vuelve al predeterminado.
  await context.addCookies([{ name: 'color_panel', value: '"><script>', url: page.url() }]);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-color', DEFAULT_PANEL_COLOR);
});

test.describe('color del panel sin JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('el formulario guarda el color y vuelve a la misma página', async ({ page }) => {
    await login(page, 'propietaria@e2e.test', '/panel');
    await page.goto('/panel/ordenes');
    await page.locator('[data-color-pick] > summary').click();
    await page.getByRole('button', { name: 'Melocotón' }).click();
    await expect(page).toHaveURL(/\/panel\/ordenes$/);
    await expect(page.locator('html')).toHaveAttribute('data-color', 'melocoton');
  });
});

test('portal del cliente: accesibilidad, consola y móvil', async ({ page, isMobile }) => {
  const f = await fixtures();
  await login(page, f.email, '/portal');
  await audit(page, ['/portal', '/portal/vehiculos', '/portal/reparaciones', `/portal/reparaciones/${f.order}`, '/portal/avisos', '/portal/datos', '/portal/presupuestos', '/portal/facturas', '/portal/vehiculos/nuevo', '/portal/vehiculos/papelera', `/portal/vehiculos/${f.vehicle}`, '/portal/talleres'], isMobile);
});

test('portal: el modo elegido se mantiene al cambiar de sección, sin parpadeos', async ({ page, isMobile }) => {
  const f = await fixtures();
  await login(page, f.email, '/portal');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'claro');
  await page.getByRole('button', { name: 'Modo oscuro' }).click();
  await expect(html).toHaveAttribute('data-theme', 'oscuro');
  // Cada cambio de modo durante la navegación queda anotado: no puede volver a «claro» ni un instante.
  await page.evaluate(() => {
    const log: string[] = ((window as unknown as { __modos: string[] }).__modos = []);
    new MutationObserver(() => log.push(document.documentElement.dataset.theme ?? '')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
  const nav = isMobile ? page.locator('.pnl-tabs') : page.getByRole('complementary', { name: 'Menú del portal' });
  for (const [name, path] of [['Mis vehículos', '/portal/vehiculos'], ['Reparaciones', '/portal/reparaciones'], ['Inicio', '/portal']] as const) {
    const link = nav.getByRole('link', { name, exact: true });
    if (await link.count()) await link.first().click(); else await page.goto(path);
    await page.waitForURL(u => u.pathname === path);
    await expect(html, name).toHaveAttribute('data-theme', 'oscuro');
  }
  const modos = await page.evaluate(() => (window as unknown as { __modos?: string[] }).__modos ?? []);
  expect(modos.filter(m => m !== 'oscuro'), `cambios de modo: ${modos.join(', ')}`).toEqual([]);
  // También al cargar de cero (lo pinta el servidor).
  for (const path of ['/portal/vehiculos', '/portal/datos', '/portal']) {
    await page.goto(path);
    await expect(html, path).toHaveAttribute('data-theme', 'oscuro');
  }
});

test('cabeceras de seguridad en la web pública y en el área privada', async () => {
  for (const path of ['/', '/acceso', '/panel', '/api/notificaciones/procesar']) {
    const r = await fetch(`${WEB}${path}`, { headers: { host: HOST }, redirect: 'manual' });
    const h = r.headers;
    expect(h.get('x-content-type-options'), `${path} nosniff`).toBe('nosniff');
    expect(h.get('content-security-policy') ?? '', `${path} CSP`).toContain("frame-ancestors 'none'");
    expect(h.get('content-security-policy') ?? '', `${path} CSP scripts`).toMatch(/script-src 'self' https:\/\/challenges\.cloudflare\.com 'sha256-/);
    expect(h.get('content-security-policy') ?? '', `${path} CSP sin unsafe`).not.toMatch(/unsafe-(inline|eval)/);
    expect(h.get('permissions-policy') ?? '', `${path} permisos`).toContain('camera=()');
    expect(h.get('referrer-policy'), `${path} referrer`).toBeTruthy();
  }
  const priv = await fetch(`${WEB}/acceso`, { headers: { host: HOST } });
  expect(priv.headers.get('cache-control')).toContain('no-store');
});

test('CSP: los scripts en línea propios funcionan y uno inyectado no se ejecuta', async ({ page, context }) => {
  const violations: string[] = [];
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await context.addCookies([{ name: 'tema', value: 'claro', url: `http://${HOST}` }]);
  await page.goto('/');
  // El script del modo (en línea, con huella) ha funcionado y el de la web pública también.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'claro');
  await expect(page.locator('html')).toHaveClass(/pm-js/);
  expect(violations, 'ningún script propio bloqueado').toEqual([]);
  // Un script inyectado (como haría un ataque XSS) queda bloqueado.
  const ran = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__inyectado = true';
    document.body.append(s);
    await new Promise(r => setTimeout(r, 100));
    return (window as unknown as { __inyectado?: boolean }).__inyectado === true;
  });
  expect(ran).toBe(false);
});

test('página 404: responde 404, explica qué pasa, ofrece salidas y cumple accesibilidad en los dos modos', async ({ page, context, isMobile }) => {
  for (const tema of ['oscuro', 'claro']) {
    await context.addCookies([{ name: 'tema', value: tema, url: `http://${HOST}` }]);
    const res = await page.goto('/esta-pagina-no-existe');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Esta página no existe');
    await expect(page.locator('.nf-path')).toHaveText('/esta-pagina-no-existe');
    await expect(page.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'Entra en tu área' })).toHaveAttribute('href', '/acceso');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    if (!isMobile) {
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${tema}: ${v.id}`)).toEqual([]);
    }
  }
  // Una dirección del área privada que no existe también responde 404.
  expect((await page.goto('/panel/no-existe'))?.status()).toBe(404);
});

test('teclado: el primer Tab lleva a «Saltar al contenido» en panel y portal', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Teclado: escritorio');
  const f = await fixtures();
  await login(page, 'propietaria@e2e.test', '/panel');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Saltar al contenido');
  await page.context().clearCookies(); await acceptCookies(page.context());
  await login(page, f.email, '/portal');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Saltar al contenido');
});
