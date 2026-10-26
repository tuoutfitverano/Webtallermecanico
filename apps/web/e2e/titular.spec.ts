/**
 * Cambio de titular de un vehículo vendido, con base de datos y Supabase Auth
 * REALES: el comprador lo pide desde su portal, el titular anterior contesta y
 * la oficina del taller lo confirma tras ver el permiso de circulación.
 */
import { expect, test, type Browser } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const AUTH = `${PROXY}/auth/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');
test.skip(({ isMobile }) => isMobile, 'El flujo se comprueba en escritorio');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
async function tokenFor(email: string) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return ((await res.json()) as { access_token: string }).access_token;
}
async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as Array<Record<string, string>>;
}
/** Cliente del taller demo con cuenta vinculada (creado por la propietaria con su token: RLS). */
async function linkedCustomer(owner: string, name: string) {
  const email = `titular-${stamp()}@e2e.test`;
  const [c] = await api('/customers', owner, 'POST', { workshop_id: DEMO, full_name: name, email });
  await fetch(`${AUTH}/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const [inv] = await api('/rpc/create_customer_invitation', owner, 'POST', { p_customer_id: c!.id });
  await api('/rpc/accept_customer_invitation', await tokenFor(email), 'POST', { p_token: inv!.token });
  return { id: c!.id!, email };
}
async function session(browser: Browser, email: string, next: string) {
  const context = await acceptCookies(await browser.newContext({ locale: 'es-ES' }));
  const page = await context.newPage();
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === next);
  return { page, close: () => context.close() };
}

test('el comprador pide el cambio, el vendedor dice que no y la oficina lo confirma con el permiso de circulación', async ({ browser }) => {
  test.setTimeout(150_000);
  const owner = await tokenFor('propietaria@e2e.test');
  const seller = await linkedCustomer(owner, 'Víctor Vendedor');
  const buyer = await linkedCustomer(owner, 'Carla Compradora');
  const plate = `${Math.floor(1000 + Math.random() * 9000)}TTL`;
  const [v] = await api('/vehicles', owner, 'POST', { workshop_id: DEMO, customer_id: seller.id, plate, make: 'Seat', model: 'Ibiza', year: 2017, year_kind: 'fabricacion' });

  // 1. La compradora intenta añadirlo: ya está en el taller → pide el cambio.
  const b = await session(browser, buyer.email, '/portal/vehiculos/nuevo');
  await b.page.getByLabel('Matrícula').fill(plate);
  await b.page.getByLabel('Marca').fill('Seat');
  await b.page.getByLabel('Modelo').fill('Ibiza');
  await b.page.getByLabel('Año', { exact: true }).fill('2017');
  await b.page.getByLabel('Ese año es de…').selectOption('fabricacion');
  await b.page.getByRole('button', { name: 'Añadir vehículo' }).click();
  await b.page.getByRole('button', { name: 'Este coche ahora es mío: pedir el cambio' }).click();
  await b.page.waitForURL(u => u.pathname === '/portal/vehiculos');
  await expect(b.page.getByRole('status')).toContainText('Petición enviada');
  await expect(b.page.getByRole('region', { name: 'Cambios de titular que has pedido' })).toContainText('Pendiente');
  await expect(b.page.locator('.vcard', { hasText: 'Ibiza' })).toHaveCount(0);

  // 2. El vendedor contesta que NO lo ha vendido: no se hace solo.
  const s = await session(browser, seller.email, '/portal/vehiculos');
  const ask = s.page.getByRole('region', { name: '¿Has vendido tu Seat Ibiza?' });
  await expect(ask).not.toContainText('Carla');
  await ask.getByRole('button', { name: 'No lo he vendido' }).click();
  await expect(s.page.getByRole('status')).toContainText('El taller lo revisará');

  // 3. Un mecánico no ve nada del titular.
  const m = await session(browser, 'mecanico@e2e.test', '/panel');
  await m.page.goto(`/panel/vehiculos/${v!.id}`);
  await expect(m.page.getByRole('region', { name: 'Titular' })).toHaveCount(0);
  await m.close();

  // 4. La oficina lo ve pendiente, con el «no» del vendedor, y comprueba el permiso.
  const o = await session(browser, 'propietaria@e2e.test', '/panel/vehiculos');
  await o.page.getByRole('region', { name: 'Cambios de titular por comprobar' }).getByRole('link', { name: new RegExp(plate.slice(0, 4)) }).click();
  const card = o.page.getByRole('region', { name: 'Titular' });
  await expect(card).toContainText('Carla Compradora pide ponerlo a su nombre');
  await expect(card).toContainText('NO lo ha vendido');
  await card.getByRole('button', { name: 'Confirmar el cambio' }).click();
  await expect(o.page.getByRole('alert')).toContainText('Indica qué documento has comprobado');
  await o.page.getByRole('region', { name: 'Titular' }).getByLabel('El permiso de circulación a su nombre').check();
  await o.page.getByRole('region', { name: 'Titular' }).getByRole('button', { name: 'Confirmar el cambio' }).click();
  await expect(o.page.getByRole('status')).toContainText('Titular cambiado');
  await expect(o.page.getByRole('region', { name: 'Titular' })).toContainText('A nombre de Carla Compradora');
  await expect(o.page.getByRole('list', { name: 'Historial de titulares' })).toContainText('permiso de circulación a su nombre');
  // Ya con titular, el cliente no se cambia al editar los datos.
  await expect(o.page.getByLabel('Cliente', { exact: true })).toHaveAttribute('readonly', '');
  await o.close();

  // 5. Ahora es de la compradora; el vendedor deja de verlo.
  await b.page.reload();
  await expect(b.page.locator('.vcard', { hasText: 'Ibiza' })).toHaveCount(1);
  await expect(b.page.getByRole('region', { name: 'Cambios de titular que has pedido' })).toContainText('Hecho');
  await s.page.reload();
  await expect(s.page.locator('.vcard', { hasText: 'Ibiza' })).toHaveCount(0);
  await b.close();
  await s.close();
});
