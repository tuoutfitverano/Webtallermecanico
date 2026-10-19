/**
 * Autenticación y seguridad multitaller con Supabase Auth REAL (GoTrue),
 * PostgREST y PostgreSQL con RLS. Los correos llegan a un buzón de pruebas.
 *
 * Cuentas preparadas por scripts/test-e2e.sh (contraseña E2E_PASSWORD):
 *   propietaria@e2e.test → propietaria del Taller Demo
 *   mecanico@e2e.test    → mecánico del Taller Demo
 *   otro@e2e.test        → propietario de "Taller Otro" (con un vehículo 9999ZZZ)
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const AUTH = `${PROXY}/auth/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const MAIL = process.env.E2E_MAIL_URL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';
// Node no resuelve *.localhost (el navegador sí): las peticiones directas van a
// 127.0.0.1 con la cabecera Host de la web de demostración.
const WEB = process.env.E2E_API_URL ?? '';
const HOST = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:4329').host;

test.skip(!PROXY || !MAIL || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');

const uniqueEmail = (label: string) => `${label}-${Date.now()}${Math.floor(Math.random() * 1000)}@e2e.test`;

// ---------------------------------------------------------------- utilidades
async function login(page: Page, email: string, password = PASSWORD, next = '') {
  await page.goto(`/acceso${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

async function logout(page: Page) {
  // En el área de cuenta el botón dice "Salir"; en el panel y el portal, "Salir (cerrar sesión)".
  await page.getByRole('button', { name: /^Salir/ }).click();
  await expect(page).toHaveURL(/\/acceso\?salida=1/);
}

interface Mail { subject: string; links: string[]; rcpt: string[] }
async function mails(to: string): Promise<Mail[]> {
  return (await (await fetch(`${MAIL}/messages?to=${encodeURIComponent(to)}`)).json()) as Mail[];
}
/** Espera a que llegue un correo NUEVO para `to` (después de `before` correos). */
async function waitForMail(to: string, before: number): Promise<Mail> {
  for (let i = 0; i < 40; i++) {
    const list = await mails(to);
    if (list.length > before) return list[0]!;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`No ha llegado ningún correo a ${to}`);
}

async function tokenFor(email: string, password = PASSWORD) {
  const res = await fetch(`${AUTH}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status, `inicio de sesión por API de ${email}`).toBe(200);
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

async function api(path: string, opts: { token?: string; key?: string; method?: string; body?: unknown } = {}) {
  const key = opts.key ?? ANON;
  const res = await fetch(`${REST}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      apikey: key,
      authorization: `Bearer ${opts.token ?? key}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const json: unknown = (() => { try { return text ? JSON.parse(text) : null; } catch { return text; } })();
  return { status: res.status, json };
}

async function createConfirmedUser(email: string, fullName = 'Persona de Prueba') {
  const res = await fetch(`${AUTH}/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }),
  });
  expect(res.status).toBe(200);
}

// ---------------------------------------------------------------- inicio de sesión
test.describe('Inicio de sesión', () => {
  test('con credenciales válidas entra y ve su taller y su rol', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    // Tras iniciar sesión se llega al panel del taller.
    await expect(page).toHaveURL(/\/panel$/);
    await expect(page.locator('.pnl-workshop-name')).toHaveText('Taller Demo');
    await page.goto('/cuenta');
    await expect(page.getByRole('heading', { name: 'Hola, Paula' })).toBeVisible();
    await expect(page.locator('.workshop-list')).toContainText('Taller Demo');
    await expect(page.locator('.workshop-list')).toContainText('Propietario/a');
    // El equipo se gestiona en el panel; desde la cuenta hay un enlace directo.
    await page.getByRole('link', { name: 'Equipo e invitaciones' }).click();
    await expect(page).toHaveURL(/\/panel\/equipo\?taller=/);
    await expect(page.getByRole('heading', { name: 'Invitar a alguien' })).toBeVisible();
  });

  test('con una contraseña incorrecta NO entra', async ({ page }) => {
    await login(page, 'propietaria@e2e.test', 'contraseña-equivocada');
    await expect(page.getByRole('alert')).toContainText('El correo o la contraseña no son correctos.');
    await expect(page).toHaveURL(/\/acceso/);
    await page.goto('/cuenta');
    await expect(page).toHaveURL(/\/acceso\?next=%2Fcuenta/);
  });

  test('con un correo que no existe tampoco entra (y no se revela si existe)', async ({ page }) => {
    await login(page, uniqueEmail('no-existe'));
    await expect(page.getByRole('alert')).toContainText('El correo o la contraseña no son correctos.');
  });

  test('el mecánico entra y no ve la gestión del equipo', async ({ page }) => {
    await login(page, 'mecanico@e2e.test', PASSWORD, '/cuenta');
    await expect(page.locator('.workshop-list')).toContainText('Mecánico/a');
    await expect(page.getByRole('link', { name: 'Equipo e invitaciones' })).toHaveCount(0);
    await page.goto('/panel/equipo');
    await expect(page.getByRole('heading', { name: 'Equipo', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invitar a alguien' })).toHaveCount(0);
    await expect(page.getByLabel('Correo de la persona')).toHaveCount(0);
  });

  test('sin sesión, el área privada manda a iniciar sesión y luego vuelve', async ({ page }) => {
    await page.goto('/cuenta/contrasena');
    await expect(page).toHaveURL(/\/acceso\?next=%2Fcuenta%2Fcontrasena/);
    await page.getByLabel('Correo electrónico').fill('propietaria@e2e.test');
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/cuenta\/contrasena$/);
  });

  test('no redirige a webs externas aunque se manipule ?next=', async ({ page, baseURL }) => {
    await login(page, 'propietaria@e2e.test', PASSWORD, 'https://evil.test/robar');
    await expect(page).toHaveURL(`${baseURL}/panel`);
    await page.goto('/acceso?next=//evil.test');
    await expect(page).toHaveURL(`${baseURL}/panel`);
  });

  test('cerrar sesión la termina de verdad', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    await expect(page).toHaveURL(/\/panel$/);
    await logout(page);
    await expect(page.getByRole('status')).toContainText('Has cerrado la sesión.');
    await page.goto('/cuenta');
    await expect(page).toHaveURL(/\/acceso/);
  });

  test('un formulario enviado desde otra web se rechaza (CSRF)', async () => {
    const res = await fetch(`${WEB}/acceso`, {
      method: 'POST',
      headers: { host: HOST, origin: 'https://evil.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'propietaria@e2e.test', password: PASSWORD }),
      redirect: 'manual',
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('set-cookie') ?? '').not.toContain('auth-token');
  });

  test('las páginas privadas no se guardan en cachés', async () => {
    const res = await fetch(`${WEB}/acceso`, { headers: { host: HOST } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
  });
});

// ---------------------------------------------------------------- registro y correos
test.describe('Registro, confirmación y recuperación', () => {
  test.skip(({ isMobile }) => isMobile, 'Flujo completo: basta con escritorio');

  test('registro → correo de confirmación → cuenta sin talleres', async ({ page }) => {
    const email = uniqueEmail('registro');
    await page.goto('/registro');
    await page.getByLabel('Nombre y apellidos').fill('Rita Registro');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.locator('#password').fill('Una-clave-segura-1');
    await page.locator('#password2').fill('Una-clave-segura-1');
    await page.getByRole('checkbox').check();
    const before = (await mails(email)).length;
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

    // Sin confirmar no se puede entrar.
    await login(page, email, 'Una-clave-segura-1');
    await expect(page.getByRole('alert')).toContainText('no has confirmado tu correo');

    const mail = await waitForMail(email, before);
    // Plantilla del repositorio (supabase/templates/confirmation.html): enlace token_hash.
    const link = mail.links.find(l => l.includes('/auth/confirmar') && l.includes('token_hash='));
    expect(link, `enlace de confirmación en: ${JSON.stringify(mail).slice(0, 3000)}`).toBeTruthy();
    await page.goto(link!);
    await expect(page).toHaveURL(/\/auth\/confirmar\?/);
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
    // Con la cuenta confirmada, /mi-area la lleva a su cuenta (no es personal ni cliente vinculado).
    await expect(page).toHaveURL(/\/cuenta$/);
    await expect(page.getByText('Todavía no perteneces a ningún taller')).toBeVisible();
    // El panel no da acceso a nada sin taller, y el portal tampoco sin ficha vinculada.
    await page.goto('/panel');
    await expect(page.getByText('Tu cuenta todavía no pertenece a ningún taller.')).toBeVisible();
    await page.goto('/portal');
    await expect(page.getByText('Tu cuenta todavía no está vinculada a ninguna ficha de cliente.')).toBeVisible();
  });

  test('el registro valida los datos antes de crear nada', async ({ page }) => {
    await page.goto('/registro');
    await page.getByLabel('Correo electrónico').fill('no-es-un-correo');
    await page.locator('#password').fill('corta');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByText('Escribe tu nombre.')).toBeVisible();
    await expect(page.getByText('Escribe un correo electrónico válido.')).toBeVisible();
    await expect(page.getByText(/al menos 10 caracteres\./)).toBeVisible();
    await expect(page.getByText('Necesitamos que aceptes')).toBeVisible();
  });

  test('recuperar contraseña → enlace por correo → contraseña nueva', async ({ page }) => {
    const email = uniqueEmail('recupera');
    await createConfirmedUser(email);
    await page.goto('/recuperar');
    await page.getByLabel('Correo electrónico').fill(email);
    const before = (await mails(email)).length;
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByRole('status')).toContainText('Si existe una cuenta');

    const mail = await waitForMail(email, before);
    // Plantilla por defecto de Supabase: /verify → vuelve con ?code= (flujo PKCE).
    const link = mail.links.find(l => l.includes('/verify'));
    expect(link, 'enlace de recuperación').toBeTruthy();
    await page.goto(link!);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page).toHaveURL(/\/cuenta\/contrasena$/);
    await page.locator('#password').fill('Clave-nueva-1234');
    await page.locator('#password2').fill('Clave-nueva-1234');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByRole('status')).toContainText('Contraseña cambiada.');

    await logout(page);
    await login(page, email, PASSWORD);
    await expect(page.getByRole('alert')).toContainText('no son correctos');
    await login(page, email, 'Clave-nueva-1234');
    await expect(page).toHaveURL(/\/cuenta$/);
  });

  test('un enlace de correo inventado o gastado no da acceso', async ({ page }) => {
    await page.goto('/auth/confirmar?token_hash=inventado&type=recovery');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('alert')).toContainText(/caducado|no es válido|ya se ha usado/);
    await page.goto('/cuenta');
    await expect(page).toHaveURL(/\/acceso/);
  });

  test('pedir recuperación para un correo inexistente no revela nada', async ({ page }) => {
    await page.goto('/recuperar');
    await page.getByLabel('Correo electrónico').fill(uniqueEmail('nadie'));
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByRole('status')).toContainText('Si existe una cuenta');
  });
});

// ---------------------------------------------------------------- invitaciones
test.describe('Invitaciones', () => {
  test.skip(({ isMobile }) => isMobile, 'Flujo completo: basta con escritorio');

  test('la propietaria invita → la persona crea su cuenta, confirma y entra como mecánico', async ({ page }) => {
    const email = uniqueEmail('invitada');
    await login(page, 'propietaria@e2e.test', PASSWORD, '/panel/equipo');
    await page.getByLabel('Correo de la persona').fill(email);
    await page.getByLabel('Rol', { exact: true }).selectOption('mecanico');
    await page.getByRole('button', { name: 'Crear invitación' }).click();
    const linkInput = page.getByLabel('Enlace de invitación');
    await expect(linkInput).toBeVisible();
    const inviteUrl = await linkInput.inputValue();
    expect(inviteUrl).toMatch(/\/invitacion\?token=[0-9a-f]{64}$/);
    await expect(page.locator('.invite-list')).toContainText(email);
    await logout(page);

    // Sin sesión: la invitación manda a iniciar sesión; desde ahí, a crear la cuenta.
    await page.goto(inviteUrl);
    await expect(page).toHaveURL(/\/acceso\?next=%2Finvitacion/);
    await page.getByRole('link', { name: 'Crear una cuenta' }).click();
    await page.getByLabel('Nombre y apellidos').fill('Iván Invitado');
    await page.getByLabel('Correo electrónico').fill(email);
    await page.locator('#password').fill('Clave-invitado-1');
    await page.locator('#password2').fill('Clave-invitado-1');
    await page.getByRole('checkbox').check();
    const before = (await mails(email)).length;
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();

    const mail = await waitForMail(email, before);
    await page.goto(mail.links.find(l => l.includes('/auth/confirmar'))!);
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
    await expect(page).toHaveURL(/\/invitacion\?token=/);
    await expect(page.getByRole('heading', { name: 'Únete a Taller Demo' })).toBeVisible();
    await expect(page.getByText('Mecánico/a')).toBeVisible();
    await page.getByRole('button', { name: 'Aceptar la invitación' }).click();
    await expect(page).toHaveURL(/\/cuenta\?bienvenida=1/);
    await expect(page.locator('.workshop-list')).toContainText('Taller Demo');
    await expect(page.locator('.workshop-list')).toContainText('Mecánico/a');

    // El mismo enlace no sirve dos veces.
    await page.goto(inviteUrl);
    await expect(page.getByRole('alert')).toContainText('ya se ha usado');
  });

  test('una invitación abierta con otra cuenta no se puede aceptar', async ({ page }) => {
    await login(page, 'propietaria@e2e.test', PASSWORD, '/panel/equipo');
    await page.getByLabel('Correo de la persona').fill(uniqueEmail('para-otra'));
    await page.getByRole('button', { name: 'Crear invitación' }).click();
    const inviteUrl = await page.getByLabel('Enlace de invitación').inputValue();
    await logout(page);

    await login(page, 'otro@e2e.test');
    await page.goto(inviteUrl);
    await expect(page.getByRole('alert')).toContainText('Esta invitación es para');
    await expect(page.getByRole('button', { name: 'Aceptar la invitación' })).toHaveCount(0);
    // Ni forzando el envío desde el navegador con la sesión de esa otra cuenta.
    const forced = await page.evaluate(async token => {
      const res = await fetch(location.href, { method: 'POST', body: new URLSearchParams({ token }) });
      return { status: res.status, text: await res.text() };
    }, new URL(inviteUrl).searchParams.get('token')!);
    expect(forced.status).toBe(400);
    expect(forced.text).toContain('otra dirección de correo');
  });

  test('un mecánico no puede crear invitaciones aunque llame a la API', async () => {
    const { token } = await tokenFor('mecanico@e2e.test');
    const res = await api('/rpc/create_workshop_invitation', {
      token, method: 'POST', body: { p_workshop_id: DEMO, p_email: 'colado@e2e.test', p_role: 'mecanico' },
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------- aislamiento por API con tokens reales
test.describe('Seguridad de la API con tokens reales de Supabase Auth', () => {
  test.skip(({ isMobile }) => isMobile, 'Pruebas de API: basta con un proyecto');

  test('un visitante sin sesión no lee datos privados', async () => {
    for (const path of ['/profiles', '/workshop_members', '/workshop_invitations?select=id', '/web_requests?select=id', '/vehicles', '/customers']) {
      const res = await api(path);
      expect(res.status, `anónimo en ${path}`).not.toBe(200);
    }
    const accept = await api('/rpc/accept_workshop_invitation', { method: 'POST', body: { p_token: 'x' } });
    expect(accept.status).not.toBe(200);
  });

  test('un token falsificado se rechaza', async () => {
    // Firmado con OTRO secreto: PostgREST no lo acepta.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ role: 'authenticated', sub: '00000000-0000-0000-0000-000000000001', exp: 4102444800 })).toString('base64url');
    const res = await api('/vehicles', { token: `${header}.${payload}.firma-falsa` });
    expect(res.status).toBe(401);
  });

  test('cada usuario solo ve su propio perfil', async () => {
    const { token, userId } = await tokenFor('mecanico@e2e.test');
    const res = await api('/profiles?select=id,full_name', { token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual([{ id: userId, full_name: 'Marcos Mecánico' }]);
    const { userId: ownerId } = await tokenFor('propietaria@e2e.test');
    const other = await api(`/profiles?id=eq.${ownerId}`, { token });
    expect(other.json).toEqual([]);
  });

  test('el mecánico no puede convertirse en propietario', async () => {
    const { token, userId } = await tokenFor('mecanico@e2e.test');
    const patch = await api(`/workshop_members?user_id=eq.${userId}`, { token, method: 'PATCH', body: { role: 'propietario' } });
    expect(patch.json).toEqual([]); // RLS: ninguna fila modificada
    const rpc = await api('/rpc/set_member_role', { token, method: 'POST', body: { p_workshop_id: DEMO, p_user_id: userId, p_role: 'propietario' } });
    expect(rpc.status).toBe(403);
    const check = await api(`/workshop_members?user_id=eq.${userId}&select=role`, { key: SERVICE });
    expect(check.json).toEqual([{ role: 'mecanico' }]);
  });

  test('nadie se añade a un taller ajeno manipulando la petición', async () => {
    const { token, userId } = await tokenFor('mecanico@e2e.test');
    const otro = (await api('/workshops?slug=eq.taller-otro&select=id', { key: SERVICE })).json as Array<{ id: string }>;
    const res = await api('/workshop_members', { token, method: 'POST', body: { workshop_id: otro[0]!.id, user_id: userId, role: 'propietario' } });
    expect(res.status).toBe(403);
    const invite = await api('/rpc/create_workshop_invitation', {
      token: (await tokenFor('propietaria@e2e.test')).token,
      method: 'POST', body: { p_workshop_id: otro[0]!.id, p_email: 'yo@e2e.test', p_role: 'administrador' },
    });
    expect(invite.status, 'la propietaria de A no invita en B').toBe(403);
  });

  test('un miembro de un taller no ve los datos privados de otro', async () => {
    const { token } = await tokenFor('propietaria@e2e.test');
    const vehicles = (await api('/vehicles?select=plate,workshop_id', { token })).json as Array<{ plate: string; workshop_id: string }>;
    expect(vehicles.length).toBeGreaterThan(0);
    expect(vehicles.every(v => v.workshop_id === DEMO)).toBe(true);
    expect(vehicles.some(v => v.plate === '9999ZZZ')).toBe(false);
    const otro = await tokenFor('otro@e2e.test');
    const requests = await api(`/web_requests?workshop_id=eq.${DEMO}&select=id`, { token: otro.token });
    expect(requests.json).toEqual([]);
    const team = await api('/rpc/workshop_team', { token: otro.token, method: 'POST', body: { p_workshop_id: DEMO } });
    expect(team.status).toBe(403);
  });

  test('cambiar los datos del propio usuario no da privilegios', async () => {
    const { token } = await tokenFor('mecanico@e2e.test');
    // user_metadata lo puede cambiar cualquiera: no se usa para permisos.
    const upd = await fetch(`${AUTH}/user`, {
      method: 'PUT',
      headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data: { role: 'propietario', is_platform_admin: true } }),
    });
    expect(upd.status).toBe(200);
    const fresh = await tokenFor('mecanico@e2e.test');
    const vehicles = (await api('/vehicles?plate=eq.9999ZZZ', { token: fresh.token })).json;
    expect(vehicles).toEqual([]);
    const admin = await api('/platform_admins', { token: fresh.token, method: 'POST', body: { user_id: fresh.userId } });
    expect(admin.status).toBe(403);
    const priv = await api('/rpc/create_workshop', { token: fresh.token, method: 'POST', body: { p_slug: 'x', p_name: 'x', p_owner_email: 'x' } });
    expect(priv.status, 'la función privada de alta no está en la API').toBe(404);
  });
});
