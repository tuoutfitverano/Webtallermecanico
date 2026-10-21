/**
 * PRUEBA DE ACEPTACIÓN del flujo esencial, de principio a fin, con Supabase
 * Auth y base de datos REALES (scripts/test-e2e.sh):
 *
 *   cliente → vehículo → orden de reparación → cambios de estado (oficina y
 *   mecánico) → historial → consulta del cliente en su portal, viendo SOLO lo
 *   autorizado, y nadie más (otro cliente, otro taller) puede verla.
 *
 * Todo se hace desde las pantallas, salvo vincular la cuenta del cliente (ese
 * paso, con correo e invitación, ya lo cubre portal.spec.ts) y las
 * comprobaciones de acceso por API.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const INTERNAL = 'NOTA-INTERNA-ACEPTACION-NO-VISIBLE';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');
test.describe.configure({ mode: 'serial' });

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
function newPlate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  const n = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  return { typed: `${n}-${l.toLowerCase()}`, display: `${n} ${l}` };
}

async function login(page: Page, email: string, next: string) {
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}
async function freshPage(browser: Browser) {
  return (await acceptCookies(await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' }))).newPage();
}
async function tokenFor(email: string) {
  const r = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  return ((await r.json()) as { access_token: string }).access_token;
}
async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await fetch(`${REST}${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : null) as unknown };
}
const rows = (r: { json: unknown }) => (Array.isArray(r.json) ? r.json : []) as Array<Record<string, unknown>>;
async function createAccount(email: string, name: string) {
  const r = await fetch(`${PROXY}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } }),
  });
  expect(r.status).toBeLessThan(300);
  return tokenFor(email);
}

test('flujo esencial: cliente → vehículo → orden → estados → historial → portal del cliente', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const name = `Cliente Aceptación ${stamp()}`;
  const email = `aceptacion-${stamp()}@e2e.test`;
  const plate = newPlate();

  // 1. Oficina: cliente, vehículo y orden asignada al mecánico, desde las pantallas.
  await login(page, 'propietaria@e2e.test', '/panel');
  await page.goto('/panel/clientes/nuevo');
  await page.getByLabel('Nombre completo o nombre comercial').fill(name);
  await page.getByLabel(/Correo electrónico/).fill(email);
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(page.getByRole('status')).toContainText('Cliente guardado.');
  const customerId = page.url().replace(/\?.*$/, '').split('/').pop()!;

  await page.getByRole('link', { name: 'Registrar vehículo' }).click();
  await page.getByLabel('Matrícula').fill(plate.typed);
  await page.getByLabel('Marca').fill('Opel');
  await page.getByLabel('Modelo').fill('Astra');
  await page.getByLabel(/^Año/).fill('2017');
  await page.getByLabel(/Ese año es de/).selectOption('fabricacion');
  await page.getByRole('button', { name: 'Guardar vehículo' }).click();
  await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
  await expect(page.locator('.pnl-title')).toContainText(plate.display);

  await page.getByRole('link', { name: 'Nueva orden' }).click();
  await page.getByLabel(/Mecánico asignado/).selectOption({ label: 'Marcos Mecánico · Mecánico/a' });
  await page.getByLabel(/Descripción del problema/).fill('Vibración al frenar a más de 80 km/h');
  await page.getByRole('button', { name: 'Crear orden' }).click();
  await expect(page.getByRole('status')).toContainText('Orden creada.');
  const orderUrl = page.url().replace(/\?.*$/, '');
  const orderId = orderUrl.split('/').pop()!;
  await expect(page.locator('.status').first()).toHaveText('Vehículo recibido');

  // 2. Mecánico: diagnostica y deja una nota interna.
  const mech = await freshPage(browser);
  await login(mech, 'mecanico@e2e.test', '/panel');
  await mech.goto(orderUrl);
  await mech.getByRole('button', { name: 'En diagnosis' }).click();
  await expect(mech.getByRole('status')).toContainText('Estado actualizado.');
  await mech.getByLabel('Diagnosis', { exact: true }).fill('Discos delanteros alabeados');
  await mech.getByRole('textbox', { name: 'Notas internas' }).fill(INTERNAL);
  await mech.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(mech.getByRole('status')).toContainText('Cambios guardados.');
  // El mecánico no puede entregar.
  await expect(mech.getByRole('button', { name: 'Entregado' })).toHaveCount(0);

  // 3. Oficina: avanza el estado con mensaje y autoriza ver la diagnosis.
  await page.goto(orderUrl);
  await page.getByLabel(/Mensaje para el cliente con el cambio de estado/).fill('Ya tenemos los discos; empezamos hoy.');
  await page.getByRole('button', { name: 'En reparación' }).click();
  await expect(page.getByRole('status')).toContainText('Estado actualizado.');
  await page.getByLabel(/Mostrar la diagnosis y el trabajo realizado al cliente/).check();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByRole('status')).toContainText('Cambios guardados.');
  await page.getByRole('button', { name: 'Listo para recoger' }).click();
  await expect(page.getByRole('status')).toContainText('Estado actualizado.');

  // 4. Historial completo en el panel (orden, estados y quién).
  const timeline = page.locator('.timeline');
  await expect(timeline).toContainText('Orden creada y asignada a Marcos Mecánico');
  await expect(timeline).toContainText('Vehículo recibido → En diagnosis');
  await expect(timeline).toContainText('En diagnosis → En reparación');
  await expect(timeline).toContainText('En reparación → Listo para recoger');

  // 5. El cliente se vincula (cuenta + invitación) y consulta su reparación.
  const owner = await tokenFor('propietaria@e2e.test');
  const clientToken = await createAccount(email, name);
  const inv = await api('/rpc/create_customer_invitation', owner, 'POST', { p_customer_id: customerId });
  expect(inv.status, JSON.stringify(inv.json)).toBe(200);
  const acc = await api('/rpc/accept_customer_invitation', clientToken, 'POST', { p_token: rows(inv)[0]!.token });
  expect(acc.status, JSON.stringify(acc.json)).toBe(200);

  const client = await freshPage(browser);
  await login(client, email, '/portal');
  await client.goto('/portal/vehiculos');
  await expect(client.locator('.vcard', { hasText: 'Opel Astra' })).toContainText('Listo para recoger');
  await client.goto(`/portal/reparaciones/${orderId}`);
  await expect(client.locator('.pnl-title')).toContainText('Listo para recoger');
  await expect(client.locator('main')).toContainText('Discos delanteros alabeados'); // autorizado por el taller
  await expect(client.locator('.timeline')).toContainText('Ya tenemos los discos; empezamos hoy.');
  await expect(client.locator('body')).not.toContainText(INTERNAL);
  await expect(client.locator('body')).not.toContainText('Marcos Mecánico');

  // 6. Nadie más la ve: otro cliente del taller, ni por URL ni por API; otro taller tampoco.
  const otherEmail = `aceptacion-otro-${stamp()}@e2e.test`;
  const other = await api('/customers', owner, 'POST', { workshop_id: 'd0000000-0000-0000-0000-000000000001', full_name: 'Otro cliente', email: otherEmail });
  const otherToken = await createAccount(otherEmail, 'Otro cliente');
  const inv2 = await api('/rpc/create_customer_invitation', owner, 'POST', { p_customer_id: rows(other)[0]!.id });
  await api('/rpc/accept_customer_invitation', otherToken, 'POST', { p_token: rows(inv2)[0]!.token });
  expect(rows(await api('/rpc/portal_order', otherToken, 'POST', { p_order_id: orderId }))).toHaveLength(0);
  expect((await api(`/repair_orders?id=eq.${orderId}`, otherToken)).json).toEqual([]);
  const otherPage = await freshPage(browser);
  await login(otherPage, otherEmail, '/portal');
  await otherPage.goto(`/portal/reparaciones/${orderId}`);
  await expect(otherPage.locator('main')).not.toContainText('Opel');

  const foreign = await tokenFor('otro@e2e.test');
  expect((await api(`/repair_orders?id=eq.${orderId}`, foreign)).json).toEqual([]);
  expect((await api(`/repair_order_events?order_id=eq.${orderId}`, foreign)).json).toEqual([]);
  // Ni el propio cliente lee la tabla directamente (solo las funciones del portal).
  expect((await api(`/repair_orders?id=eq.${orderId}`, clientToken)).json).toEqual([]);

  // 7. Entrega (solo oficina) y queda en el historial del cliente.
  await page.getByRole('button', { name: 'Entregado' }).click();
  await expect(timeline).toContainText('Listo para recoger → Entregado');
  await client.goto('/portal/reparaciones?filtro=finalizadas');
  await expect(client.locator('main')).toContainText(plate.display);
});
