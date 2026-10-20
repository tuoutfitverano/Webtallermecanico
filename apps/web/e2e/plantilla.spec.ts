/**
 * Plantilla de webs de taller: diseño premium configurable, demostración real
 * del software y sección comercial (solo en la web de demostración).
 * Base de datos real (PostgREST + RLS), como el resto de pruebas e2e.
 */
import { expect, test, type Page } from '@playwright/test';

const REST = process.env.E2E_REST_URL ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const BASE = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:4329');

test.skip(!REST || !SERVICE, 'Lanza estas pruebas con scripts/test-e2e.sh');

const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${REST}${path}`, {
    ...init,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers ?? {}) },
  });

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 20}` });
});

async function consoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

test('AutoValue: portada comercial, software con capturas reales y sin las fases internas', async ({ page }) => {
  const errors = await consoleErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/La mecánica evoluciona\.\s*Tu taller también\./);
  await expect(page.getByText('Precisión en cada reparación. Tecnología en cada proceso.')).toBeVisible();
  // La llamada principal es la comercial y lleva al formulario.
  await page.getByRole('link', { name: /Quiero digitalizar mi taller/ }).first().click();
  await expect(page.locator('#digitalizar')).toBeInViewport();
  // Las fases de construcción no se presentan como producto.
  await expect(page.getByText(/Ocho fases/i)).toHaveCount(0);
  await expect(page.locator('.pm-step')).toHaveCount(6);
  // Recorrido: cada pestaña enseña su captura real (y la imagen carga).
  const tabs = page.getByRole('tablist', { name: 'Pantallas del software' }).getByRole('tab');
  await expect(tabs).toHaveCount(8);
  for (let i = 0; i < 8; i++) {
    await tabs.nth(i).click();
    const panel = page.locator(`#${await tabs.nth(i).getAttribute('aria-controls')}`);
    await expect(panel).toBeVisible();
    await expect.poll(() => panel.locator('img').evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  // Teclado: flecha derecha en la última vuelve a la primera.
  await tabs.nth(7).press('ArrowRight');
  await expect(tabs.nth(0)).toBeFocused();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  // Lo que no es una agenda no se vende como agenda.
  await expect(page.locator('#digitalizar')).toContainText('Sin agenda');
  expect(errors).toEqual([]);
});

test('«Quiero digitalizar mi taller» guarda la solicitud y llega a la bandeja del taller demo', async ({ page }) => {
  await page.goto('/#digitalizar');
  const form = page.locator('#solicitar-digitalizacion');
  await form.getByRole('button', { name: 'Quiero digitalizar mi taller' }).click();
  await expect(form.getByText('Escribe el nombre de tu taller.')).toBeVisible();

  const name = `E2E Comercial ${Date.now()}`;
  await form.getByRole('textbox', { name: 'Nombre *', exact: true }).fill(name);
  await form.getByLabel('Nombre de tu taller').fill('Talleres Prueba');
  await form.getByLabel('Correo electrónico').fill('comercial@e2e.test');
  await form.getByLabel('¿Qué te interesa?').selectOption('software');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Quiero digitalizar mi taller' }).click();
  await expect(form.getByRole('heading', { name: 'Solicitud recibida' })).toBeVisible();
  await expect(form.getByText('No has contratado nada.')).toBeVisible();

  const rows = await (await admin(`/web_requests?name=eq.${encodeURIComponent(name)}&select=kind,status,business_name,topic,service,plate`)).json();
  expect(rows).toEqual([{ kind: 'digitalizacion', status: 'nueva', business_name: 'Talleres Prueba', topic: 'software', service: null, plate: null }]);

  // La propietaria del taller demo la ve en «Solicitudes web» con el nombre del taller.
  test.skip(!PASSWORD, 'Sin contraseña de pruebas');
  await page.goto('/acceso?next=%2Fpanel%2Fsolicitudes');
  await page.getByLabel('Correo electrónico').fill('propietaria@e2e.test');
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  const item = page.getByRole('listitem').filter({ hasText: name });
  await expect(item).toContainText('Digitalizar mi taller (comercial)');
  await expect(item).toContainText('Talleres Prueba');
  await expect(item).toContainText('Solo el software de gestión');
});

test('móvil: el menú se abre, se cierra con Escape y al elegir una sección', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Solo en móvil');
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menú', exact: true });
  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await expect(nav).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await menu.click();
  await nav.getByRole('link', { name: 'Proceso' }).click();
  await expect(nav).toBeHidden();
  await expect(page.locator('#proceso')).toBeInViewport();
});

test.describe('sin JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('todo el contenido se ve: menú, todas las pantallas y el formulario comercial', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    await expect(page.locator('.pm-tour-panel')).toHaveCount(8);
    for (const panel of await page.locator('.pm-tour-panel').all()) await expect(panel).toBeVisible();
    await expect(page.locator('#solicitar-digitalizacion form')).toBeVisible();
    await expect(page.locator('.pm-step').last()).toBeVisible();
  });
});

test.describe('otro taller con la misma plantilla', () => {
  const host = 'plantilla.localhost';
  let workshopId = '';

  test.beforeAll(async () => {
    // Un taller REAL (activo) configurado solo con lo mínimo y el diseño premium.
    // Intenta, además, activar la sección comercial: no debe servirle de nada.
    const [w] = await (await admin('/workshops', { method: 'POST', body: JSON.stringify({ slug: `plantilla-${Date.now()}`, name: 'Talleres Plantilla', status: 'activo' }) })).json();
    workshopId = w.id;
    await admin('/workshop_sites', { method: 'POST', body: JSON.stringify({
      workshop_id: workshopId, published: true, is_demo_content: false,
      theme: { design: 'premium', accent: '#3366CC', sections: { comercial: true } },
      content: { tagline: 'Taller de prueba', services: [{ id: 'frenos', name: 'Frenos' }], phone: '600 000 000' },
    }) });
    await admin('/workshop_domains', { method: 'POST', body: JSON.stringify({ hostname: host, workshop_id: workshopId, is_primary: true, verified_at: new Date().toISOString() }) });
  });

  test.afterAll(async () => {
    if (workshopId) await admin(`/workshops?id=eq.${workshopId}`, { method: 'DELETE' });
  });

  test('se ve completa, con su nombre y color, sin sección comercial ni diseño de comparación', async ({ page }) => {
    const errors = await consoleErrors(page);
    const url = `${BASE.protocol}//${host}:${BASE.port}`;
    await page.goto(`${url}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Talleres Plantilla');
    await expect(page.locator('html')).toHaveAttribute('style', /--accent:#3366CC/);
    await expect(page.locator('#digitalizar')).toHaveCount(0);
    await expect(page.locator('#solicitar')).toBeVisible();
    await expect(page.locator('.pm-hero-plain')).toBeVisible(); // sin fotogramas: fondo propio, sin huecos
    expect(errors).toEqual([]);
    // Y el servidor rechaza una solicitud de digitalización enviada a mano desde esa web.
    const status = await page.evaluate(async () => {
      const r = await fetch('/api/solicitudes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'digitalizacion', name: 'Colado', businessName: 'Taller Colado', email: 'x@e2e.test', topic: 'web', privacyAccepted: true, idempotencyKey: crypto.randomUUID() }),
      });
      return r.status;
    });
    expect(status).toBe(422);
    expect(await (await admin(`/web_requests?workshop_id=eq.${workshopId}&select=id`)).json()).toEqual([]);
    expect((await page.goto(`${url}/clasico`))?.status()).toBe(404);
  });
});
