/**
 * Cuentas de cliente multitaller con base de datos y Supabase Auth REALES:
 * una sola cuenta vinculada por invitación a dos talleres (el demo y «Taller
 * Otro»), entrada desde la web del taller, «Mis talleres», cambio de taller,
 * intento de saltarse la elección con la URL y retirada del acceso.
 *
 * Lanza con scripts/test-e2e.sh. Los correos de invitación los recibe el
 * proveedor SIMULADO de las pruebas.
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const REST = `${PROXY}/rest/v1`;
const AUTH = `${PROXY}/auth/v1`;
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PASSWORD || !SERVICE, 'Lanza estas pruebas con scripts/test-e2e.sh');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
function plate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  return `${Math.floor(1000 + Math.random() * 9000)}${Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * 20)]).join('')}`;
}

async function tokenFor(email: string) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status, `inicio de sesión de ${email}`).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}
async function api(path: string, token: string, method = 'GET', body?: unknown, key = ANON) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as unknown };
}
const first = (r: { json: unknown }) => (Array.isArray(r.json) ? r.json[0] : r.json) as Record<string, string>;

/** Ficha + vehículo en un taller (con el token de su personal) e invitación para `email`. */
async function invite(ownerEmail: string, workshopId: string, email: string, name: string, plateText: string) {
  const owner = await tokenFor(ownerEmail);
  const c = await api('/customers', owner, 'POST', { workshop_id: workshopId, full_name: name, email });
  expect(c.status, JSON.stringify(c.json)).toBe(201);
  const customerId = first(c).id!;
  const v = await api('/vehicles', owner, 'POST', { workshop_id: workshopId, customer_id: customerId, plate: plateText, make: 'Seat', model: 'Ibiza', year: 2018, year_kind: 'fabricacion' });
  expect(v.status, JSON.stringify(v.json)).toBe(201);
  const inv = await api('/rpc/create_customer_invitation', owner, 'POST', { p_customer_id: customerId });
  expect(inv.status, JSON.stringify(inv.json)).toBe(200);
  return { owner, customerId, token: first(inv).token! };
}

async function login(page: Page, email: string) {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('una cuenta, dos talleres: entrar desde la web del taller, invitaciones, cambiar de taller y retirar el acceso', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `multi-${stamp()}@e2e.test`;
  const name = 'Marta Multitaller';
  // Cuenta ya creada (con correo confirmado), como alguien que se registró antes.
  const created = await fetch(`${AUTH}/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } }),
  });
  expect(created.status).toBe(200);
  // «Taller Otro» necesita su web publicada para entrar desde ella (lo hace la plataforma).
  const otherWs = first(await api('/workshops?slug=eq.taller-otro&select=id', SERVICE, 'GET', undefined, SERVICE)).id!;
  await api(`/workshop_sites?workshop_id=eq.${otherWs}`, SERVICE, 'PATCH', { published: true }, SERVICE);

  const plateA = plate();
  const plateB = plate();
  const a = await invite('propietaria@e2e.test', DEMO, email, name, plateA);
  const b = await invite('otro@e2e.test', otherWs, email, name, plateB);

  // 1. Desde la web pública del taller demo: «Área de clientes» → acceso → este taller.
  await page.goto('/area-cliente');
  await expect(page).toHaveURL(/\/acceso\?next=%2Fportal%2Fentrar%2F/);
  await login(page, email);
  await expect(page).toHaveURL(/\/portal\/entrar\//);
  await expect(page.getByRole('heading', { name: 'Todavía no estás vinculado a este taller' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('te ha enviado una invitación');

  // 2. Pega su enlace de invitación → la acepta → entra en ESE taller.
  await page.getByLabel('Enlace o código de invitación').fill(`${new URL(page.url()).origin}/portal/invitacion?token=${a.token}`);
  await page.getByRole('button', { name: 'Usar la invitación' }).click();
  await expect(page).toHaveURL(/\/portal\/invitacion\?token=/);
  await expect(page.getByRole('heading', { name: /Tu portal en/ })).toBeVisible();
  await page.getByRole('button', { name: 'Aceptar y ver mi portal' }).click();
  await expect(page).toHaveURL(new RegExp(`/portal\\?bienvenida=1&taller=${DEMO}`), { timeout: 20_000 });

  // 3. Segundo taller con la MISMA cuenta (código pegado en «Mis talleres»).
  await page.goto('/portal/talleres');
  await page.getByLabel('Enlace o código de invitación').fill(b.token);
  await page.getByRole('button', { name: 'Usar la invitación' }).click();
  await expect(page.getByRole('heading', { name: 'Tu portal en Taller Otro' })).toBeVisible();
  await page.getByRole('button', { name: 'Aceptar y ver mi portal' }).click();
  await expect(page).toHaveURL(new RegExp(`taller=${otherWs}`));
  await page.goto('/portal/talleres');
  const list = page.getByRole('list', { name: 'Talleres vinculados' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').filter({ hasText: 'Taller Otro' })).toContainText('Seleccionado');

  // 4. Cada taller, solo lo suyo; el selector cambia de taller.
  await page.goto('/portal/vehiculos');
  await expect(page.locator('.pnl-content')).toContainText(plateB.slice(0, 4));
  await expect(page.locator('.pnl-content')).not.toContainText(plateA.slice(0, 4));
  await page.locator('select#taller').selectOption(DEMO);
  await expect(page).toHaveURL(new RegExp(`/portal/vehiculos\\?taller=${DEMO}`));
  await expect(page.locator('.pnl-content')).toContainText(plateA.slice(0, 4));
  await expect(page.locator('.pnl-content')).not.toContainText(plateB.slice(0, 4));

  // 5. Cambiar el identificador en la URL no da acceso a otro taller.
  await page.goto('/portal/vehiculos?taller=cccccccc-0000-0000-0000-000000000000');
  await expect(page.locator('.pnl-content')).toContainText(plateA.slice(0, 4));
  await expect(page.locator('.pnl-content')).not.toContainText('9999');

  // 6. El panel del taller ve que ha activado su cuenta.
  const status = await api('/rpc/customer_link_overview', a.owner, 'POST', { p_workshop_id: DEMO });
  expect((status.json as Array<{ customer_id: string; status: string }>).find(x => x.customer_id === a.customerId)?.status).toBe('activa');

  // 7. «Taller Otro» retira el acceso: desaparece de «Mis talleres»; la ficha se conserva.
  const unlink = await api('/rpc/unlink_customer_account', b.owner, 'POST', { p_customer_id: b.customerId });
  expect(unlink.status, JSON.stringify(unlink.json)).toBe(204);
  await page.goto('/portal/talleres');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).not.toContainText('Taller Otro');
  await page.goto(`/portal/vehiculos?taller=${otherWs}`);
  await expect(page.locator('.pnl-content')).not.toContainText(plateB.slice(0, 4));
  const kept = await api(`/customers?id=eq.${b.customerId}&select=id`, b.owner);
  expect((kept.json as unknown[]).length).toBe(1);

  // 8. Volver a entrar desde la web del taller demo: ya vinculada, directa a su portal.
  await page.goto('/area-cliente');
  await expect(page).toHaveURL(new RegExp(`/portal\\?taller=${DEMO}`));
});

test('sin vínculo: entrar desde la web del taller no da acceso a nada', async ({ page }) => {
  const email = `sin-vinculo-${stamp()}@e2e.test`;
  const res = await fetch(`${AUTH}/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  expect(res.status).toBe(200);
  await page.goto('/area-cliente');
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Todavía no estás vinculado a este taller' })).toBeVisible();
  await page.goto('/portal/vehiculos');
  await expect(page.locator('.pnl-content')).toContainText('no está vinculada');
  await page.goto('/portal/talleres');
  await page.getByLabel('Enlace o código de invitación').fill('taller-demo');
  await page.getByRole('button', { name: 'Usar la invitación' }).click();
  await expect(page.getByRole('alert')).toContainText('no parece un enlace ni un código');
  await page.getByLabel('Enlace o código de invitación').fill('f'.repeat(64));
  await page.getByRole('button', { name: 'Usar la invitación' }).click();
  await expect(page.getByRole('heading', { name: 'Invitación no disponible' })).toBeVisible();
});
