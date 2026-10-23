/**
 * Verificación en dos pasos (TOTP real de Supabase Auth), pantalla de
 * administración de la plataforma y «dejar un taller» desde el portal.
 *
 * Los códigos de 6 cifras los calcula la prueba con la clave que enseña la
 * pantalla, igual que haría la app del móvil (RFC 6238).
 * Lanza con scripts/test-e2e.sh.
 */
import { createHmac } from 'node:crypto';
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

/** Código TOTP (SHA-1, 6 cifras, 30 s) de una clave en base32; `step` = ventanas de desplazamiento. */
function totp(secret: string, step = 0): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + step));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}

async function createUser(email: string, name: string) {
  const res = await fetch(`${AUTH}/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}
async function service(path: string, method: string, body?: unknown) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.text().then(t => (t ? JSON.parse(t) : null))) as unknown };
}
async function tokenFor(email: string) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}
async function rpc(name: string, token: string, args: Record<string, unknown>) {
  const res = await fetch(`${REST}/rpc/${name}`, {
    method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as unknown };
}
async function login(page: Page, email: string, next = '') {
  await page.goto(`/acceso${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('verificación en dos pasos y administración de la plataforma', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `admin-${stamp()}@e2e.test`;
  const userId = await createUser(email, 'Ada Administración');
  // Alta en la administración: solo la plataforma (clave del sistema), nunca desde la web.
  expect((await service('/platform_admins', 'POST', { user_id: userId })).status).toBe(201);

  // Sin 2FA, la pantalla lo explica y no enseña datos.
  await login(page, email, '/admin');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Falta la verificación en dos pasos' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);

  // Activarla: código QR + clave; el código de la «app» la confirma.
  await page.getByRole('link', { name: 'Activar la verificación en dos pasos' }).click();
  await expect(page).toHaveURL(/\/cuenta\/seguridad$/);
  await page.getByRole('button', { name: 'Activar la verificación en dos pasos' }).click();
  await expect(page.getByRole('img', { name: /Código QR/ })).toBeVisible();
  const secret = (await page.locator('#clave-totp').innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await page.getByLabel(/Escribe el código de 6 cifras/).fill('000000');
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(page.getByRole('alert')).toContainText('no es correcto');
  await page.getByRole('button', { name: 'Activar la verificación en dos pasos' }).click();
  const secret2 = (await page.locator('#clave-totp').innerText()).trim();
  await page.getByLabel(/Escribe el código de 6 cifras/).fill(totp(secret2));
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(page.getByRole('status')).toContainText('Verificación en dos pasos activada');

  // Administración: resumen sin datos personales; con sesión de soporte, diagnóstico y registro.
  await page.goto('/admin');
  await expect(page.getByRole('table')).toContainText('Taller Otro');
  await expect(page.getByRole('heading', { name: 'Diagnóstico de vinculación' })).toHaveCount(0);
  await page.getByLabel('Motivo (queda registrado)').fill('corto');
  await page.getByRole('button', { name: 'Abrir sesión de soporte' }).click();
  await expect(page.getByRole('alert')).toContainText('motivo');
  await page.getByLabel('Motivo (queda registrado)').fill('Prueba: revisar la vinculación de una clienta');
  await page.getByRole('button', { name: 'Abrir sesión de soporte' }).click();
  await expect(page.getByRole('status').first()).toContainText('Sesión de soporte abierta');
  await page.getByLabel('Correo de la persona').fill('propietaria@e2e.test');
  await page.getByRole('button', { name: 'Consultar' }).click();
  await expect(page.getByRole('list', { name: 'Resultado del diagnóstico' })).toContainText('Cuenta: existe');
  await expect(page.getByRole('heading', { name: 'Registro de accesos' })).toBeVisible();
  await expect(page.locator('.plain-list').last()).toContainText('Consulta de soporte');
  await page.getByRole('button', { name: 'Cerrar la sesión de soporte' }).click();
  await expect(page.getByRole('heading', { name: 'Diagnóstico de vinculación' })).toHaveCount(0);

  // Volver a entrar: tras la contraseña se pide el código; sin él no se entra en nada.
  await page.context().clearCookies();
  await login(page, email, '/cuenta');
  await expect(page).toHaveURL(/\/acceso\/verificar\?next=%2Fcuenta/);
  await page.goto('/cuenta');
  await expect(page).toHaveURL(/\/acceso\/verificar\?next=%2Fcuenta/);
  await page.getByLabel('Código de 6 cifras').fill('123456');
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByRole('alert')).toContainText('Código incorrecto');
  await page.getByLabel('Código de 6 cifras').fill(totp(secret2, 1));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/cuenta$/);
  await expect(page.getByText('Verificación en dos pasos: activada')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administración de la plataforma' })).toBeVisible();
});

test('quien no es de la plataforma no ve la administración', async ({ page }) => {
  await login(page, 'propietaria@e2e.test', '/panel');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: /no existe|no encontrada/i })).toBeVisible();
  await page.goto('/cuenta');
  await expect(page.getByRole('link', { name: 'Administración de la plataforma' })).toHaveCount(0);
});

test('el cliente deja de ver un taller desde «Mis talleres»; el taller lo conserva', async ({ page }) => {
  const email = `deja-${stamp()}@e2e.test`;
  await createUser(email, 'Diego Deja');
  const otherWs = ((await service('/workshops?slug=eq.taller-otro&select=id', 'GET')).json as Array<{ id: string }>)[0]!.id;
  await service(`/workshop_sites?workshop_id=eq.${otherWs}`, 'PATCH', { published: true });
  const client = await tokenFor(email);
  for (const [owner, ws] of [['propietaria@e2e.test', DEMO], ['otro@e2e.test', otherWs]] as const) {
    const tok = await tokenFor(owner);
    const c = await fetch(`${REST}/customers`, {
      method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation' },
      body: JSON.stringify({ workshop_id: ws, full_name: 'Diego Deja', email }),
    });
    const customerId = ((await c.json()) as Array<{ id: string }>)[0]!.id;
    const inv = await rpc('create_customer_invitation', tok, { p_customer_id: customerId });
    expect((await rpc('accept_customer_invitation', client, { p_token: (inv.json as Array<{ token: string }>)[0]!.token })).status).toBe(200);
  }

  await login(page, email, '/portal/talleres');
  const list = page.getByRole('list', { name: 'Talleres vinculados' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Dejar de ver Taller Otro…' }).click();
  await expect(page.getByText('¿Dejar de ver Taller Otro en tu portal?')).toBeVisible();
  await page.getByRole('button', { name: 'Sí, dejar de verlo' }).click();
  await expect(page.getByRole('status')).toContainText('Has dejado de ver ese taller');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).not.toContainText('Taller Otro');

  // El taller conserva la ficha y la ve como «acceso retirado».
  const otherOwner = await tokenFor('otro@e2e.test');
  const overview = await rpc('customer_link_overview', otherOwner, { p_workshop_id: otherWs });
  const statuses = (overview.json as Array<{ status: string }>).map(x => x.status);
  expect(statuses).toContain('revocada');
});
