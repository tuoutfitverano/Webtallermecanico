/**
 * Recuperar la cuenta sin el móvil de la verificación en dos pasos, con
 * Supabase Auth REAL (TOTP y código por correo al buzón de pruebas):
 *  · códigos de recuperación (se enseñan una vez al activarla);
 *  · por correo (contraseña recién escrita + código de 6 cifras del correo).
 * Lanza con scripts/test-e2e.sh.
 */
import { createHmac } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const MAIL = process.env.E2E_MAIL_URL ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const AUTH = `${PROXY}/auth/v1`;

test.skip(!PROXY || !MAIL || !PASSWORD || !SERVICE, 'Lanza estas pruebas con scripts/test-e2e.sh');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** Código TOTP (SHA-1, 6 cifras, 30 s), igual que la app del móvil. */
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

async function createUser(email: string) {
  const res = await fetch(`${AUTH}/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: 'Rita Recupera' } }),
  });
  expect(res.status).toBe(200);
}

interface Mail { subject: string; body: string }
async function mails(to: string): Promise<Mail[]> {
  return (await (await fetch(`${MAIL}/messages?to=${encodeURIComponent(to)}`)).json()) as Mail[];
}
async function waitForMail(to: string, before: number): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    const list = await mails(to);
    if (list.length > before) return list[0]!;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`No ha llegado ningún correo a ${to}`);
}

async function login(page: Page, email: string) {
  await page.goto('/acceso?next=%2Fcuenta');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

/** Activa la verificación y devuelve la clave de la app y los códigos de recuperación. */
async function enableTwoStep(page: Page): Promise<{ secret: string; codes: string[] }> {
  await page.goto('/cuenta/seguridad');
  await page.getByRole('button', { name: 'Activar la verificación en dos pasos' }).click();
  const secret = (await page.locator('#clave-totp').innerText()).trim();
  await page.getByLabel(/Escribe el código de 6 cifras/).fill(totp(secret));
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(page.getByRole('status').first()).toContainText('Guarda ahora tus códigos de recuperación');
  const codes = (await page.locator('#codigos-recuperacion li').allInnerTexts()).map(c => c.trim());
  return { secret, codes };
}

test('recuperar la cuenta con un código de recuperación', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `recupera-${stamp()}@e2e.test`;
  await createUser(email);
  await login(page, email);
  await expect(page).toHaveURL(/\/cuenta$/);

  const { codes } = await enableTwoStep(page);
  expect(codes).toHaveLength(10);
  for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  // Solo se enseñan una vez.
  await page.goto('/cuenta/seguridad');
  await expect(page.locator('#codigos-recuperacion')).toHaveCount(0);
  await expect(page.getByText('Códigos de recuperación: te quedan 10 de 10.')).toBeVisible();

  // Sin el móvil: tras la contraseña, «¿No tienes el móvil?» → código de recuperación.
  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL(/\/acceso\/verificar/);
  await page.getByText('¿No tienes el móvil?').click();
  await page.getByLabel('Código de recuperación').fill('AAAA-BBBB-CCCC-DDDD');
  await page.getByRole('button', { name: 'Entrar con el código de recuperación' }).click();
  await expect(page.getByRole('alert')).toContainText('no es correcto');
  await page.getByLabel('Código de recuperación').fill(codes[3]!.toLowerCase());
  await page.getByRole('button', { name: 'Entrar con el código de recuperación' }).click();

  // Dentro, con la verificación quitada y el aviso de volver a activarla.
  await expect(page).toHaveURL(/\/cuenta\/seguridad\?recuperada=codigo/);
  await expect(page.getByRole('status').first()).toContainText('Vuelve a activarla');
  await expect(page.getByRole('heading', { name: 'Desactivada' })).toBeVisible();
  await page.goto('/cuenta');
  await expect(page).toHaveURL(/\/cuenta$/);
});

test('recuperar la cuenta por correo (contraseña + código del correo)', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `recupera-correo-${stamp()}@e2e.test`;
  await createUser(email);
  await login(page, email);
  await expect(page).toHaveURL(/\/cuenta$/);
  await enableTwoStep(page);

  await page.context().clearCookies();
  await login(page, email);
  await expect(page).toHaveURL(/\/acceso\/verificar/);
  await page.getByText('¿No tienes el móvil?').click();
  const before = (await mails(email)).length;
  await page.getByRole('button', { name: 'Enviarme un código al correo' }).click();
  await expect(page.getByRole('status')).toContainText('Te hemos enviado un código de 6 cifras');
  const mail = await waitForMail(email, before);
  expect(mail.body).toContain('digo de acceso');
  const code = mail.body.match(/\b(\d{6})\b/)?.[1] ?? '';
  expect(code).toMatch(/^\d{6}$/);

  await page.getByLabel('Código del correo').fill('000000');
  await page.getByRole('button', { name: 'Comprobar el código del correo' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrecto o caducado');
  await page.getByLabel('Código del correo').fill(code);
  await page.getByRole('button', { name: 'Comprobar el código del correo' }).click();

  await expect(page).toHaveURL(/\/cuenta\/seguridad\?recuperada=correo/);
  await expect(page.getByRole('heading', { name: 'Desactivada' })).toBeVisible();
});

test('el código del correo solo, sin la contraseña, no quita la verificación', async ({ page }) => {
  test.setTimeout(120_000);
  const email = `recupera-sin-${stamp()}@e2e.test`;
  await createUser(email);
  await login(page, email);
  await enableTwoStep(page);
  await page.context().clearCookies();

  // Alguien con acceso solo al correo pide un código de acceso (sin contraseña) y entra con él:
  // la web le sigue pidiendo el código de la app y no puede empezar la recuperación por correo.
  const before = (await mails(email)).length;
  const otp = await fetch(`${AUTH}/otp`, {
    method: 'POST', headers: { apikey: process.env.E2E_ANON_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email, create_user: false }),
  });
  expect(otp.status).toBe(200);
  const code = (await waitForMail(email, before)).body.match(/\b(\d{6})\b/)?.[1] ?? '';
  const verify = await fetch(`${AUTH}/verify`, {
    method: 'POST', headers: { apikey: process.env.E2E_ANON_KEY ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ email, token: code, type: 'email' }),
  });
  const session = (await verify.json()) as { access_token: string };
  const start = await fetch(`${PROXY}/rest/v1/rpc/start_mfa_email_recovery`, {
    method: 'POST', headers: { apikey: process.env.E2E_ANON_KEY ?? '', authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: '{}',
  });
  expect(((await start.json()) as { reason: string }).reason).toBe('contrasena');
});
