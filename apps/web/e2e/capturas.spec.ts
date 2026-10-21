/**
 * Capturas de pantalla para enseñar cada fase (no es una prueba).
 * Solo se ejecuta con CAPTURAS_DIR=<carpeta>: npm run test:e2e -- e2e/capturas.spec.ts
 * La consulta por matrícula usa el proveedor SIMULADO de las pruebas.
 */
import { expect, test, type Page } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const DIR = process.env.CAPTURAS_DIR ?? '';
const PROXY = process.env.E2E_PROXY_URL ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!DIR || !PROXY, 'Solo para generar capturas (CAPTURAS_DIR)');

async function token(email: string) {
  const r = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return ((await r.json()) as { access_token: string }).access_token;
}
async function post(path: string, tok: string, body: unknown) {
  const r = await fetch(`${PROXY}/rest/v1${path}`, { method: path.includes('/rpc/') ? 'POST' : 'POST', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body) });
  return (await r.json()) as Array<Record<string, string>>;
}
async function patch(path: string, tok: string, body: unknown) {
  await fetch(`${PROXY}/rest/v1${path}`, { method: 'PATCH', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function login(page: Page, email: string, next: string) {
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === next.split('?')[0]);
}

test('capturas de las fases 5 y 6', async ({ page, browser, isMobile }) => {
  test.setTimeout(120_000);
  const sfx = isMobile ? 'movil' : 'escritorio';
  const owner = await token('propietaria@e2e.test');
  const email = `lucia-${Date.now()}@e2e.test`;
  const [c] = await post('/customers', owner, { workshop_id: DEMO, full_name: 'Lucía Fernández', email, phone: '600 123 456' });
  const plate = `${Math.floor(1000 + Math.random() * 8999)}LMN`;
  const [v] = await post('/vehicles', owner, { workshop_id: DEMO, customer_id: c!.id, plate, make: 'Seat', model: 'León', year: 2019, year_kind: 'primera_matriculacion', fuel: 'gasolina' });
  const [v2] = await post('/vehicles', owner, { workshop_id: DEMO, customer_id: c!.id, plate: `${Math.floor(1000 + Math.random() * 8999)}KPR`, make: 'Toyota', model: 'Yaris', year: 2021, year_kind: 'primera_matriculacion', fuel: 'hibrido' });
  const [o] = await post('/repair_orders', owner, { workshop_id: DEMO, vehicle_id: v!.id, customer_id: c!.id, problem_description: 'Ruido al frenar y revisión de los 60.000 km', diagnosis: 'Pastillas y discos delanteros desgastados', work_done: 'Cambio de pastillas y discos delanteros; revisión completa', internal_notes: 'Nota interna' });
  await post('/repair_orders', owner, { workshop_id: DEMO, vehicle_id: v2!.id, customer_id: c!.id, problem_description: 'Testigo de motor encendido' });
  await patch(`/repair_orders?id=eq.${o!.id}`, owner, { status: 'diagnosis', customer_notes: 'Hemos revisado el coche: hay que cambiar pastillas y discos.' });
  await patch(`/repair_orders?id=eq.${o!.id}`, owner, { status: 'listo', customer_notes: 'Ya puedes pasar a recogerlo.', show_details_to_customer: true });
  await fetch(`${PROXY}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: 'Lucía Fernández' } }) });
  const [inv] = await post('/rpc/create_customer_invitation', owner, { p_customer_id: c!.id });
  await post('/rpc/accept_customer_invitation', await token(email), { p_token: inv!.token });

  // Fase 5 · portal del cliente
  const client = await (await acceptCookies(await browser.newContext({ ...(isMobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 860 } }), locale: 'es-ES', timezoneId: 'Europe/Madrid' }))).newPage();
  await login(client, email, '/portal');
  await client.screenshot({ path: `${DIR}/f5-portal-inicio-${sfx}.png`, fullPage: true });
  await client.goto(`/portal/reparaciones/${o!.id}`);
  await client.screenshot({ path: `${DIR}/f5-portal-reparacion-${sfx}.png`, fullPage: true });
  if (isMobile) return;
  await client.goto('/portal/reparaciones');
  await client.screenshot({ path: `${DIR}/f5-portal-reparaciones-${sfx}.png`, fullPage: true });

  await login(page, 'propietaria@e2e.test', `/panel/clientes/${c!.id}`);
  await page.screenshot({ path: `${DIR}/f5-panel-acceso-portal-${sfx}.png`, fullPage: true });

  // Fase 6 · consulta por matrícula (proveedor simulado)
  await page.goto('/panel/vehiculos/nuevo');
  await page.getByLabel('Matrícula', { exact: true }).fill('5776 CNS');
  await page.getByLabel('Modelo', { exact: true }).fill('A3 Sportback');
  await page.getByRole('button', { name: 'Consultar datos' }).click();
  await expect(page.getByRole('button', { name: 'Usar los datos marcados' })).toBeVisible();
  await page.screenshot({ path: `${DIR}/f6-consulta-revision-${sfx}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Usar los datos marcados' }).click();
  await expect(page.getByRole('status')).toContainText('Datos del proveedor pasados');
  await page.getByRole('button', { name: 'Guardar vehículo' }).click();
  await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
  await page.screenshot({ path: `${DIR}/f6-vehiculo-procedencia-${sfx}.png`, fullPage: true });
});

test('capturas de la fase 7', async ({ page, browser, isMobile }) => {
  test.setTimeout(120_000);
  const sfx = isMobile ? 'movil' : 'escritorio';
  const owner = await token('propietaria@e2e.test');
  await patch(`/workshop_notification_settings?workshop_id=eq.${DEMO}`, owner, { email_enabled: true, reply_to: 'taller@e2e.test' });
  const email = `marta-${Date.now()}@e2e.test`;
  const [c] = await post('/customers', owner, { workshop_id: DEMO, full_name: 'Marta Ruiz', email });
  await fetch(`${PROXY}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }) });
  const [inv] = await post('/rpc/create_customer_invitation', owner, { p_customer_id: c!.id });
  await post('/rpc/accept_customer_invitation', await token(email), { p_token: inv!.token });
  const [v] = await post('/vehicles', owner, { workshop_id: DEMO, customer_id: c!.id, plate: `${Math.floor(1000 + Math.random() * 8999)}MRT`, make: 'Renault', model: 'Clio', year: 2017, year_kind: 'primera_matriculacion' });
  const [o] = await post('/repair_orders', owner, { workshop_id: DEMO, vehicle_id: v!.id, customer_id: c!.id, problem_description: 'Cambio de aceite y filtros' });
  const [c2] = await post('/customers', owner, { workshop_id: DEMO, full_name: 'Jorge Díaz', email: `rechazo-${Date.now()}@e2e.test` });
  const [v2] = await post('/vehicles', owner, { workshop_id: DEMO, customer_id: c2!.id, plate: `${Math.floor(1000 + Math.random() * 8999)}JRD`, make: 'Ford', model: 'Focus', year: 2016, year_kind: 'primera_matriculacion' });
  const [o2] = await post('/repair_orders', owner, { workshop_id: DEMO, vehicle_id: v2!.id, customer_id: c2!.id, problem_description: 'Revisión' });

  await login(page, 'propietaria@e2e.test', `/panel/ordenes/${o!.id}`);
  for (const [id, label, msg] of [[o!.id, 'Esperando recambios', 'Hemos pedido el filtro; llega mañana.'], [o!.id, 'Listo para recoger', 'Ya puedes pasar a recogerlo.'], [o2!.id, 'Listo para recoger', '']] as const) {
    await page.goto(`/panel/ordenes/${id}`);
    if (msg) await page.getByLabel(/Mensaje para el cliente con el cambio de estado/).fill(msg);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Estado actualizado.');
  }
  if (!isMobile) {
    await page.goto('/panel/avisos?estado=todos&canal=email');
    await page.screenshot({ path: `${DIR}/f7-panel-avisos-${sfx}.png`, fullPage: true });
  }
  const client = await (await acceptCookies(await browser.newContext({ ...(isMobile ? { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 860 } }), locale: 'es-ES', timezoneId: 'Europe/Madrid' }))).newPage();
  await login(client, email, '/portal/avisos');
  await client.screenshot({ path: `${DIR}/f7-portal-avisos-${sfx}.png`, fullPage: true });
  if (!isMobile) {
    await client.goto('/portal/datos');
    await client.screenshot({ path: `${DIR}/f7-portal-preferencias-${sfx}.png`, fullPage: true });
  }
});

test('capturas de la fase 8', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Escritorio');
  await page.goto('/#solicitar');
  await page.getByRole('tab', { name: 'Pedir cita' }).click();
  const form = page.locator('#solicitar-cita');
  await form.getByLabel('Nombre').fill('Laura Gómez');
  await form.getByLabel('Teléfono').fill('611 222 333');
  await form.getByLabel('Servicio').selectOption({ index: 1 });
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();
  await expect(form.getByRole('heading', { name: /recibida/ })).toBeVisible();
  await page.goto('/cookies');
  await page.screenshot({ path: `${DIR}/f8-cookies-escritorio.png`, fullPage: true });
  await login(page, 'propietaria@e2e.test', '/panel');
  await page.screenshot({ path: `${DIR}/f8-panel-inicio-escritorio.png`, fullPage: true });
  await page.goto('/panel/solicitudes');
  await page.screenshot({ path: `${DIR}/f8-panel-solicitudes-escritorio.png`, fullPage: true });
});

test('capturas de la integración', async ({ page, isMobile }) => {
  const sfx = isMobile ? 'movil' : 'escritorio';
  await login(page, 'propietaria@e2e.test', '/panel/taller');
  await page.screenshot({ path: `${DIR}/int-taller-${sfx}.png`, fullPage: !isMobile });
  await page.goto('/panel/equipo');
  await page.screenshot({ path: `${DIR}/int-equipo-${sfx}.png`, fullPage: !isMobile });
  if (isMobile) {
    await page.locator('.pnl-tabs').getByText('Más', { exact: true }).click();
    await page.screenshot({ path: `${DIR}/int-menu-mas-${sfx}.png` });
  }
});
