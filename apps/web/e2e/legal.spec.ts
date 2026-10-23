/**
 * Información legal con base de datos y Supabase Auth REALES: los datos del
 * titular que guarda el taller salen en su aviso legal y su privacidad; la
 * propietaria acepta las condiciones y el contrato de encargo; el resguardo de
 * depósito se imprime desde la orden; lo que falta se marca, nunca se inventa.
 *
 * Lanza con scripts/test-e2e.sh (cuentas: propietaria@e2e.test, gestora@e2e.test).
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');
test.describe.configure({ mode: 'serial' });

async function login(page: Page, email: string, next = '/panel') {
  await page.context().clearCookies();
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}

test('los datos legales del taller salen en su aviso legal y su privacidad', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'gestora@e2e.test', '/panel/taller');
  await page.getByLabel(/Razón social/).fill('Talleres Demo E2E SL');
  await page.getByLabel(/NIF \/ CIF/).fill('B12345678');
  await page.getByLabel(/^Dirección \(sale/).fill('Calle de Prueba 1');
  await page.getByLabel('Código postal').fill('28001');
  await page.getByLabel('Localidad').fill('Madrid');
  await page.getByLabel(/Correo para asuntos legales/).fill('no-es-correo');
  await page.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByText('Correo electrónico no válido.')).toBeVisible();
  await page.getByLabel(/Correo para asuntos legales/).fill('Legal@Demo-E2E.test');
  await page.getByLabel(/Inscripción registral/).fill('Registro Mercantil de Madrid (prueba)');
  await page.getByRole('button', { name: 'Guardar datos' }).click();
  await expect(page.getByRole('status')).toContainText('Datos del taller guardados.');

  // La web pública se cachea un minuto: se espera a que salgan los datos nuevos.
  await expect.poll(async () => {
    await page.goto('/aviso-legal');
    return page.locator('main').innerText();
  }, { timeout: 75_000, intervals: [3000] }).toContain('legal@demo-e2e.test');
  const main = page.locator('main');
  await expect(main).toContainText('Talleres Demo E2E SL');
  await expect(main).toContainText('NIF: B12345678');
  await expect(main).toContainText('Calle de Prueba 1, 28001 Madrid');
  await expect(main).toContainText('Registro Mercantil de Madrid (prueba)');
  await expect(main.locator('.legal-missing')).toHaveCount(0);
  await expect(main).not.toContainText('Faltan datos del titular');

  await page.goto('/privacidad');
  await expect(page.locator('main')).toContainText('Talleres Demo E2E SL');
  await expect(page.locator('main')).toContainText('Agencia Española de Protección de Datos');
  await expect(page.locator('main .legal-missing')).toHaveCount(0);
  await page.goto('/cookies');
  await expect(page.locator('main')).not.toContainText('Texto pendiente');
});

test('la plataforma marca lo que falta en vez de inventarlo', async ({ page }) => {
  for (const path of ['/condiciones', '/encargo', '/privacidad-cuenta']) {
    await page.goto(path);
    await expect(page.getByRole('note')).toContainText('Faltan datos del titular de la plataforma');
    await expect(page.locator('.legal-missing').first()).toContainText('[Falta:');
  }
  await page.goto('/encargo');
  await expect(page.locator('main')).toContainText('artículo 28');
  await expect(page.getByRole('table')).toContainText('Supabase');
});

test('solo la propietaria acepta las condiciones y el contrato de encargo', async ({ page, isMobile }) => {
  test.skip(isMobile, 'La aceptación queda guardada: se prueba una vez (escritorio)');
  await login(page, 'gestora@e2e.test', '/panel/taller');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Condiciones y protección de datos' }) });
  await expect(card).toContainText('la persona propietaria del taller tiene que aceptar');
  await expect(card.getByRole('button', { name: 'Aceptar' })).toHaveCount(0);

  await login(page, 'propietaria@e2e.test', '/panel');
  await expect(page.getByRole('note').filter({ hasText: 'Falta aceptar las condiciones' })).toBeVisible();
  await page.goto('/panel/taller');
  await card.getByRole('button', { name: 'Aceptar' }).click();
  await expect(page.getByRole('alert')).toContainText('Marca la casilla');
  await card.getByLabel(/He leído y acepto/).check();
  await card.getByRole('button', { name: 'Aceptar' }).click();
  await expect(page.getByRole('status')).toContainText('Condiciones y contrato de encargo aceptados');
  await expect(card).toContainText('Aceptadas las condiciones del servicio');
  await page.goto('/panel');
  await expect(page.getByRole('note').filter({ hasText: 'Falta aceptar las condiciones' })).toHaveCount(0);
});

test('resguardo de depósito imprimible desde la orden', async ({ page }) => {
  // Una orden de prueba (cliente y vehículo nuevos), creada como la oficina por la API.
  const auth = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'propietaria@e2e.test', password: PASSWORD }),
  });
  const tok = ((await auth.json()) as { access_token: string }).access_token;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${PROXY}/rest/v1${path}`, {
      method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation' }, body: JSON.stringify(body),
    });
    return ((await r.json()) as Array<{ id: string }>)[0]!.id;
  };
  const plate = `${Math.floor(1000 + Math.random() * 8999)}XKL`;
  const customer = await post('/customers', { workshop_id: DEMO, full_name: 'Cliente Resguardo', phone: '600111222' });
  const vehicle = await post('/vehicles', { workshop_id: DEMO, customer_id: customer, plate, make: 'Seat', model: 'Ibiza', year: 2017, year_kind: 'fabricacion' });
  const order = await post('/repair_orders', { workshop_id: DEMO, vehicle_id: vehicle, customer_id: customer, problem_description: 'Ruido en la suspensión', mileage_in: 123456 });

  await login(page, 'propietaria@e2e.test', `/panel/ordenes/${order}`);
  await page.getByRole('link', { name: 'Resguardo de depósito' }).click();
  await expect(page).toHaveURL(/\/resguardo$/);
  await expect(page.getByRole('heading', { name: 'Resguardo de depósito' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Presenta este resguardo para recoger el vehículo.');
  await expect(page.locator('main')).toContainText('Real Decreto 1457/1986');
  await expect(page.locator('main')).toContainText('NIF B12345678');
  await expect(page.locator('main')).toContainText('Ruido en la suspensión');
  await expect(page.locator('main')).toContainText('123.456');
  await expect(page.getByText('Firma del cliente')).toBeVisible();
});
