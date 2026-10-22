/**
 * Integración del producto: que cada función existente se encuentre desde la
 * navegación, guarde de verdad, persista al recargar y respete los permisos.
 * Navegador → web → Supabase Auth real + PostgREST → PostgreSQL con RLS.
 */
import { expect, test, type Page } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const DIRECT_REST = process.env.E2E_REST_URL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !SERVICE, 'Lanza estas pruebas con scripts/test-e2e.sh');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function login(page: Page, email: string, next = '/panel') {
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}

async function tokenFor(email: string) {
  const res = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
}

/** Lectura con la clave del sistema (solo para comprobar lo guardado). */
async function adminRows(path: string) {
  const res = await fetch(`${DIRECT_REST}${path}`, { headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as Array<Record<string, unknown>>;
}

// ======================================================================
test.describe('Navegación', () => {
  for (const [path, navName, menuName] of [['/', 'Secciones', 'Menú'], ['/clasico', 'Principal', 'Abrir menú']] as const) {
    test(`la web pública (${path}) lleva al área de clientes`, async ({ page, isMobile }) => {
      await page.goto(path);
      if (isMobile) await page.getByRole('button', { name: menuName, exact: true }).click();
      await page.getByRole('navigation', { name: navName }).getByRole('link', { name: 'Área de clientes' }).click();
      // Desde la web de un taller se recuerda el taller: tras entrar, se comprueba la relación con ÉL.
      await expect(page).toHaveURL(/\/acceso\?next=%2Fportal%2Fentrar%2F[a-z0-9-]+$/);
      await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    });
  }

  test('escritorio: la gestora ve todas las secciones; el mecánico, solo las suyas', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Escritorio');
    await login(page, 'gestora@e2e.test');
    const side = page.locator('.pnl-side');
    for (const name of ['Inicio', 'Órdenes', 'Vehículos', 'Clientes', 'Equipo', 'Avisos', 'Solicitudes web', 'Taller', 'Mi cuenta']) {
      await expect(side.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await side.getByRole('link', { name: 'Taller', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Taller', exact: true })).toBeVisible();

    await page.context().clearCookies(); await acceptCookies(page.context());
    await login(page, 'mecanico@e2e.test');
    for (const name of ['Avisos', 'Solicitudes web', 'Taller']) {
      await expect(page.locator('.pnl-side').getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    // Entrar escribiendo la dirección tampoco enseña nada.
    for (const path of ['/panel/taller', '/panel/solicitudes', '/panel/avisos']) {
      await page.goto(path);
      await expect(page.locator('.empty')).toContainText('Solo el propietario o un administrador');
    }
  });

  test('móvil: el menú «Más» lleva a las secciones que no caben en las pestañas', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Solo móvil');
    await login(page, 'gestora@e2e.test');
    const tabs = page.locator('.pnl-tabs');
    await expect(tabs).toBeVisible();
    await tabs.getByText('Más', { exact: true }).click();
    for (const name of ['Equipo', 'Avisos', 'Solicitudes web', 'Taller', 'Mi cuenta']) {
      await expect(tabs.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await tabs.getByRole('link', { name: 'Solicitudes web' }).click();
    await expect(page).toHaveURL(/\/panel\/solicitudes$/);
    await expect(page.getByRole('heading', { name: 'Solicitudes web' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.context().clearCookies(); await acceptCookies(page.context());
    await login(page, 'mecanico@e2e.test');
    await page.locator('.pnl-tabs').getByText('Más', { exact: true }).click();
    await expect(page.locator('.pnl-tabs').getByRole('link', { name: 'Mi cuenta' })).toBeVisible();
    await expect(page.locator('.pnl-tabs').getByRole('link', { name: 'Taller', exact: true })).toHaveCount(0);
  });
});

// ======================================================================
test.describe('Datos del taller', () => {
  test.skip(({ isMobile }) => isMobile, 'Escritorio');

  test('la propietaria los guarda, se ven al recargar y los errores se explican', async ({ page }) => {
    const phone = `949 ${stamp().slice(-6)}`;
    await login(page, 'propietaria@e2e.test', '/panel/taller');
    await expect(page.getByText('Formularios de la web (antispam):')).toBeVisible();

    await page.getByLabel('Correo de contacto').fill('no-es-un-correo');
    await page.getByRole('button', { name: 'Guardar datos' }).click();
    await expect(page.getByRole('alert').first()).toContainText('Revisa los campos marcados.');
    await expect(page.getByText('Correo electrónico no válido.')).toBeVisible();

    await page.getByLabel('Correo de contacto').fill('Hola@TallerDemo.test');
    await page.getByLabel('Teléfono de contacto').fill(phone);
    await page.getByRole('button', { name: 'Guardar datos' }).click();
    await expect(page).toHaveURL(/\/panel\/taller\?guardado=1$/);
    await expect(page.getByRole('status')).toContainText('Datos del taller guardados.');
    await page.goto('/panel/taller');
    await expect(page.getByLabel('Teléfono de contacto')).toHaveValue(phone);
    await expect(page.getByLabel('Correo de contacto')).toHaveValue('hola@tallerdemo.test');
    const [row] = await adminRows(`/workshops?id=eq.${DEMO}&select=contact_phone,contact_email`);
    expect(row).toEqual({ contact_phone: phone, contact_email: 'hola@tallerdemo.test' });
  });

  test('un mecánico no los cambia ni enviando el formulario ni por la API', async ({ page }) => {
    await login(page, 'mecanico@e2e.test');
    const posted = await page.evaluate(async () => {
      const res = await fetch('/panel/taller', { method: 'POST', body: new URLSearchParams({ action: 'datos', name: 'Taller Colado' }) });
      return res.status;
    });
    expect(posted).toBe(403);
    const token = await tokenFor('mecanico@e2e.test');
    const res = await api(`/workshops?id=eq.${DEMO}`, token, 'PATCH', { name: 'Taller Colado' });
    expect(res.json).toEqual([]);
    const [row] = await adminRows(`/workshops?id=eq.${DEMO}&select=name`);
    expect(row!.name).toBe('AutoValue');
  });
});

// ======================================================================
test.describe('Solicitudes web', () => {
  test.skip(({ isMobile }) => isMobile, 'Escritorio');

  test('de la web al panel, y borrado en dos pasos solo por gestores', async ({ page }) => {
    const name = `E2E Borrar ${stamp()}`;
    await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
    await page.goto('/#solicitar');
    await page.getByRole('tab', { name: 'Pedir cita' }).click();
    const form = page.locator('#solicitar-cita');
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('Teléfono').fill('600 111 222');
    await form.getByLabel('Servicio').selectOption({ label: 'Frenos' });
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();
    await expect(form.getByRole('heading', { name: 'Solicitud de cita recibida' })).toBeVisible();
    const [saved] = await adminRows(`/web_requests?name=eq.${encodeURIComponent(name)}&select=id`);
    expect(saved).toBeTruthy();

    // Un mecánico no puede borrarla aunque llame a la API.
    const mech = await tokenFor('mecanico@e2e.test');
    const denied = await api(`/web_requests?id=eq.${saved!.id}`, mech, 'DELETE');
    expect(denied.status).toBe(403);
    expect(await adminRows(`/web_requests?id=eq.${saved!.id}&select=id`)).toHaveLength(1);

    await page.setExtraHTTPHeaders({});
    await login(page, 'gestora@e2e.test', '/panel/solicitudes');
    const item = page.locator('.notice', { hasText: name });
    await expect(item).toContainText('sin atender');
    await item.getByRole('button', { name: /^Borrar…/ }).click();
    const again = page.locator('.notice', { hasText: name });
    await expect(again.getByText('Se elimina con todos sus datos')).toBeVisible();
    await again.getByRole('button', { name: 'Sí, borrar' }).click();
    await expect(page.getByRole('status')).toContainText('Solicitud borrada definitivamente.');
    await page.reload();
    await expect(page.locator('.notice', { hasText: name })).toHaveCount(0);
    expect(await adminRows(`/web_requests?id=eq.${saved!.id}&select=id`)).toHaveLength(0);
  });
});

// ======================================================================
test.describe('Clientes: historial de comunicaciones', () => {
  test.skip(({ isMobile }) => isMobile, 'Escritorio');

  test('el cambio hecho por el taller queda registrado y visible para gestores', async ({ page }) => {
    const name = `Cliente Avisos ${stamp()}`;
    await login(page, 'propietaria@e2e.test', '/panel/clientes/nuevo');
    await page.getByLabel('Nombre completo o nombre comercial').fill(name);
    await page.getByLabel('Correo electrónico').fill(`avisos-${stamp()}@e2e.test`);
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    const url = page.url().replace(/\?.*$/, '');

    await page.getByRole('button', { name: 'Desactivar avisos por email' }).click();
    await expect(page.getByRole('button', { name: 'Reactivar avisos por email' })).toBeVisible();
    await page.goto(url);
    await page.getByText(/^Historial de cambios de comunicaciones/).click();
    await expect(page.locator('.timeline').last()).toContainText('Avisos de reparaciones por email: desactivado · por el taller');

    await page.context().clearCookies(); await acceptCookies(page.context());
    await login(page, 'mecanico@e2e.test', url.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByText(/^Historial de cambios de comunicaciones/)).toHaveCount(0);
  });
});

// ======================================================================
test.describe('Botones «Volver»', () => {
  test('acceso, registro, páginas legales y cuenta llevan a su página anterior', async ({ page }) => {
    await page.goto('/acceso');
    await page.getByRole('link', { name: 'Volver a la web' }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/registro');
    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/\/acceso$/);

    for (const path of ['/privacidad', '/aviso-legal', '/cookies']) {
      await page.goto(path);
      await page.locator('.back-link').click();
      await expect(page).toHaveURL(/\/$/);
    }

    await page.goto('/pagina-que-no-existe');
    await page.getByRole('link', { name: 'Volver al inicio' }).click();
    await expect(page).toHaveURL(/\/$/);

    await login(page, 'propietaria@e2e.test', '/cuenta/contrasena');
    await page.getByRole('link', { name: 'Volver a mi cuenta' }).click();
    await expect(page).toHaveURL(/\/cuenta$/);
    await page.getByRole('link', { name: 'Volver al panel' }).click();
    await expect(page).toHaveURL(/\/panel$/);
  });
});
