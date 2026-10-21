/**
 * Portal del cliente con base de datos y Supabase Auth REALES.
 *
 * Cuentas (scripts/test-e2e.sh, contraseña E2E_PASSWORD):
 *   propietaria@e2e.test (taller demo) · mecanico@e2e.test (mecánico del taller demo)
 *   otro@e2e.test (propietario de "Taller Otro")
 * Cada prueba crea sus propios clientes (correos y matrículas únicos).
 *
 * Comprueba en el navegador y, sobre todo, contra la API con tokens reales:
 * la seguridad la pone la base de datos, no la interfaz.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const AUTH = `${PROXY}/auth/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const MAIL = process.env.E2E_MAIL_URL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';
const SECRET_NOTE = 'NOTA-INTERNA-QUE-EL-CLIENTE-NO-DEBE-VER';

test.skip(!PROXY || !MAIL || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const uniqueEmail = (label: string) => `${label}-${stamp()}@e2e.test`;
function newPlate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  const n = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  return { typed: `${n} ${l.toLowerCase()}`, normalized: `${n}${l}`, display: `${n} ${l}` };
}

// ---------------------------------------------------------------- utilidades
async function login(page: Page, email: string, next = '') {
  await page.goto(`/acceso${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function tokenFor(email: string) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(res.status, `inicio de sesión por API de ${email}`).toBe(200);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json: unknown = (() => { try { return text ? JSON.parse(text) : null; } catch { return text; } })();
  return { status: res.status, json };
}
const rpc = (name: string, token: string, args: Record<string, unknown> = {}) => api(`/rpc/${name}`, token, 'POST', args);
const rows = (r: { json: unknown }) => (Array.isArray(r.json) ? r.json : []) as Array<Record<string, unknown>>;

async function createConfirmedUser(email: string, fullName: string) {
  const res = await fetch(`${AUTH}/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }),
  });
  expect(res.status).toBe(200);
}

interface Mail { subject: string; links: string[] }
async function waitForMail(to: string, before: number): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await fetch(`${MAIL}/messages?to=${encodeURIComponent(to)}`)).json()) as Mail[];
    if (list.length > before) return list[0]!;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`No ha llegado ningún correo a ${to}`);
}

/**
 * Ficha de cliente + vehículo + orden en el taller demo creada por la
 * propietaria con SU token (RLS), y, si se pide, cuenta vinculada mediante
 * invitación aceptada por el propio cliente.
 */
async function setupCustomer(opts: { link?: boolean; name?: string } = {}) {
  const owner = await tokenFor('propietaria@e2e.test');
  const email = uniqueEmail('cliente');
  const name = opts.name ?? `Clara Cliente ${stamp()}`;
  const plate = newPlate();
  const c = await api('/customers', owner.token, 'POST', { workshop_id: DEMO, full_name: name, email });
  expect(c.status, JSON.stringify(c.json)).toBe(201);
  const customerId = rows(c)[0]!.id as string;
  const v = await api('/vehicles', owner.token, 'POST', { workshop_id: DEMO, customer_id: customerId, plate: plate.normalized, make: 'Seat', model: 'León', year: 2015, year_kind: 'fabricacion' });
  expect(v.status, JSON.stringify(v.json)).toBe(201);
  const vehicleId = rows(v)[0]!.id as string;
  const o = await api('/repair_orders', owner.token, 'POST', {
    workshop_id: DEMO, vehicle_id: vehicleId, customer_id: customerId,
    problem_description: 'Revisión de frenos', internal_notes: SECRET_NOTE, diagnosis: 'Pastillas al límite',
  });
  expect(o.status, JSON.stringify(o.json)).toBe(201);
  const orderId = rows(o)[0]!.id as string;

  let client: { token: string; userId: string } | null = null;
  if (opts.link) {
    await createConfirmedUser(email, name);
    const inv = await rpc('create_customer_invitation', owner.token, { p_customer_id: customerId });
    expect(inv.status, JSON.stringify(inv.json)).toBe(200);
    client = await tokenFor(email);
    const acc = await rpc('accept_customer_invitation', client.token, { p_token: rows(inv)[0]!.token });
    expect(acc.status, JSON.stringify(acc.json)).toBe(200);
  }
  return { owner, email, name, plate, customerId, vehicleId, orderId, client };
}

async function newPage(browser: Browser) {
  const context = await acceptCookies(await browser.newContext({ locale: 'es-ES', timezoneId: 'Europe/Madrid' }));
  return context.newPage();
}

// ---------------------------------------------------------------- flujo completo
test.describe('Portal · invitación y seguimiento', () => {
  test.skip(({ isMobile }) => isMobile, 'Flujo completo: basta con escritorio');

  test('el taller invita → el cliente se registra, confirma y acepta → ve solo lo autorizado', async ({ page, browser }) => {
    test.setTimeout(90_000);
    const job = await setupCustomer({ name: `Lucía Portal ${stamp()}` });

    // 1. La propietaria abre la ficha y crea la invitación (correo ya rellenado).
    await login(page, 'propietaria@e2e.test', `/panel/clientes/${job.customerId}`);
    const access = page.getByRole('region', { name: 'Acceso al portal del cliente' });
    await expect(access).toContainText('Sin vincular');
    await expect(access.getByLabel('Correo del cliente para entrar en el portal')).toHaveValue(job.email);
    await access.getByRole('button', { name: 'Crear invitación al portal' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invitación creada' })).toBeVisible();
    const link = await page.locator('#enlace-portal').inputValue();
    expect(link).toMatch(/\/portal\/invitacion\?token=[0-9a-f]{64}$/);
    // El enlace solo se muestra una vez: al recargar queda la invitación pendiente, sin el código.
    await page.goto(`/panel/clientes/${job.customerId}`);
    await expect(page.locator('#enlace-portal')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Invitaciones pendientes' })).toContainText(job.email);

    // 2. El cliente abre el enlace sin cuenta → acceso → crea la cuenta → confirma por correo.
    const client = await newPage(browser);
    await client.goto(link);
    await expect(client).toHaveURL(/\/acceso\?next=%2Fportal%2Finvitacion/);
    await client.goto(`/registro?next=${encodeURIComponent(new URL(link).pathname + new URL(link).search)}`);
    await client.getByLabel('Nombre y apellidos').fill(job.name);
    await client.getByLabel('Correo electrónico').fill(job.email);
    await client.locator('#password').fill(PASSWORD);
    await client.locator('#password2').fill(PASSWORD);
    await client.getByRole('checkbox').check();
    await client.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(client.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
    const mail = await waitForMail(job.email, 0);
    const confirm = mail.links.find(l => l.includes('/auth/confirmar') && l.includes('token_hash='));
    expect(confirm, 'enlace de confirmación').toBeTruthy();
    await client.goto(confirm!);
    await client.getByRole('button', { name: 'Confirmar mi correo' }).click();

    // 3. Vuelve a la invitación y la acepta.
    await expect(client).toHaveURL(/\/portal\/invitacion\?token=/);
    await expect(client.getByRole('heading', { name: 'Tu portal en AutoValue' })).toBeVisible();
    await client.getByRole('button', { name: 'Aceptar y ver mi portal' }).click();
    await expect(client).toHaveURL(/\/portal\?bienvenida=1$/);
    await expect(client.getByRole('status').filter({ hasText: 'Tu cuenta ya está vinculada' })).toBeVisible();
    await expect(client.getByRole('heading', { name: 'Hola, Lucía' })).toBeVisible();
    await expect(client.locator('.kpi', { hasText: 'Vehículo registrado' })).toContainText('1');
    await expect(client.locator('.kpi', { hasText: 'Reparación en curso' })).toContainText('1');

    // La invitación ya no sirve otra vez.
    await client.goto(link);
    await expect(client.getByRole('heading', { name: 'Invitación no disponible' })).toBeVisible();
    await expect(client.getByRole('alert')).toContainText('ya se ha usado');

    // 4. Detalle: estado y motivo, pero ni notas internas ni diagnosis sin autorización.
    await client.goto(`/portal/reparaciones/${job.orderId}`);
    await expect(client.getByRole('heading', { level: 1 })).toContainText('Vehículo recibido');
    await expect(client.getByText('Revisión de frenos')).toBeVisible();
    await expect(client.locator('body')).not.toContainText(SECRET_NOTE);
    await expect(client.locator('body')).not.toContainText('Pastillas al límite');
    await expect(client.getByText('El taller no indica plazos aquí')).toBeVisible();

    // 5. La propietaria autoriza la diagnosis, escribe un mensaje y marca "Listo".
    await page.goto(`/panel/ordenes/${job.orderId}`);
    await expect(page.getByText('El cliente ve en su portal la descripción del problema')).toBeVisible();
    await page.getByLabel('Mensaje para el cliente', { exact: true }).fill('Hemos cambiado las pastillas delanteras.');
    await page.getByLabel('Mostrar la diagnosis y el trabajo realizado al cliente').check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Cambios guardados.');
    await page.getByLabel(/Mensaje para el cliente con el cambio de estado/).fill('Ya puedes pasar a recogerlo.');
    await page.getByRole('button', { name: 'Listo para recoger', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Estado actualizado.');
    await expect(page.getByText('Al cliente: «Ya puedes pasar a recogerlo.»')).toBeVisible();

    // 6. El cliente lo ve: aviso de recogida, diagnosis autorizada, mensajes en el historial.
    await client.goto('/portal');
    await expect(client.locator('.ready')).toContainText('está listo para recoger');
    await client.goto(`/portal/reparaciones/${job.orderId}`);
    await expect(client.locator('.ready')).toContainText('Tu vehículo está listo para recoger');
    await expect(client.getByText('Pastillas al límite')).toBeVisible();
    const history = client.getByRole('region', { name: 'Historial' });
    await expect(history).toContainText('Mensaje del taller');
    await expect(history).toContainText('Hemos cambiado las pastillas delanteras.');
    await expect(history).toContainText('Ya puedes pasar a recogerlo.');
    await expect(client.locator('body')).not.toContainText(SECRET_NOTE);
    // No aparece quién del equipo hizo cada cambio.
    await expect(history).not.toContainText('Paula');

    // 7. Filtros de "Mis reparaciones".
    await client.goto('/portal/reparaciones?filtro=listas');
    await expect(client.getByRole('region', { name: 'Lista de reparaciones' })).toContainText(job.plate.display);
    await client.getByRole('link', { name: 'En curso' }).click();
    await expect(client.getByText('No tienes reparaciones en curso.')).toBeVisible();
    await client.getByRole('link', { name: 'Finalizadas' }).click();
    await expect(client.getByText('Todavía no hay reparaciones finalizadas.')).toBeVisible();

    // 8. Vehículos: tarjeta → ficha con sus reparaciones.
    await client.goto('/portal/vehiculos');
    await client.getByRole('link', { name: new RegExp(job.plate.display) }).first().click();
    await expect(client.getByRole('heading', { name: 'Seat León' })).toBeVisible();
    await expect(client.getByRole('region', { name: 'Reparaciones' })).toContainText('Revisión de frenos');

    // 9. En la ficha del panel ya consta la vinculación.
    await page.goto(`/panel/clientes/${job.customerId}`);
    await expect(page.getByRole('region', { name: 'Acceso al portal del cliente' })).toContainText('Vinculada');
    await client.context().close();
  });

  test('una invitación para otro correo no vincula la cuenta', async ({ page }) => {
    const job = await setupCustomer();
    const inv = await rpc('create_customer_invitation', job.owner.token, { p_customer_id: job.customerId });
    const intruder = uniqueEmail('intruso');
    await createConfirmedUser(intruder, 'Iván Intruso');
    await login(page, intruder, `/portal/invitacion?token=${rows(inv)[0]!.token as string}`);
    await expect(page.getByRole('alert')).toContainText('Esta invitación es para');
    await expect(page.getByRole('button', { name: 'Aceptar y ver mi portal' })).toHaveCount(0);
    // Ni forzándolo por API.
    const { token } = await tokenFor(intruder);
    const forced = await rpc('accept_customer_invitation', token, { p_token: rows(inv)[0]!.token });
    expect(forced.status).toBeGreaterThanOrEqual(400);
    expect(rows(await rpc('portal_orders', token))).toHaveLength(0);
  });

  test('un código inventado no da acceso', async ({ page }) => {
    const email = uniqueEmail('curioso');
    await createConfirmedUser(email, 'Carmen Curiosa');
    await login(page, email, `/portal/invitacion?token=${'a'.repeat(64)}`);
    await expect(page.getByRole('heading', { name: 'Invitación no disponible' })).toBeVisible();
    await page.goto('/portal');
    await expect(page.getByText('Tu cuenta todavía no está vinculada a ninguna ficha de cliente.')).toBeVisible();
    await page.goto('/portal/reparaciones');
    await expect(page.getByText('Tu cuenta todavía no está vinculada')).toBeVisible();
  });
});

// ---------------------------------------------------------------- seguridad por API
test.describe('Portal · permisos en la base de datos', () => {
  test.skip(({ isMobile }) => isMobile, 'Comprobaciones de API: basta con una pasada');

  test('el cliente solo ve lo suyo y no puede modificar nada', async () => {
    const mine = await setupCustomer({ link: true });
    const other = await setupCustomer({ link: true }); // otro cliente del mismo taller
    const client = mine.client!;

    // Lo suyo, sí (por las funciones del portal).
    const vehicles = rows(await rpc('portal_vehicles', client.token));
    expect(vehicles.map(v => v.id)).toEqual([mine.vehicleId]);
    const orders = rows(await rpc('portal_orders', client.token));
    expect(orders.map(o => o.id)).toEqual([mine.orderId]);
    // Las funciones solo devuelven los campos autorizados.
    const detail = rows(await rpc('portal_order', client.token, { p_order_id: mine.orderId }))[0]!;
    expect(Object.keys(detail)).not.toContain('internal_notes');
    expect(detail.diagnosis).toBeNull();
    expect(JSON.stringify(detail)).not.toContain(SECRET_NOTE);
    const timeline = rows(await rpc('portal_order_timeline', client.token, { p_order_id: mine.orderId }));
    expect(timeline.length).toBeGreaterThan(0);
    expect(JSON.stringify(timeline)).not.toMatch(/actor|assignee|internal/);

    // Lo de otro cliente, no (ni pidiéndolo por su identificador).
    expect(rows(await rpc('portal_order', client.token, { p_order_id: other.orderId }))).toHaveLength(0);
    expect(rows(await rpc('portal_order_timeline', client.token, { p_order_id: other.orderId }))).toHaveLength(0);
    expect(rows(await rpc('portal_orders', client.token, { p_vehicle_id: other.vehicleId }))).toHaveLength(0);

    // Las tablas del taller no le devuelven nada (RLS), tampoco lo suyo con las notas internas.
    for (const table of ['customers', 'vehicles', 'repair_orders', 'repair_order_events', 'customer_invitations', 'workshop_members']) {
      const r = await api(`/${table}?select=*`, client.token);
      expect(rows(r), `tabla ${table}`).toHaveLength(0);
    }
    const notes = await api(`/repair_orders?select=internal_notes&id=eq.${mine.orderId}`, client.token);
    expect(rows(notes)).toHaveLength(0);

    // No puede cambiar estados, dueños de vehículos ni su ficha.
    const status = await api(`/repair_orders?id=eq.${mine.orderId}`, client.token, 'PATCH', { status: 'entregado' });
    expect(rows(status)).toHaveLength(0);
    const owner = await api(`/vehicles?id=eq.${other.vehicleId}`, client.token, 'PATCH', { customer_id: mine.customerId });
    expect(rows(owner)).toHaveLength(0);
    const relink = await api(`/customers?id=eq.${other.customerId}`, client.token, 'PATCH', { user_id: client.userId });
    expect(rows(relink)).toHaveLength(0);
    // Ni darse permisos de personal ni invitar a nadie.
    const staff = await api('/workshop_members', client.token, 'POST', { workshop_id: DEMO, user_id: client.userId, role: 'propietario' });
    expect(staff.status).toBeGreaterThanOrEqual(400);
    expect((await rpc('create_customer_invitation', client.token, { p_customer_id: other.customerId })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc('unlink_customer_account', client.token, { p_customer_id: other.customerId })).status).toBeGreaterThanOrEqual(400);
    expect(rows(await rpc('my_workshops', client.token))).toHaveLength(0);

    // Y todo sigue igual.
    const check = await api(`/repair_orders?select=status,customer_id&id=eq.${mine.orderId}`, mine.owner.token);
    expect(rows(check)[0]).toEqual({ status: 'recibido', customer_id: mine.customerId });
  });

  test('otro taller no puede invitar a clientes del taller demo ni ver su portal', async () => {
    const job = await setupCustomer({ link: true });
    const otro = await tokenFor('otro@e2e.test');
    expect((await rpc('create_customer_invitation', otro.token, { p_customer_id: job.customerId })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc('unlink_customer_account', otro.token, { p_customer_id: job.customerId })).status).toBeGreaterThanOrEqual(400);
    // El propietario de otro taller no es cliente: el portal no le devuelve nada.
    expect(rows(await rpc('portal_order', otro.token, { p_order_id: job.orderId }))).toHaveLength(0);
    // El cliente del taller demo no ve el vehículo 9999ZZZ del Taller Otro.
    const plates = rows(await rpc('portal_vehicles', job.client!.token)).map(v => v.plate);
    expect(plates).not.toContain('9999ZZZ');
    expect(rows(await api('/vehicles?plate=eq.9999ZZZ', job.client!.token))).toHaveLength(0);
  });

  test('un mecánico ve el estado del acceso pero no gestiona vinculaciones', async ({ page }) => {
    const job = await setupCustomer();
    const mech = await tokenFor('mecanico@e2e.test');
    expect((await rpc('create_customer_invitation', mech.token, { p_customer_id: job.customerId })).status).toBeGreaterThanOrEqual(400);
    expect((await rpc('unlink_customer_account', mech.token, { p_customer_id: job.customerId })).status).toBeGreaterThanOrEqual(400);
    expect(rows(await api('/customer_invitations?select=id', mech.token))).toHaveLength(0);
    // Tampoco decide lo que ve el cliente en una orden.
    const patch = await api(`/repair_orders?id=eq.${job.orderId}`, mech.token, 'PATCH', { show_details_to_customer: true });
    expect(rows(patch)).toHaveLength(0);

    await login(page, 'mecanico@e2e.test', `/panel/clientes/${job.customerId}`);
    const access = page.getByRole('region', { name: 'Acceso al portal del cliente' });
    await expect(access).toContainText('Las invitaciones al portal las envía la oficina del taller (propietario, administrador o recepción).');
    await expect(access.getByRole('button')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- acceso
test.describe('Portal · acceso, revocación y móvil', () => {
  test('sin sesión, el portal manda a iniciar sesión', async ({ page }) => {
    await page.goto('/portal/reparaciones');
    await expect(page).toHaveURL(/\/acceso\?next=%2Fportal%2Freparaciones$/);
  });

  test('con una sesión caducada o inválida se avisa al volver a entrar', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-caducada', url: baseURL! }]);
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/acceso\?next=%2Fportal&caducada=1$/);
    await expect(page.getByText('Tu sesión ha caducado.')).toBeVisible();
  });

  test('un cliente no entra en el panel del taller', async ({ page }) => {
    const job = await setupCustomer({ link: true });
    await login(page, job.email);
    // Sin ?next, cada uno a su sitio: el cliente, a su portal.
    await expect(page).toHaveURL(/\/portal$/);
    const res = await page.goto('/panel/ordenes');
    expect(res?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'Esta zona es solo para el taller' })).toBeVisible();
    await page.getByRole('link', { name: /portal/i }).first().click();
    await expect(page).toHaveURL(/\/portal$/);
  });

  test('retirar el acceso bloquea el portal sin borrar la ficha ni el historial', async ({ page, browser, isMobile }) => {
    test.skip(isMobile, 'Basta con escritorio');
    const job = await setupCustomer({ link: true });
    const client = await newPage(browser);
    await login(client, job.email);
    await expect(client).toHaveURL(/\/portal$/);
    await client.goto(`/portal/reparaciones/${job.orderId}`);
    await expect(client.getByText('Revisión de frenos')).toBeVisible();

    await login(page, 'propietaria@e2e.test', `/panel/clientes/${job.customerId}`);
    await page.getByRole('button', { name: 'Retirar el acceso…' }).click();
    await expect(page.getByText(`¿Retirar el acceso al portal de ${job.name}?`)).toBeVisible();
    await page.getByRole('button', { name: 'Sí, retirar el acceso' }).click();
    await expect(page.getByRole('status')).toContainText('Acceso al portal retirado');
    await expect(page.getByRole('region', { name: 'Acceso al portal del cliente' })).toContainText('Sin vincular');
    // La ficha y la orden siguen ahí.
    await expect(page.getByRole('region', { name: 'Reparaciones' })).toContainText('OR-');

    // El cliente, con la misma sesión abierta, ya no ve nada.
    await client.goto(`/portal/reparaciones/${job.orderId}`);
    await expect(client.getByText('Tu cuenta todavía no está vinculada')).toBeVisible();
    await expect(client.locator('body')).not.toContainText('Revisión de frenos');
    expect(rows(await rpc('portal_orders', job.client!.token))).toHaveLength(0);
    expect(rows(await rpc('portal_order', job.client!.token, { p_order_id: job.orderId }))).toHaveLength(0);
    await client.context().close();
  });

  test('en móvil se navega con las pestañas inferiores', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Solo móvil');
    const job = await setupCustomer({ link: true });
    await login(page, job.email);
    await expect(page).toHaveURL(/\/portal$/);
    const tabs = page.locator('.pnl-tabs');
    await expect(tabs).toBeVisible();
    await tabs.getByRole('link', { name: 'Reparaciones' }).click();
    await expect(page).toHaveURL(/\/portal\/reparaciones$/);
    await page.getByRole('link', { name: /Seat León/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('OR-');
    await tabs.getByRole('link', { name: 'Mis vehículos' }).click();
    await expect(page.getByText(job.plate.display).first()).toBeVisible();
    // Nada se sale de la pantalla en horizontal.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
