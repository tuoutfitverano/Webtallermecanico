/**
 * Notificaciones en el móvil (Web Push) con base de datos y Supabase Auth REALES.
 *
 * ⚠ SERVICIO DE NOTIFICACIONES SIMULADO: scripts/e2e/push-service-mock.mjs hace
 * de servicio del navegador (Google, Apple, Mozilla) y comprueba la firma
 * VAPID igual que ellos. El navegador de la prueba no puede suscribirse a un
 * servicio de verdad, así que su suscripción apunta al simulado. Ningún aviso
 * sale de este ordenador.
 */
import { expect, test } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const AUTH = `${PROXY}/auth/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const PUSH = process.env.E2E_PUSH_MOCK_URL ?? '';
const CRON = process.env.E2E_CRON_SECRET ?? '';
const WEB = process.env.E2E_API_URL ?? '';
const HOST = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:4329').host;
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PUSH || !CRON, 'Lanza estas pruebas con scripts/test-e2e.sh');
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
const toques = async (id: string) => (await (await fetch(`${PUSH}/__push?id=${id}`)).json()) as Array<{ size: number; ttl: string }>;
const procesar = async () => (await (await fetch(`${WEB}/api/notificaciones/procesar`, {
  method: 'POST', headers: { host: HOST, authorization: `Bearer ${CRON}` },
})).json()) as { push: { sent: number; gone: number } };

test('el cliente activa las notificaciones en su móvil y le llega el aviso del taller', async ({ browser }) => {
  test.setTimeout(120_000);
  // Cliente con cuenta vinculada, vehículo y orden (creados por la propietaria con su token: RLS).
  const owner = await tokenFor('propietaria@e2e.test');
  const email = `movil-${stamp()}@e2e.test`;
  const [c] = await api('/customers', owner, 'POST', { workshop_id: DEMO, full_name: 'Marta Móvil', email });
  await fetch(`${AUTH}/admin/users`, {
    method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const [inv] = await api('/rpc/create_customer_invitation', owner, 'POST', { p_customer_id: c!.id });
  await api('/rpc/accept_customer_invitation', await tokenFor(email), 'POST', { p_token: inv!.token });
  const [v] = await api('/vehicles', owner, 'POST', { workshop_id: DEMO, customer_id: c!.id, plate: `${Math.floor(1000 + Math.random() * 9000)}MVL`, make: 'Seat', model: 'Ibiza', year: 2018, year_kind: 'fabricacion' });
  const [o] = await api('/repair_orders', owner, 'POST', { workshop_id: DEMO, vehicle_id: v!.id, customer_id: c!.id, problem_description: 'Ruido al frenar' });

  // El navegador de la prueba no puede hablar con Google o Apple: su «suscripción» apunta al servicio simulado.
  const device = `dispositivo-${stamp()}`;
  const context = await acceptCookies(await browser.newContext({ locale: 'es-ES' }));
  await context.grantPermissions(['notifications']);
  await context.addInitScript(endpoint => {
    let current: PushSubscription | null = null;
    const fake = { endpoint, unsubscribe: async () => { current = null; return true; } } as unknown as PushSubscription;
    PushManager.prototype.subscribe = async function () { current = fake; return fake; };
    PushManager.prototype.getSubscription = async function () { return current; };
  }, `${PUSH}/push/${device}`);
  const page = await context.newPage();
  await page.goto('/acceso?next=%2Fportal%2Fdatos');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === '/portal/datos');

  const card = page.getByRole('region', { name: 'Notificaciones en este móvil' });
  await expect(card).toContainText('Es gratis y solo vale para este dispositivo');
  await card.getByRole('button', { name: 'Activar en este móvil' }).click();
  await expect(card.getByRole('status')).toContainText('Activadas en este dispositivo');

  // El taller cambia el estado → aviso en el portal → «toque» al móvil (firmado, sin datos dentro).
  await api(`/repair_orders?id=eq.${o!.id}`, owner, 'PATCH', { status: 'diagnosis' });
  const result = await procesar();
  expect(result.push.sent).toBeGreaterThanOrEqual(1);
  const received = await toques(device);
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ size: 0, ttl: '86400' });

  // Lo que enseña el móvil al recibirlo: el aviso de su taller, pedido con su sesión.
  const preview = await page.evaluate(async () => (await fetch('/api/notificaciones/movil', { credentials: 'same-origin' })).json()) as { title: string; url: string };
  expect(preview.title).toContain('AutoValue');
  expect(preview.url).toMatch(/^\/portal\//);
  // Sin sesión, solo un texto general.
  const anonymous = await (await fetch(`${WEB}/api/notificaciones/movil`, { headers: { host: HOST } })).json() as { title: string };
  expect(anonymous.title).toBe('Tienes un aviso nuevo');

  // Desactivar en este móvil: ya no le llegan.
  await card.getByRole('button', { name: 'Desactivar en este móvil' }).click();
  await expect(card.getByRole('button', { name: 'Activar en este móvil' })).toBeVisible();
  const [status] = await api('/rpc/my_push_status', await tokenFor(email), 'POST', {});
  expect(Number(status!.devices), 'el dispositivo se ha quitado en el servidor').toBe(0);
  await api(`/repair_orders?id=eq.${o!.id}`, owner, 'PATCH', { status: 'en_reparacion' });
  await procesar();
  expect(await toques(device)).toHaveLength(1);
  await context.close();
});
