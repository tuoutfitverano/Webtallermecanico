/**
 * Panel del taller con base de datos y Supabase Auth REALES.
 *
 * Cuentas (scripts/test-e2e.sh, contraseña E2E_PASSWORD):
 *   propietaria@e2e.test (propietaria del taller demo) · gestora@e2e.test (administradora)
 *   mecanico@e2e.test y temporal@e2e.test (mecánicos) · otro@e2e.test (propietario de "Taller Otro")
 *
 * Las pruebas comparten base de datos y se ejecutan en orden (workers: 1):
 * cada una crea sus propios datos con nombres y matrículas únicos.
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const REST = `${PROXY}/rest/v1`;
const ANON = process.env.E2E_ANON_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
/** Matrícula española válida y única: 4 cifras + 3 consonantes. */
function newPlate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  const n = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  return { typed: `${n} ${l.toLowerCase()}`, normalized: `${n}${l}`, display: `${n} ${l}` };
}

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
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}
async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${REST}${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${token}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as unknown) : null };
}

/** Crea cliente + vehículo + orden asignada al mecánico, como la propietaria. Devuelve las URLs. */
async function createJob(page: Page, opts: { assign?: string } = {}) {
  const name = `Cliente E2E ${stamp()}`;
  const plate = newPlate();
  await page.goto('/panel/clientes/nuevo');
  await page.getByLabel('Nombre completo o nombre comercial').fill(name);
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(page.getByRole('status')).toContainText('Cliente guardado.');
  const customerUrl = page.url().replace(/\?.*$/, '');

  await page.getByRole('link', { name: 'Registrar vehículo' }).click();
  await page.getByLabel('Matrícula').fill(plate.typed);
  await page.getByLabel('Marca').fill('Seat');
  await page.getByLabel('Modelo').fill('Ibiza');
  await page.getByLabel(/^Año/).fill('2016');
  await page.getByLabel(/Ese año es de/).selectOption('fabricacion');
  await page.getByRole('button', { name: 'Guardar vehículo' }).click();
  await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
  const vehicleUrl = page.url().replace(/\?.*$/, '');

  await page.getByRole('link', { name: 'Nueva orden' }).click();
  if (opts.assign) await page.getByLabel(/Mecánico asignado/).selectOption({ label: opts.assign });
  await page.getByLabel(/Descripción del problema/).fill('Ruido metálico al frenar');
  await page.getByRole('button', { name: 'Crear orden' }).click();
  await expect(page.getByRole('status')).toContainText('Orden creada.');
  return { name, plate, customerUrl, vehicleUrl, orderUrl: page.url().replace(/\?.*$/, '') };
}

// ======================================================================
test.describe('Panel · propietaria', () => {
  test.skip(({ isMobile }) => isMobile, 'Flujos completos en escritorio; en móvil hay una prueba propia');

  test('inicio con resumen real, accesos rápidos y navegación', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    await expect(page.getByRole('heading', { name: 'Hoy en el taller' })).toBeVisible();
    for (const label of ['Reparaciones activas', 'Pendientes de diagnosis', 'Esperando recambios', 'Listos para recoger']) {
      await expect(page.locator('.kpi', { hasText: label })).toBeVisible();
    }
    for (const label of ['Crear orden de reparación', 'Registrar vehículo', 'Añadir cliente', 'Ver todas las reparaciones']) {
      await expect(page.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(page.locator('.pnl-workshop-name')).toHaveText('AutoValue');
    await expect(page.locator('.pnl-role')).toHaveText('Propietario/a');
  });

  test('clientes: crear, buscar, editar y evitar duplicados accidentales', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    const name = `Ana Cliente ${stamp()}`;
    const phone = `6${stamp().slice(-8)}`;
    await page.goto('/panel/clientes/nuevo');
    await page.getByLabel('Nombre completo o nombre comercial').fill(name);
    await page.getByLabel(/Teléfono/).fill(phone);
    await page.getByLabel(/Correo electrónico/).fill('no-es-correo');
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByText('Correo electrónico no válido.')).toBeVisible();
    await page.getByLabel(/Correo electrónico/).fill('');
    // NIF con la letra de control equivocada (auditoría H03): se avisa y no se guarda.
    await page.locator('summary', { hasText: 'Datos fiscales' }).click();
    await page.getByLabel('NIF, NIE o CIF').fill('12345678A');
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByText(/letra o el dígito de control no coincide/)).toBeVisible();
    await page.getByLabel('NIF, NIE o CIF').fill('12345678-z');
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();

    await page.goto(`/panel/clientes?q=${encodeURIComponent(name)}`);
    await expect(page.locator('.row-title', { hasText: name })).toBeVisible();
    await page.goto(`/panel/clientes?q=${phone.slice(-6)}`);
    await expect(page.locator('.row-title', { hasText: name })).toBeVisible();

    await page.locator('.row', { hasText: name }).click();
    await page.getByLabel(/Notas internas/).fill('Prefiere que le llamen por la tarde');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Cambios guardados.');
    await expect(page.getByLabel(/Notas internas/)).toHaveValue('Prefiere que le llamen por la tarde');

    // Mismo teléfono escrito de otra forma: avisa y no crea nada hasta confirmar.
    await page.goto('/panel/clientes/nuevo');
    await page.getByLabel('Nombre completo o nombre comercial').fill(`${name} (hijo)`);
    await page.getByLabel(/Teléfono/).fill(`+34 ${phone.slice(0, 3)} ${phone.slice(3)}`);
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByRole('alert')).toContainText('Ya hay un cliente con ese teléfono o correo');
    await expect(page).toHaveURL(/\/panel\/clientes\/nuevo$/);
    await page.getByLabel('Es otra persona: crear la ficha igualmente.').check();
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await expect(page.getByRole('heading', { name: `${name} (hijo)` })).toBeVisible();
  });

  test('vehículos: matrícula normalizada, datos manuales, sin duplicados y ficha', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    const plate = newPlate();
    await page.goto('/panel/vehiculos/nuevo');
    await page.getByLabel('Matrícula').fill(plate.typed);
    await page.getByLabel('Marca').fill('Volkswagen');
    await page.getByLabel('Modelo').fill('Golf');
    await page.getByLabel(/^Año/).fill('2014');
    await page.getByLabel(/Ese año es de/).selectOption('primera_matriculacion');
    await page.getByLabel(/Combustible/).selectOption('gasolina');
    await page.getByRole('button', { name: 'Guardar vehículo' }).click();
    await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
    await expect(page.locator('h1 .plate')).toHaveText(plate.display);
    const ficha = page.locator('.facts');
    await expect(ficha).toContainText('2014');
    await expect(ficha).toContainText('Gasolina');
    await expect(ficha).toContainText('Introducidos manualmente');
    await expect(ficha).toContainText('Pendiente de verificar');

    // La misma matrícula escrita de otra forma no se duplica.
    await page.goto('/panel/vehiculos/nuevo');
    await page.getByLabel('Matrícula').fill(plate.normalized.toLowerCase());
    await page.getByLabel('Marca').fill('Otra');
    await page.getByLabel('Modelo').fill('Coche');
    await page.getByLabel(/^Año/).fill('2010');
    await page.getByLabel(/Ese año es de/).selectOption('fabricacion');
    await page.getByRole('button', { name: 'Guardar vehículo' }).click();
    await expect(page.getByRole('alert')).toContainText('Ya hay un vehículo con esa matrícula en tu taller.');

    // Matrícula, marca, modelo y año obligatorios: el navegador avisa y no envía…
    await page.goto('/panel/vehiculos/nuevo');
    for (const field of [page.getByLabel('Matrícula'), page.getByLabel('Marca'), page.getByLabel('Modelo'), page.getByLabel(/^Año/), page.getByLabel(/Ese año es de/)]) {
      await expect(field).toHaveAttribute('required', '');
    }
    await page.getByLabel('Matrícula').fill(newPlate().typed);
    await page.getByLabel('Marca').fill('Seat');
    await page.getByLabel('Modelo').fill('León');
    expect(await page.getByLabel(/^Año/).evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
    // …y si se salta el navegador, el servidor también lo exige (año sin decir de qué tipo: error claro).
    await page.getByLabel(/^Año/).fill('2019');
    await page.locator('form:has(#year)').evaluate(f => { (f as HTMLFormElement).noValidate = true; });
    await page.getByRole('button', { name: 'Guardar vehículo' }).click();
    await expect(page.getByText('Indica si es el año de fabricación o de primera matriculación.')).toBeVisible();

    await page.goto(`/panel/vehiculos?q=${encodeURIComponent(plate.typed)}`);
    await expect(page.locator('.plate', { hasText: plate.display })).toBeVisible();
  });

  test('órdenes: ciclo completo, asignación, filtros e historial', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    const job = await createJob(page, { assign: 'Marcos Mecánico · Mecánico/a' });
    await expect(page.locator('.status').first()).toHaveText('Vehículo recibido');
    await expect(page.locator('.timeline')).toContainText('Orden creada y asignada a Marcos Mecánico');

    await page.getByRole('button', { name: 'En diagnosis' }).click();
    await expect(page.getByRole('status')).toContainText('Estado actualizado.');
    await expect(page.locator('.timeline')).toContainText('Estado: Vehículo recibido → En diagnosis');

    await page.getByLabel('Diagnosis', { exact: true }).fill('Pastillas delanteras al límite');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Cambios guardados.');
    await expect(page.locator('.timeline')).toContainText('Cambió: diagnosis');
    await expect(page.locator('.timeline li').first()).toContainText('Tú');

    // Listado: búsqueda por matrícula, filtros por estado y por empleado.
    await page.goto(`/panel/ordenes?q=${encodeURIComponent(job.plate.typed)}`);
    await expect(page.locator('.row')).toHaveCount(1);
    await page.goto('/panel/ordenes?estado=diagnosis');
    await expect(page.locator('.plate', { hasText: job.plate.display })).toBeVisible();
    await page.goto('/panel/ordenes?estado=listo');
    await expect(page.locator('.plate', { hasText: job.plate.display })).toHaveCount(0);

    // Historial en la ficha del vehículo y del cliente.
    await page.goto(job.vehicleUrl);
    await expect(page.getByRole('heading', { name: 'Historial de reparaciones' })).toBeVisible();
    await expect(page.locator('.list .status')).toHaveText('En diagnosis');
    await page.goto(job.customerUrl);
    await expect(page.locator('.list .plate', { hasText: job.plate.display })).toHaveCount(2); // vehículo y orden

    // Entrega (solo gestores).
    await page.goto(job.orderUrl);
    await page.getByRole('button', { name: 'Listo para recoger' }).click();
    await expect(page.getByRole('status')).toContainText('Estado actualizado.');
    await page.getByRole('button', { name: 'Entregado' }).click();
    await expect(page.locator('.facts', { hasText: 'Entregada' })).toBeVisible();
  });

  test('borrado con confirmación integrada y protección del historial', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    const job = await createJob(page);
    await page.goto(job.vehicleUrl);
    await page.getByRole('button', { name: 'Borrar vehículo…' }).click();
    await expect(page.getByText('¿Borrar el vehículo')).toBeVisible();
    await page.getByRole('button', { name: 'Sí, borrar definitivamente' }).click();
    await expect(page.getByRole('alert')).toContainText('tiene órdenes de reparación');

    // Un cliente sin órdenes sí se puede borrar.
    await page.goto('/panel/clientes/nuevo');
    const name = `Borrable ${stamp()}`;
    await page.getByLabel('Nombre completo o nombre comercial').fill(name);
    await page.getByRole('button', { name: 'Guardar cliente' }).click();
    await page.getByRole('button', { name: 'Borrar cliente…' }).click();
    await page.getByRole('button', { name: 'Sí, borrar definitivamente' }).click();
    await expect(page).toHaveURL(/\/panel\/clientes\?borrado=1/);
    await expect(page.getByRole('status')).toContainText('Cliente borrado.');
  });

  test('equipo: roles, trabajos asignados y desactivar sin perder el historial', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    const job = await createJob(page, { assign: 'Tomás Temporal · Mecánico/a' });
    await page.goto('/panel/equipo');
    const tomas = page.locator('li', { hasText: 'Tomás Temporal' });
    await expect(tomas).toContainText('Mecánico/a');
    await expect(tomas).toContainText(/\d+ (orden activa|órdenes activas)/);

    await tomas.getByRole('button', { name: 'Desactivar…' }).click();
    await page.getByRole('button', { name: 'Sí, desactivar' }).click();
    await expect(page.getByRole('status')).toContainText('Persona desactivada');
    await expect(page.locator('li', { hasText: 'Tomás Temporal' })).toContainText('Desactivado');

    // La orden conserva a quién estaba asignada.
    await page.goto(job.orderUrl);
    await expect(page.getByRole('combobox', { name: 'Mecánico asignado' })).toHaveValue(/[0-9a-f-]{36}/);
    await expect(page.locator('.timeline')).toContainText('Tomás Temporal');

    await page.goto('/panel/equipo');
    await page.locator('li', { hasText: 'Tomás Temporal' }).getByRole('button', { name: 'Reactivar' }).click();
    await expect(page.getByRole('status')).toContainText('Persona reactivada.');

    // Cambiar el rol de la administradora y devolverlo.
    const gloria = page.locator('li', { hasText: 'Gloria Gestora' });
    await gloria.getByLabel('Rol de Gloria Gestora').selectOption('mecanico');
    await gloria.getByRole('button', { name: 'Cambiar rol' }).click();
    await expect(page.getByRole('status')).toContainText('Rol actualizado.');
    await page.locator('li', { hasText: 'Gloria Gestora' }).getByLabel('Rol de Gloria Gestora').selectOption('administrador');
    await page.locator('li', { hasText: 'Gloria Gestora' }).getByRole('button', { name: 'Cambiar rol' }).click();
    await expect(page.locator('li', { hasText: 'Gloria Gestora' })).toContainText('Administrador/a');
  });
});

// ======================================================================
test.describe('Panel · mecánico', () => {
  test.skip(({ isMobile }) => isMobile, 'Escritorio');

  test('ve y actualiza solo sus trabajos; no entrega, no reasigna, no gestiona el equipo', async ({ page, browser }) => {
    // La propietaria prepara una orden para Marcos y otra sin asignar.
    const owner = await browser.newPage();
    await login(owner, 'propietaria@e2e.test');
    const mine = await createJob(owner, { assign: 'Marcos Mecánico · Mecánico/a' });
    const other = await createJob(owner);
    await owner.close();

    await login(page, 'mecanico@e2e.test');
    await expect(page.locator('.kpi', { hasText: 'Tus reparaciones activas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Crear orden de reparación' })).toHaveCount(0);

    await page.goto(mine.orderUrl);
    await expect(page.getByRole('button', { name: 'Entregado' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Mecánico asignado' })).toHaveCount(0);
    await page.getByLabel('Diagnosis', { exact: true }).fill('Discos rayados');
    await page.getByRole('textbox', { name: 'Notas internas' }).fill('Pedir discos al proveedor');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status')).toContainText('Cambios guardados.');
    await page.getByRole('button', { name: 'Esperando recambios' }).click();
    await expect(page.getByRole('status')).toContainText('Estado actualizado.');

    // Una orden que no es suya: como si no existiera.
    await page.goto(other.orderUrl);
    await expect(page.getByText('Orden no encontrada.')).toBeVisible();
    await page.goto('/panel/ordenes/nueva');
    await expect(page.getByText('Solo la oficina del taller (propietario, administrador o recepción) crea órdenes.')).toBeVisible();

    // Forzando la petición: el servidor y la base de datos lo impiden.
    const forced = await page.evaluate(async url => {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ action: 'estado', status: 'entregado' }) });
      return res.status;
    }, mine.orderUrl);
    expect(forced).toBe(400);

    await page.goto('/panel/equipo');
    await expect(page.getByRole('button', { name: /Desactivar|Cambiar rol/ })).toHaveCount(0);
  });

  test('por API tampoco puede reasignarse, entregar ni tocar órdenes ajenas', async () => {
    const { token, userId } = await tokenFor('mecanico@e2e.test');
    const orders = (await api(`/repair_orders?select=id,assigned_to,status`, token)).json as Array<{ id: string; assigned_to: string; status: string }>;
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every(o => o.assigned_to === userId)).toBe(true);
    const open = orders.find(o => o.status !== 'entregado');
    expect(open, 'una orden sin entregar asignada al mecánico').toBeTruthy();
    const target = open!.id;
    const unassign = await api(`/repair_orders?id=eq.${target}`, token, 'PATCH', { assigned_to: null });
    expect(unassign.status).toBe(403);
    const deliver = await api(`/repair_orders?id=eq.${target}`, token, 'PATCH', { status: 'entregado' });
    expect(deliver.status).toBe(403);
    const history = await api('/repair_order_events', token, 'POST', { order_id: target, workshop_id: DEMO, kind: 'estado' });
    expect(history.status).toBe(403);
    const role = await api('/rpc/set_member_role', token, 'POST', { p_workshop_id: DEMO, p_user_id: userId, p_role: 'administrador' });
    expect(role.status).toBe(403);
    const after = (await api(`/repair_orders?id=eq.${target}&select=status,assigned_to`, token)).json as Array<{ status: string; assigned_to: string }>;
    expect(after[0]!.assigned_to).toBe(userId);
    expect(after[0]!.status).not.toBe('entregado');
  });
});

// ======================================================================
test.describe('Panel · aislamiento entre talleres', () => {
  test.skip(({ isMobile }) => isMobile, 'Escritorio');

  test('otro taller no ve nada del taller demo, ni por URL ni manipulando la cookie', async ({ page, browser, context }) => {
    const owner = await browser.newPage();
    await login(owner, 'propietaria@e2e.test');
    const job = await createJob(owner);
    await owner.close();

    await login(page, 'otro@e2e.test');
    await expect(page.locator('.pnl-workshop-name')).toHaveText('Taller Otro');
    for (const url of [job.orderUrl, job.vehicleUrl, job.customerUrl]) {
      const res = await page.goto(url);
      expect(res?.status()).toBe(404);
      await expect(page.getByText(/no encontrad[oa]/)).toBeVisible();
    }
    await page.goto(`/panel/vehiculos?q=${encodeURIComponent(job.plate.typed)}`);
    await expect(page.getByText('Ningún vehículo coincide')).toBeVisible();

    // Elegir el taller ajeno con ?taller= o con la cookie no sirve de nada.
    await page.goto(`/panel?taller=${DEMO}`);
    await expect(page.locator('.pnl-workshop-name')).toHaveText('Taller Otro');
    const base = new URL(page.url());
    await context.addCookies([{ name: 'panel_taller', value: DEMO, domain: base.hostname, path: '/' }]);
    await page.goto('/panel/ordenes');
    await expect(page.locator('.pnl-workshop-name')).toHaveText('Taller Otro');
    await expect(page.locator('.plate', { hasText: job.plate.display })).toHaveCount(0);
  });

  test('por API: no crea órdenes con vehículos ajenos ni lee datos de otro taller', async () => {
    const owner = await tokenFor('propietaria@e2e.test');
    const demoVehicle = ((await api('/vehicles?select=id,customer_id&customer_id=not.is.null&limit=1', owner.token)).json as Array<{ id: string; customer_id: string }>)[0]!;
    const otro = await tokenFor('otro@e2e.test');
    const myWorkshop = ((await api('/rpc/my_workshops', otro.token, 'POST', {})).json as Array<{ workshop_id: string }>)[0]!.workshop_id;

    const res = await api('/repair_orders', otro.token, 'POST', {
      workshop_id: myWorkshop, vehicle_id: demoVehicle.id, customer_id: demoVehicle.customer_id, problem_description: 'Colada',
    });
    expect(res.status).toBe(409); // clave foránea: vehículo de otro taller
    const intoDemo = await api('/repair_orders', otro.token, 'POST', {
      workshop_id: DEMO, vehicle_id: demoVehicle.id, customer_id: demoVehicle.customer_id, problem_description: 'Colada',
    });
    expect(intoDemo.status).toBe(403); // RLS: no es gestor del taller demo
    for (const path of [`/repair_orders?workshop_id=eq.${DEMO}`, `/customers?workshop_id=eq.${DEMO}`, `/vehicles?workshop_id=eq.${DEMO}`, '/repair_order_events?select=id']) {
      const r = await api(path, otro.token);
      expect((r.json as unknown[]).length, path).toBe(0);
    }
  });
});

// ======================================================================
test.describe('Panel · móvil y usuarios sin taller', () => {
  test('en móvil se navega con las pestañas inferiores', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Solo móvil');
    await login(page, 'gestora@e2e.test');
    await expect(page.locator('.pnl-tabs')).toBeVisible();
    await expect(page.locator('.pnl-side')).toBeHidden();
    await page.locator('.pnl-tabs').getByRole('link', { name: 'Órdenes' }).click();
    await expect(page).toHaveURL(/\/panel\/ordenes$/);
    await expect(page.getByRole('heading', { name: 'Órdenes de reparación' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('sin sesión, el panel manda a iniciar sesión', async ({ page }) => {
    await page.goto('/panel/ordenes');
    await expect(page).toHaveURL(/\/acceso\?next=%2Fpanel%2Fordenes/);
  });
});

// ======================================================================
test.describe('Web pública', () => {
  test('el coche gira hasta la trasera, abre el maletero y se acerca a él antes del software', async ({ page }) => {
    const frames: string[] = [];
    // Móvil: versión ligera (maletero-sm); ordenador: la normal.
    const folder = test.info().project.name === 'movil' ? 'maletero-sm' : 'maletero';
    page.on('request', r => { if (/\/demo\/autovalue\/maletero(-sm)?\//.test(r.url())) frames.push(r.url()); });
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/stage-on/);
    // Sin bajar no se descarga ningún fotograma (solo la imagen fija); al empezar a bajar, sí.
    await page.waitForTimeout(500);
    expect(frames).toEqual([]);
    await page.evaluate(() => scrollTo(0, 2));
    await expect(page.locator('.stage')).toHaveClass(/is-live/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('La mecánica evoluciona.');
    const dim = () => page.locator('.stage-dim').evaluate(el => Number(getComputedStyle(el).opacity));
    expect(await dim()).toBeGreaterThan(0.5); // portada: coche oscurecido detrás del texto
    // A mitad del giro (ya fundido con la portada) el coche se ve limpio.
    // La portada puede ser más alta que la pantalla: se baja la mitad de la portada.
    await page.evaluate(() => { const h = document.querySelector<HTMLElement>('.stage-content > section')!; scrollTo(0, h.getBoundingClientRect().top + scrollY + h.offsetHeight * 0.5); });
    await expect.poll(dim).toBeLessThan(0.2);
    // Tras los servicios, el maletero se abre con el coche a la vista (antes del zoom).
    await page.evaluate(() => { const g = document.querySelector<HTMLElement>('.stage-gap-zoom')!; scrollTo(0, g.getBoundingClientRect().top + scrollY - innerHeight * 0.9 + (g.clientHeight + innerHeight * 0.9 - innerHeight) * 0.3); });
    await expect.poll(dim).toBeLessThan(0.3);
    // Al final del zoom la pantalla queda oscura (el interior del maletero) y empieza el software.
    await page.evaluate(() => { const g = document.querySelector('.stage-gap-zoom')!; scrollTo(0, g.getBoundingClientRect().top + scrollY + g.clientHeight - innerHeight); });
    await expect.poll(dim).toBeGreaterThan(0.95);
    // Giro + maletero: se descargan los 62 fotogramas, ni uno más.
    expect(frames.every(f => f.includes(`/${folder}/`))).toBe(true);
    const used = [...new Set(frames.map(f => Number(/maletero(?:-sm)?\/(\d+)\.webp/.exec(f)![1])))].sort((a, b) => a - b);
    expect(used).toEqual(Array.from({ length: 62 }, (_, i) => i));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('con «reducir movimiento» solo hay imagen fija y ningún hueco', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/stage-on/);
    await expect(page.locator('.stage-poster')).toBeVisible();
    await expect(page.locator('.stage-gap-turn')).toBeHidden();
    await expect(page.getByRole('heading', { name: /De la recepción/ })).toBeVisible();
  });

  test('el diseño anterior sigue disponible en /clasico (solo en la demo) con el mismo coche', async ({ page }) => {
    await page.goto('/clasico');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Tu coche en buenas manos.');
    await expect(page.locator('.stage')).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Tu coche, de principio a fin' })).toBeAttached();
  });
});
