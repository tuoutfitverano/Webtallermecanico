/**
 * Consulta de datos por matrícula desde el panel (Fase 6).
 *
 * ⚠ PROVEEDOR SIMULADO: scripts/test-e2e.sh arranca scripts/e2e/plate-provider-mock.mjs,
 * que imita la forma de la API de Openapi. Estas pruebas comprueban NUESTRO
 * código (formulario, servidor, base de datos y permisos) de verdad, pero NO
 * son consultas a un proveedor real ni demuestran que sus datos sean correctos.
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const MOCK = process.env.E2E_PLATE_MOCK_URL ?? '';
const WEB = process.env.E2E_API_URL ?? '';
const HOST = new URL(process.env.E2E_BASE_URL ?? 'http://demo.localhost:4329').host;
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PASSWORD || !MOCK, 'Lanza estas pruebas con scripts/test-e2e.sh');
test.skip(({ isMobile }) => isMobile, 'El flujo se comprueba en escritorio; el formulario es el mismo en móvil');

function newPlate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  const n = Math.floor(1000 + Math.random() * 9000).toString();
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  return { typed: `${n} ${l.toLowerCase()}`, normalized: `${n}${l}`, display: `${n} ${l}` };
}
const mockCalls = async (plate: string) => ((await (await fetch(`${MOCK}/__calls?plate=${plate}`)).json()) as { calls: number }).calls;

async function login(page: Page, email: string, next: string) {
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
async function api(path: string, token: string | null, method = 'GET', body?: unknown) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${token ?? ANON}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
}

test.describe('Consulta por matrícula · flujo en el panel', () => {
  test('consultar → revisar → usar solo lo marcado → guardar (sin pisar lo escrito a mano)', async ({ page }) => {
    const plate = newPlate();
    await login(page, 'propietaria@e2e.test', '/panel/vehiculos/nuevo');
    await page.getByLabel('Matrícula', { exact: true }).fill(plate.typed);
    // Dato escrito a mano ANTES de consultar: no se debe sustituir sin permiso.
    await page.getByLabel('Modelo', { exact: true }).fill('Ibiza FR de mi cliente');
    await page.getByRole('button', { name: 'Consultar datos' }).click();

    const review = page.getByRole('region', { name: `Datos devueltos para ${plate.display}` });
    await expect(review).toBeVisible();
    await expect(review).toContainText('Fuente: Openapi (Spanish Car Check)');
    await expect(review.getByRole('checkbox', { name: /Marca: SEAT/ })).toBeChecked();
    await expect(review.getByRole('checkbox', { name: /Modelo: IBIZA/ })).not.toBeChecked();
    await expect(review).toContainText('Has escrito «Ibiza FR de mi cliente»');
    await expect(review).toContainText('Versión: 1.0 TSI STYLE');
    expect(await mockCalls(plate.normalized)).toBe(1);

    // Consultar no crea nada.
    const owner = await tokenFor('propietaria@e2e.test');
    expect((await api(`/vehicles?plate=eq.${plate.normalized}&select=id`, owner)).json).toEqual([]);

    await review.getByRole('button', { name: 'Usar los datos marcados' }).click();
    await expect(page.getByRole('status')).toContainText('Datos del proveedor pasados al formulario');
    await expect(page.getByLabel('Marca', { exact: true })).toHaveValue('SEAT');
    await expect(page.getByLabel('Modelo', { exact: true })).toHaveValue('Ibiza FR de mi cliente');
    await expect(page.getByLabel(/^Año/)).toHaveValue('2015');
    await expect(page.getByLabel('Ese año es de…')).toHaveValue('primera_matriculacion');
    await expect(page.getByLabel(/Combustible/)).toHaveValue('diesel');
    expect((await api(`/vehicles?plate=eq.${plate.normalized}&select=id`, owner)).json).toEqual([]);

    await page.getByRole('button', { name: 'Guardar vehículo' }).click();
    await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
    const card = page.getByRole('region', { name: 'Datos de la consulta por matrícula' });
    await expect(card).toContainText('Openapi (Spanish Car Check)');
    await expect(card).toContainText('SEAT · tal como lo dio el proveedor');
    await expect(card).toContainText('IBIZA · cambiado a mano');
    await expect(page.getByRole('region', { name: 'Ficha' })).toContainText('Proveedor externo');

    const saved = (await api(`/vehicles?plate=eq.${plate.normalized}&select=make,model,data_source,verification_status,lookup_fields`, owner)).json as Array<Record<string, unknown>>;
    expect(saved[0]).toMatchObject({ make: 'SEAT', model: 'Ibiza FR de mi cliente', data_source: 'proveedor_externo', verification_status: 'pendiente' });

    // Volver a consultar la misma matrícula en el taller reutiliza la respuesta: no se vuelve a pagar.
    await page.goto('/panel/vehiculos/nuevo');
    await page.getByLabel('Matrícula', { exact: true }).fill(plate.normalized);
    await page.getByRole('button', { name: 'Consultar datos' }).click();
    await expect(page.getByText('reutilizada una consulta reciente de tu taller')).toBeVisible();
    expect(await mockCalls(plate.normalized)).toBe(1);
  });

  test('cada fallo del proveedor se explica y el alta manual sigue funcionando', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, 'gestora@e2e.test', '/panel/vehiculos/nuevo');
    const cases: Array<[string, RegExp]> = [
      ['0000BBB', /no tiene datos de esta matrícula/],
      ['2222BBB', /datos que no podemos usar/],
      ['3333BBB', /no acepta más consultas/],
      ['4444BBB', /problema de configuración del proveedor/],
      ['1111BBB', /no responde/],
    ];
    for (const [plate, message] of cases) {
      await page.getByLabel('Matrícula', { exact: true }).fill(plate);
      await page.getByRole('button', { name: 'Consultar datos' }).click();
      await expect(page.getByRole('alert')).toContainText(message);
      // Ningún detalle técnico ni el token a la vista.
      await expect(page.locator('body')).not.toContainText(/token|Bearer|stack|ES-car/i);
    }
    // Una matrícula no española sin confirmar no se envía al proveedor.
    await page.getByLabel('Matrícula', { exact: true }).fill('ZZ999999XX');
    await page.getByRole('button', { name: 'Consultar datos' }).click();
    await expect(page.getByRole('alert')).toContainText('No parece una matrícula española');
    expect(await mockCalls('ZZ999999XX')).toBe(0);

    // Alta manual sin usar la consulta.
    const plate = newPlate();
    await page.getByLabel('Matrícula', { exact: true }).fill(plate.typed);
    await page.getByLabel('Marca', { exact: true }).fill('Citroën');
    await page.getByLabel('Modelo', { exact: true }).fill('C3');
    await page.getByLabel(/^Año/).fill('2018');
    await page.getByLabel(/Ese año es de/).selectOption('fabricacion');
    await page.getByRole('button', { name: 'Guardar vehículo' }).click();
    await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
    await expect(page.getByRole('region', { name: 'Ficha' })).toContainText('Introducidos manualmente');
    await expect(page.getByRole('region', { name: 'Datos de la consulta por matrícula' })).toHaveCount(0);
    expect(await mockCalls(plate.normalized)).toBe(0);
  });

  test('pulsar Intro en el formulario guarda; no lanza una consulta de pago', async ({ page }) => {
    const plate = newPlate();
    await login(page, 'propietaria@e2e.test', '/panel/vehiculos/nuevo');
    await page.getByLabel('Matrícula', { exact: true }).fill(plate.typed);
    await page.getByLabel('Marca', { exact: true }).fill('Kia');
    await page.getByLabel('Modelo', { exact: true }).fill('Ceed');
    await page.getByLabel(/^Año/).fill('2020');
    await page.getByLabel(/Ese año es de/).selectOption('fabricacion');
    await page.getByLabel('Modelo', { exact: true }).press('Enter');
    await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
    expect(await mockCalls(plate.normalized)).toBe(0);
  });
});

test.describe('Consulta por matrícula · permisos', () => {
  test('sin sesión, desde el portal o desde otro taller no se puede consultar', async ({ page }) => {
    const plate = newPlate().normalized;
    const args = { p_workshop_id: DEMO, p_plate: plate, p_provider: 'openapi', p_request_key: crypto.randomUUID() };

    // Sin sesión.
    expect((await api('/rpc/start_vehicle_lookup', null, 'POST', args)).status).toBeGreaterThanOrEqual(400);
    const res = await fetch(`${WEB}/panel/vehiculos/nuevo`, {
      method: 'POST', redirect: 'manual',
      headers: { host: HOST, origin: `http://${HOST}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'consultar', plate, lookup_key: crypto.randomUUID() }),
    });
    // Rechazada (403 por origen) o enviada a iniciar sesión: en ningún caso se consulta.
    expect([303, 403]).toContain(res.status);
    if (res.status === 303) expect(res.headers.get('location')).toContain('/acceso');

    // Otro taller con el id del taller demo.
    const otro = await tokenFor('otro@e2e.test');
    expect((await api('/rpc/start_vehicle_lookup', otro, 'POST', { ...args, p_request_key: crypto.randomUUID() })).status).toBeGreaterThanOrEqual(400);
    expect((await api('/vehicle_lookups?select=id', otro)).json).toEqual([]);

    // Nadie con su token escribe resultados "del proveedor".
    const owner = await tokenFor('propietaria@e2e.test');
    const fake = await api('/rpc/complete_vehicle_lookup', owner, 'POST', { p_lookup_id: crypto.randomUUID(), p_status: 'encontrado', p_result: { make: 'FALSO' } });
    expect(fake.status).toBeGreaterThanOrEqual(400);
    expect(await mockCalls(plate)).toBe(0);

    // Un cliente del portal no entra en el panel (ni en su formulario de vehículos).
    await page.goto('/panel/vehiculos/nuevo');
    await expect(page).toHaveURL(/\/acceso/);
  });

  test('las consultas del taller demo no se ven ni se reutilizan desde otro taller', async () => {
    const owner = await tokenFor('propietaria@e2e.test');
    const mine = (await api('/vehicle_lookups?select=id,workshop_id', owner)).json as Array<{ workshop_id: string }>;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every(l => l.workshop_id === DEMO)).toBe(true);
    const otro = await tokenFor('otro@e2e.test');
    expect((await api('/vehicle_lookups?select=id', otro)).json).toEqual([]);
  });
});
