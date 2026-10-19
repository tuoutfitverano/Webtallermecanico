/**
 * Notificaciones (Fase 7) con base de datos y Supabase Auth REALES.
 *
 * ⚠ EMAIL SIMULADO: scripts/test-e2e.sh arranca scripts/e2e/email-provider-mock.mjs,
 * que imita la API de Resend. Estas pruebas comprueban NUESTRO código (avisos,
 * cola, envío, reintentos, webhook firmado y permisos), pero NINGÚN email sale
 * a internet ni demuestran que el proveedor real los entregue.
 */
import { createHmac } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const AUTH = `${PROXY}/auth/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const EMAIL_MOCK = process.env.E2E_EMAIL_MOCK_URL ?? '';
const WEBHOOK_SECRET = process.env.E2E_WEBHOOK_SECRET ?? '';
const CRON_SECRET = process.env.E2E_CRON_SECRET ?? '';
const WEB = process.env.E2E_API_URL ?? '';
const HOST = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:4329').host;
const DEMO = 'd0000000-0000-0000-0000-000000000001';
const SECRET_NOTE = 'NOTA-INTERNA-QUE-NO-SALE';

test.skip(!PROXY || !EMAIL_MOCK || !WEBHOOK_SECRET, 'Lanza estas pruebas con scripts/test-e2e.sh');
test.skip(({ isMobile }) => isMobile, 'El flujo se comprueba en escritorio (el portal móvil ya se prueba en portal.spec.ts)');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
function newPlate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  return `${Math.floor(1000 + Math.random() * 9000)}${Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')}`;
}

async function login(page: Page, email: string, next: string) {
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === next.split('?')[0]);
}
async function tokenFor(email: string) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const b = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: b.access_token, userId: b.user.id };
}
async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as unknown };
}
const rows = (r: { json: unknown }) => (Array.isArray(r.json) ? r.json : []) as Array<Record<string, unknown>>;
interface SentEmail { id: string; to: string; from: string; subject: string; text: string; html: string; reply_to: string | null; idempotencyKey: string }
const emailsTo = async (to: string) => (await (await fetch(`${EMAIL_MOCK}/__emails?to=${encodeURIComponent(to)}`)).json()) as SentEmail[];

/** Cliente con cuenta vinculada + vehículo + orden, creados por la propietaria con su token (RLS). */
async function setup(opts: { email?: string; link?: boolean } = {}) {
  const owner = await tokenFor('propietaria@e2e.test');
  const email = opts.email ?? `cliente-${stamp()}@e2e.test`;
  const name = `Elena Avisos ${stamp()}`;
  const [c] = rows(await api('/customers', owner.token, 'POST', { workshop_id: DEMO, full_name: name, email }));
  let client: { token: string; userId: string } | null = null;
  if (opts.link !== false) {
    await fetch(`${AUTH}/admin/users`, {
      method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: name } }),
    });
    const [inv] = rows(await api('/rpc/create_customer_invitation', owner.token, 'POST', { p_customer_id: c!.id }));
    client = await tokenFor(email);
    await api('/rpc/accept_customer_invitation', client.token, 'POST', { p_token: inv!.token });
  }
  // La orden se crea con el cliente ya vinculado (si no, no hay aviso en el portal: nadie lo leería).
  const [v] = rows(await api('/vehicles', owner.token, 'POST', { workshop_id: DEMO, customer_id: c!.id, plate: newPlate(), make: 'Seat', model: 'León' }));
  const [o] = rows(await api('/repair_orders', owner.token, 'POST', {
    workshop_id: DEMO, vehicle_id: v!.id, customer_id: c!.id, problem_description: 'Revisión de frenos', internal_notes: SECRET_NOTE,
  }));
  return { owner, email, name, customerId: c!.id as string, orderId: o!.id as string, client };
}
async function changeStatus(page: Page, orderId: string, label: string, message = '') {
  await page.goto(`/panel/ordenes/${orderId}`);
  if (message) await page.getByLabel(/Mensaje para el cliente con el cambio de estado/).fill(message);
  await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Estado actualizado.');
}
const notificationsOf = async (token: string, orderId: string) =>
  rows(await api(`/notifications?order_id=eq.${orderId}&select=channel,event,status,error_code,attempts,provider_message_id,manual_retries&order=created_at`, token));
async function newPage(browser: Browser) {
  return (await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' })).newPage();
}

test.describe.configure({ mode: 'serial' });

test.describe('Avisos · de un cambio de estado al cliente', () => {
  test('el taller activa el email; un cambio real avisa en el portal y por email (simulado)', async ({ page, browser }) => {
    await login(page, 'propietaria@e2e.test', '/panel/avisos');
    const settings = page.getByRole('region', { name: 'Qué se avisa' });
    await settings.getByLabel(/Enviar avisos por email/).check();
    await settings.getByLabel('correo al que responden los clientes', { exact: false }).fill('taller-demo@e2e.test');
    await settings.getByRole('button', { name: 'Guardar ajustes' }).click();
    await expect(page.getByRole('status')).toContainText('Ajustes de avisos guardados.');

    const job = await setup();
    // Crear la orden por la API deja el email de "vehículo recibido" en cola (pendiente, no enviado).
    expect((await notificationsOf(job.owner.token, job.orderId)).map(n => `${n.channel}:${n.status}`)).toEqual(['app:entregado', 'email:pendiente']);

    // Guardar sin cambiar el estado no genera avisos.
    await page.goto(`/panel/ordenes/${job.orderId}`);
    await page.getByLabel('Diagnosis', { exact: true }).fill('Pastillas gastadas');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Cambios guardados.');
    expect(await notificationsOf(job.owner.token, job.orderId)).toHaveLength(2);
    // Al guardar, el servidor aprovecha para enviar lo que hubiera en cola de esta orden.
    await expect.poll(async () => (await emailsTo(job.email)).map(m => m.subject)).toEqual(['Taller Demo: Hemos recibido tu vehículo']);

    // Cambio real a "Listo para recoger" con mensaje → aviso en portal + email.
    await changeStatus(page, job.orderId, 'Listo para recoger', 'Puedes pasar a partir de las 17:00.');
    await expect.poll(async () => (await emailsTo(job.email)).length).toBe(2);
    const [mail] = await emailsTo(job.email);
    expect(mail!.subject).toBe('Taller Demo: Tu vehículo está listo para recoger');
    expect(mail!.from).toBe('"Taller Demo" <avisos@talleres.test>');
    expect(mail!.reply_to).toBe('taller-demo@e2e.test');
    expect(mail!.text).toContain('Puedes pasar a partir de las 17:00.');
    expect(mail!.text).toContain('/portal/reparaciones/');
    expect(mail!.text + mail!.html).not.toContain(SECRET_NOTE);
    expect(mail!.text + mail!.html).not.toContain('Pastillas gastadas');
    await expect.poll(async () => (await notificationsOf(job.owner.token, job.orderId)).map(n => `${n.channel}:${n.event}:${n.status}`))
      .toEqual(['app:vehiculo_recibido:entregado', 'email:vehiculo_recibido:enviado', 'app:listo:entregado', 'email:listo:enviado']);

    // El panel lo muestra como "enviado al proveedor", no como entregado.
    await page.goto('/panel/avisos?estado=enviados&canal=email');
    const row = page.getByRole('row', { name: new RegExp(job.name) }).filter({ hasText: 'Tu vehículo está listo para recoger' });
    await expect(row).toContainText('Enviado al proveedor');

    // El proveedor confirma la entrega por webhook firmado → "Entregado".
    const sent = (await notificationsOf(job.owner.token, job.orderId)).find(n => n.channel === 'email' && n.event === 'listo')!;
    const body = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: sent.provider_message_id } });
    const id = `msg_${stamp()}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(WEBHOOK_SECRET.slice(6), 'base64');
    const signature = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
    const post = (sig: string, b = body) => fetch(`${WEB}/api/notificaciones/webhook`, {
      method: 'POST', headers: { host: HOST, 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig }, body: b,
    });
    expect((await post('v1,firma-falsa')).status).toBe(401);
    expect((await post(`v1,${signature}`, body.replace('delivered', 'complained'))).status).toBe(401);
    expect((await post(`v1,${signature}`)).status).toBe(200);
    expect((await notificationsOf(job.owner.token, job.orderId)).find(n => n.channel === 'email' && n.event === 'listo')!.status).toBe('entregado');
    await page.reload();
    await page.goto('/panel/avisos?estado=enviados&canal=email');
    await expect(page.getByRole('row', { name: new RegExp(job.name) }).filter({ hasText: 'Tu vehículo está listo para recoger' })).toContainText('Entregado');

    // El cliente lo ve en su portal: indicador de no leídos, lista y acceso a la reparación.
    const client = await newPage(browser);
    await login(client, job.email, '/portal');
    await expect(client.locator('.pnl-nav .pnl-badge')).toHaveText('2');
    await client.goto('/portal/avisos');
    const list = client.getByRole('list', { name: /2 avisos, 2 sin leer/ });
    await expect(list).toContainText('Tu vehículo está listo para recoger');
    await expect(list).toContainText('Mensaje del taller: Puedes pasar a partir de las 17:00.');
    await expect(list).toContainText('Hemos recibido tu vehículo');
    await expect(client.locator('body')).not.toContainText(SECRET_NOTE);
    await list.getByRole('button', { name: 'Ver la reparación' }).first().click();
    await expect(client).toHaveURL(new RegExp(`/portal/reparaciones/${job.orderId}$`));
    await expect(client.locator('.pnl-nav .pnl-badge')).toHaveText('1');
    await client.goto('/portal/avisos');
    await client.getByRole('button', { name: 'Marcar todo como leído' }).click();
    await expect(client.getByRole('list', { name: /2 avisos, 0 sin leer/ })).toBeVisible();
    await expect(client.locator('.pnl-nav .pnl-badge')).toHaveCount(0);
    await client.context().close();
  });

  test('preferencias: el cliente desactiva los emails y deja de recibirlos; lo comercial nace desactivado', async ({ page, browser }) => {
    const job = await setup();
    const client = await newPage(browser);
    await login(client, job.email, '/portal/datos');
    const form = client.getByRole('form', { name: 'Comunicaciones de Taller Demo' });
    await expect(form.getByLabel(/Avisos de mis reparaciones por email/)).toBeChecked();
    await expect(form.getByLabel(/Ofertas y promociones/)).not.toBeChecked();
    await form.getByLabel(/Avisos de mis reparaciones por email/).uncheck();
    await form.getByRole('button', { name: 'Guardar preferencias' }).click();
    await expect(client.getByRole('status')).toContainText('Preferencias guardadas.');

    await login(page, 'propietaria@e2e.test', `/panel/ordenes/${job.orderId}`);
    await changeStatus(page, job.orderId, 'Listo para recoger');
    const list = await notificationsOf(job.owner.token, job.orderId);
    expect(list.filter(n => n.channel === 'email' && n.status !== 'cancelado')).toHaveLength(0);
    expect(list.find(n => n.channel === 'email')).toMatchObject({ status: 'cancelado', error_code: 'preferencia' });
    expect(list.filter(n => n.channel === 'app')).toHaveLength(2);
    expect(await emailsTo(job.email)).toHaveLength(0);

    // En la ficha del panel consta; el taller no puede dar el consentimiento comercial por el cliente.
    await page.goto(`/panel/clientes/${job.customerId}`);
    await expect(page.getByRole('region', { name: 'Comunicaciones' })).toContainText('No (desactivados)');
    const grant = await api('/rpc/set_contact_preferences', job.owner.token, 'POST', { p_customer_id: job.customerId, p_operational_email: true, p_marketing_email: true });
    expect(grant.status).toBeGreaterThanOrEqual(400);
    await client.context().close();
  });

  test('fallos de email: quedan registrados, se reintentan con límite y el reintento manual no duplica', async ({ page }) => {
    const temporal = await setup({ email: `temporal-${stamp()}@e2e.test`, link: false });
    const rechazo = await setup({ email: `rechazo-${stamp()}@e2e.test`, link: false });
    await login(page, 'propietaria@e2e.test', '/panel/avisos');
    await changeStatus(page, temporal.orderId, 'Listo para recoger');
    await changeStatus(page, rechazo.orderId, 'Listo para recoger');
    await expect.poll(async () => (await notificationsOf(temporal.owner.token, temporal.orderId)).find(n => n.event === 'listo'))
      .toMatchObject({ status: 'pendiente', attempts: 1, error_code: 'no_disponible' });
    await expect.poll(async () => (await notificationsOf(rechazo.owner.token, rechazo.orderId)).find(n => n.event === 'listo'))
      .toMatchObject({ status: 'fallido', error_code: 'rechazado' });

    await page.goto('/panel/avisos?estado=fallidos&canal=email');
    const row = page.getByRole('row', { name: new RegExp(rechazo.name) }).filter({ hasText: 'Tu vehículo está listo para recoger' });
    await expect(row).toContainText('El proveedor rechazó el email');
    await row.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByRole('status')).toContainText('Reintento enviado.');
    await expect.poll(async () => (await notificationsOf(rechazo.owner.token, rechazo.orderId)).find(n => n.event === 'listo'))
      .toMatchObject({ status: 'fallido', manual_retries: 1 });

    // Proceso programado: solo con el secreto.
    const cron = (auth: string) => fetch(`${WEB}/api/notificaciones/procesar`, { method: 'POST', headers: { host: HOST, authorization: auth, 'content-type': 'application/json' } });
    expect((await cron('Bearer otro')).status).toBe(401);
    const ok = await cron(`Bearer ${CRON_SECRET}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, configured: true });
  });
});

test.describe('Avisos · permisos', () => {
  test('mecánico, otro taller y clientes no ven ni tocan avisos ajenos', async ({ page }) => {
    const job = await setup();
    const other = await setup();
    const mech = await tokenFor('mecanico@e2e.test');
    expect(rows(await api('/notifications?select=id', mech.token))).toHaveLength(0);
    const otro = await tokenFor('otro@e2e.test');
    expect(rows(await api(`/notifications?select=id&workshop_id=eq.${DEMO}`, otro.token))).toHaveLength(0);
    expect(rows(await api('/workshop_notification_settings?select=workshop_id', otro.token)).every(s => s.workshop_id !== DEMO)).toBe(true);

    // Un cliente no lee la tabla, ni marca como leído un aviso de otra persona.
    const client = job.client!;
    expect(rows(await api('/notifications?select=id', client.token))).toHaveLength(0);
    const othersNotice = rows(await api(`/notifications?order_id=eq.${other.orderId}&channel=eq.app&select=id`, job.owner.token))[0]!;
    const mark = await api('/rpc/portal_mark_notifications_read', client.token, 'POST', { p_id: othersNotice.id });
    expect(mark.json).toBe(0);
    expect(rows(await api('/rpc/portal_notifications', client.token, 'POST', {})).every(n => n.id !== othersNotice.id)).toBe(true);
    // Ni reintenta, ni anota envíos, ni cambia ajustes.
    expect((await api('/rpc/retry_notification', client.token, 'POST', { p_id: othersNotice.id })).status).toBeGreaterThanOrEqual(400);
    expect((await api('/rpc/claim_email_notifications', job.owner.token, 'POST', {})).status).toBeGreaterThanOrEqual(400);

    // En el panel, el mecánico no tiene la sección.
    await login(page, 'mecanico@e2e.test', '/panel');
    await expect(page.getByRole('link', { name: 'Avisos' })).toHaveCount(0);
    await page.goto('/panel/avisos');
    await expect(page.getByText('Solo el propietario o un administrador gestionan los avisos a clientes.')).toBeVisible();
  });
});
