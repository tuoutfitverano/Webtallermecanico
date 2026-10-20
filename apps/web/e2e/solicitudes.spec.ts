/**
 * Formularios de la web del taller contra una base de datos REAL
 * (PostgreSQL + RLS a través de la API REST, igual que en Supabase).
 */
import { expect, test, type Page } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const REST = process.env.E2E_REST_URL ?? '';
const PROXY = process.env.E2E_PROXY_URL ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const DEMO_WORKSHOP = 'd0000000-0000-0000-0000-000000000001';
// Node no resuelve *.localhost (el navegador sí): las llamadas directas a la API
// van a 127.0.0.1 con la cabecera Host del taller de demostración.
const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:4329';
const HOST = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:4329').host;

test.skip(!REST || !SERVICE, 'Lanza estas pruebas con scripts/test-e2e.sh');

/** Lee solicitudes directamente de la base de datos (con la clave del sistema). */
async function rowsNamed(name: string) {
  const res = await fetch(`${REST}/web_requests?name=eq.${encodeURIComponent(name)}&select=*`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Array<Record<string, unknown>>;
}

async function simulateBackendDown(down: boolean) {
  await fetch(`${PROXY}/__mode`, { method: 'POST', body: JSON.stringify({ fail: down }) });
}

let ipCounter = 0;
/** Cada prueba simula un visitante distinto: el límite de envíos es por IP. */
const visitorIp = () => `203.0.113.${(++ipCounter % 250) + 1}`;

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': visitorIp() });
});

const unique = (label: string) => `E2E ${label} ${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function openTab(page: Page, label: 'Pedir cita' | 'Pedir presupuesto' | 'Contacto') {
  await page.goto('/#solicitar');
  await page.getByRole('tab', { name: label }).click();
}

test.describe('Solicitud de cita', () => {
  test('se guarda como pendiente y solo entonces se confirma', async ({ page }) => {
    const name = unique('Cita');
    await openTab(page, 'Pedir cita');
    const form = page.locator('#solicitar-cita');
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('Teléfono').fill('600 123 456');
    await form.getByLabel('Servicio').selectOption({ label: 'Frenos' });
    await form.getByLabel('Matrícula').fill('1950 bxf');
    await form.getByLabel('Marca').fill('Volkswagen');
    await form.getByLabel('Modelo').fill('Golf');
    await form.getByLabel('Descripción del problema').fill('Ruido metálico al frenar');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();

    const success = form.getByRole('heading', { name: 'Solicitud de cita recibida' });
    await expect(success).toBeVisible();
    await expect(form.getByText('Hasta entonces no está reservada')).toBeVisible();
    const reference = (await form.locator('[data-success-ref]').textContent())?.trim();

    const rows = await rowsNamed(name);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      workshop_id: DEMO_WORKSHOP,
      kind: 'cita',
      status: 'nueva',
      plate: '1950BXF',
      vehicle_make: 'Volkswagen',
      vehicle_model: 'Golf',
      service: 'frenos',
      phone: '600 123 456',
    });
    expect(String(row.id).replace(/-/g, '').slice(0, 8).toUpperCase()).toBe(reference);
  });

  test('doble clic en Enviar no crea dos solicitudes', async ({ page }) => {
    const name = unique('Doble');
    await openTab(page, 'Pedir cita');
    const form = page.locator('#solicitar-cita');
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('Correo electrónico').fill('doble@example.com');
    await form.getByLabel('Servicio').selectOption({ label: 'Neumáticos' });
    await form.getByRole('checkbox').check();
    // Dos envíos seguidos sin esperar a la respuesta.
    await form.locator('form').evaluate((f: HTMLFormElement) => { f.requestSubmit(); f.requestSubmit(); });
    await expect(form.getByRole('heading', { name: 'Solicitud de cita recibida' })).toBeVisible();
    expect(await rowsNamed(name)).toHaveLength(1);
  });

  test('si el backend falla NO se muestra éxito ni se guarda; al reintentar se guarda una vez', async ({ page }) => {
    const name = unique('Caida');
    await openTab(page, 'Pedir cita');
    const form = page.locator('#solicitar-cita');
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('Teléfono').fill('611 222 333');
    await form.getByLabel('Servicio').selectOption({ label: 'Distribución' });
    await form.getByRole('checkbox').check();

    await simulateBackendDown(true);
    try {
      await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();
      await expect(form.getByRole('alert')).toContainText('No se ha guardado');
      await expect(form.getByRole('heading', { name: 'Solicitud de cita recibida' })).toBeHidden();
      // El panel de éxito entero (no solo su título) sigue oculto.
      await expect(form.locator('[data-success]')).toBeHidden();
      await expect(form.getByLabel('Nombre')).toHaveValue(name); // los datos se conservan
    } finally {
      await simulateBackendDown(false);
    }
    expect(await rowsNamed(name)).toHaveLength(0);

    await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();
    await expect(form.getByRole('heading', { name: 'Solicitud de cita recibida' })).toBeVisible();
    expect(await rowsNamed(name)).toHaveLength(1);
  });

  test('al cargar la página ningún formulario muestra "recibido"', async ({ page }) => {
    await page.goto('/');
    for (const kind of ['cita', 'presupuesto', 'contacto']) {
      await expect(page.locator(`#solicitar-${kind} [data-success]`)).toBeHidden();
    }
  });

  test('valida en el navegador sin llamar al servidor', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', r => { if (r.url().includes('/api/solicitudes')) calls.push(r.url()); });
    await openTab(page, 'Pedir cita');
    const form = page.locator('#solicitar-cita');
    await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();
    await expect(form.getByText('Escribe tu nombre.')).toBeVisible();
    await expect(form.getByText('Indica un teléfono o un correo')).toBeVisible();
    await expect(form.getByText('Elige el servicio que necesitas.')).toBeVisible();
    await expect(form.getByText('Debes aceptar la política de privacidad')).toBeVisible();
    await expect(form.getByLabel('Nombre')).toBeFocused();
    expect(calls).toHaveLength(0);
  });
});

test('presupuesto: se guarda con su descripción', async ({ page }) => {
  const name = unique('Presupuesto');
  await openTab(page, 'Pedir presupuesto');
  const form = page.locator('#solicitar-presupuesto');
  await form.getByLabel('Nombre').fill(name);
  await form.getByLabel('Teléfono').fill('622 333 444');
  await form.getByLabel('Servicio').selectOption({ label: 'Embrague' });
  await form.getByLabel('Describe qué le pasa al vehículo').fill('El embrague patina en marchas largas.');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Pedir presupuesto' }).click();
  await expect(form.getByRole('heading', { name: 'Solicitud de presupuesto recibida' })).toBeVisible();
  const [row] = await rowsNamed(name);
  expect(row).toMatchObject({ kind: 'presupuesto', status: 'nueva', service: 'embrague', preferred_date: null });
});

test('contacto: se guarda con su motivo y solo con correo', async ({ page }) => {
  const name = unique('Contacto');
  await openTab(page, 'Contacto');
  const form = page.locator('#solicitar-contacto');
  await form.getByLabel('Nombre').fill(name);
  await form.getByLabel('Correo electrónico').fill('Persona@Example.com');
  await form.getByLabel('Motivo del contacto').selectOption({ label: 'Información general' });
  await form.getByLabel('Mensaje').fill('¿Trabajáis con coches eléctricos?');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(form.getByRole('heading', { name: 'Mensaje recibido' })).toBeVisible();
  const [row] = await rowsNamed(name);
  expect(row).toMatchObject({ kind: 'contacto', topic: 'informacion', email: 'persona@example.com', phone: null, plate: null });
});

test.describe('Servidor y permisos', () => {
  test.skip(({ isMobile }) => isMobile, 'Pruebas de API: basta con ejecutarlas una vez');

  const valid = (over: Record<string, unknown> = {}) => ({
    kind: 'contacto', name: unique('API'), phone: '633 444 555', topic: 'otro', message: 'Consulta enviada directamente a la API.',
    privacyAccepted: true, idempotencyKey: crypto.randomUUID(), ...over,
  });

  const post = (request: import('@playwright/test').APIRequestContext, options: Parameters<import('@playwright/test').APIRequestContext['post']>[1] = {}) =>
    request.post(`${API}/api/solicitudes`, { ...options, headers: { host: HOST, 'cf-connecting-ip': visitorIp(), ...options.headers } });

  test('el servidor valida aunque alguien se salte el navegador', async ({ request }) => {
    const res = await post(request, { data: valid({ name: '', phone: '', topic: 'hackeo', privacyAccepted: false }) });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(Object.keys(body.fields).sort()).toEqual(['contact', 'name', 'privacyAccepted', 'topic']);
  });

  test('limita los envíos seguidos de un mismo visitante', async ({ request }) => {
    const headers = { 'cf-connecting-ip': '198.51.100.23' };
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(request, { data: valid(), headers })).status());
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    const other = await post(request, { data: valid(), headers: { 'cf-connecting-ip': '198.51.100.99' } });
    expect(other.status()).toBe(201);
  });

  test('rechaza envíos desde otra web', async ({ request }) => {
    const res = await post(request, { data: valid(), headers: { origin: 'https://malicioso.example' } });
    expect(res.status()).toBe(403);
  });

  test('funciona sin JavaScript (envío clásico de formulario)', async ({ request, baseURL }) => {
    const name = unique('SinJS');
    const res = await post(request, {
      form: { kind: 'contacto', name, phone: '644 555 666', topic: 'otro', message: 'Enviado sin JavaScript.', privacyAccepted: 'on', idempotencyKey: crypto.randomUUID() },
      headers: { origin: baseURL! },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(303);
    expect(res.headers().location).toMatch(/solicitud=ok&ref=[A-Z0-9]{8}#solicitar$/);
    expect(await rowsNamed(name)).toHaveLength(1);
  });

  test('un visitante anónimo NO puede leer ni escribir solicitudes en la API', async () => {
    const anon = { apikey: ANON, authorization: `Bearer ${ANON}` };
    const read = await fetch(`${REST}/web_requests?select=*`, { headers: anon });
    expect(read.status).not.toBe(200);
    const write = await fetch(`${REST}/web_requests`, {
      method: 'POST', headers: { ...anon, 'content-type': 'application/json' },
      body: JSON.stringify({ workshop_id: DEMO_WORKSHOP, kind: 'contacto', name: 'Directo', phone: '600', privacy_accepted_at: new Date().toISOString() }),
    });
    expect(write.status).not.toBe(201);
    const rpc = await fetch(`${REST}/rpc/submit_web_request`, {
      method: 'POST', headers: { ...anon, 'content-type': 'application/json' },
      body: JSON.stringify({ p_workshop_id: DEMO_WORKSHOP, p_request: { kind: 'contacto' }, p_idempotency_key: crypto.randomUUID(), p_client_hash: null }),
    });
    expect(rpc.status).not.toBe(200);
    // Lo único público: la web publicada del taller.
    const site = await fetch(`${REST}/rpc/get_public_site`, { method: 'POST', headers: { ...anon, 'content-type': 'application/json' }, body: JSON.stringify({ p_hostname: 'demo.localhost' }) });
    expect(site.status).toBe(200);
    expect((await site.json()).workshop.slug).toBe('taller-demo');
  });
});

test.describe('Bandeja de solicitudes en el panel (Fase 8)', () => {
  const PASSWORD = process.env.E2E_PASSWORD ?? '';
  test.skip(!PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');
  const login = async (page: Page, email: string, next: string) => {
    await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
    await page.getByLabel('Correo electrónico').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(u => u.pathname === next);
  };

  test('la solicitud enviada desde la web llega al panel y el taller cambia su estado', async ({ page, browser }) => {
    const name = unique('Bandeja');
    await openTab(page, 'Pedir presupuesto');
    const form = page.locator('#solicitar-presupuesto');
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('Teléfono').fill('633 444 555');
    await form.getByLabel('Servicio').selectOption({ label: 'Embrague' });
    await form.getByLabel('Describe qué le pasa al vehículo').fill('Patina al acelerar.');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Pedir presupuesto' }).click();
    await expect(form.getByRole('heading', { name: 'Solicitud de presupuesto recibida' })).toBeVisible();

    const owner = await (await acceptCookies(await browser.newContext())).newPage();
    await login(owner, 'propietaria@e2e.test', '/panel');
    await expect(owner.locator('.kpi', { hasText: 'Solicitudes web sin atender' })).toBeVisible();
    await owner.goto('/panel/solicitudes');
    const item = owner.getByRole('listitem').filter({ hasText: name });
    await expect(item).toContainText('Solicitud de presupuesto');
    await expect(item).toContainText('633 444 555');
    await item.getByLabel(`Estado de la solicitud de ${name}`).selectOption('en_gestion');
    await item.getByRole('button', { name: 'Cambiar estado' }).click();
    await expect(owner.getByRole('status')).toContainText('En gestión');
    expect((await rowsNamed(name))[0]).toMatchObject({ status: 'en_gestion' });
    await owner.context().close();

    // Un mecánico no ve las solicitudes (ni en la página ni por la API).
    const mech = await (await acceptCookies(await browser.newContext())).newPage();
    await login(mech, 'mecanico@e2e.test', '/panel');
    await mech.goto('/panel/solicitudes');
    await expect(mech.getByText('Solo el propietario o un administrador ven las solicitudes de la web.')).toBeVisible();
    await expect(mech.locator('body')).not.toContainText(name);
    await mech.context().close();
  });
});
