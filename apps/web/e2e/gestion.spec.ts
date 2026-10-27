/**
 * Gestión del taller con base de datos y Supabase Auth REALES: presupuesto con
 * aceptación por enlace, factura (operativa, no VERI*FACTU), cobro e impresión,
 * planificación, estadísticas, recordatorios y el rol de recepción.
 *
 * Lanza con scripts/test-e2e.sh (cuentas: propietaria@e2e.test, recepcion@e2e.test,
 * mecanico@e2e.test). Las pruebas comparten base de datos y van en orden.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
function newPlate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  const n = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  return { typed: `${n} ${l}`, display: `${n} ${l}` };
}

async function login(page: Page, email: string, next = '/panel') {
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}

/** Cliente + vehículo + orden, como la oficina. */
async function createJob(page: Page) {
  const name = `Cliente Gestión ${stamp()}`;
  const plate = newPlate();
  await page.goto('/panel/clientes/nuevo');
  await page.getByLabel('Nombre completo o nombre comercial').fill(name);
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(page.getByRole('status')).toContainText('Cliente guardado.');
  await page.getByRole('link', { name: 'Registrar vehículo' }).click();
  await page.getByLabel('Matrícula').fill(plate.typed);
  await page.getByLabel('Marca').fill('Seat');
  await page.getByLabel('Modelo').fill('León');
  await page.getByLabel(/^Año/).fill('2019');
  await page.getByLabel(/Ese año es de/).selectOption('fabricacion');
  await page.getByLabel(/Kilómetros actuales/).fill('98.000');
  await page.getByRole('button', { name: 'Guardar vehículo' }).click();
  await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
  const vehicleUrl = page.url().replace(/\?.*$/, '');
  await expect(page.locator('.facts')).toContainText('98.000 km');
  await page.getByRole('link', { name: 'Nueva orden' }).click();
  await page.getByLabel(/Descripción del problema/).fill('Revisión de frenos');
  await page.getByRole('button', { name: 'Crear orden' }).click();
  await expect(page.getByRole('status')).toContainText('Orden creada.');
  return { name, plate, vehicleUrl, orderUrl: page.url().replace(/\?.*$/, '') };
}

async function addLine(scope: Locator | Page, description: string, quantity: string, price: string) {
  const form = scope.locator('form.line-form');
  await form.getByLabel('Concepto').fill(description);
  await form.getByLabel('Cantidad u horas').fill(quantity);
  await form.getByLabel(/Precio unitario/).fill(price);
  await form.getByRole('button', { name: 'Añadir línea' }).click();
}

test.describe('Gestión · presupuesto, factura y cobro', () => {
  test.describe.configure({ mode: 'serial' });

  test('datos fiscales y ajustes de facturación del taller', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    await page.goto('/panel/taller');
    await page.getByLabel(/Razón social/).fill('Talleres Demo E2E SL');
    await page.getByLabel(/NIF \/ CIF/).fill('B12345674');
    await page.getByLabel(/^Dirección \(sale/).fill('Calle de Prueba 1');
    await page.getByLabel('Código postal').fill('28001');
    await page.getByLabel('Localidad').fill('Madrid');
    await page.getByRole('button', { name: 'Guardar datos' }).click();
    await expect(page.getByRole('status')).toContainText('Datos del taller guardados.');

    await page.getByLabel(/Precio de la hora/).fill('40');
    await page.getByLabel(/Serie de las correcciones/).fill('F');
    await page.getByRole('button', { name: 'Guardar ajustes' }).click();
    await expect(page.locator('.field-error')).toContainText('distinta');
    await page.getByLabel(/Serie de las correcciones/).fill('R');
    await page.getByRole('button', { name: 'Guardar ajustes' }).click();
    await expect(page.getByRole('status')).toContainText('Ajustes de presupuestos y resúmenes guardados.');
  });

  test('presupuesto aceptado por enlace → líneas en la orden → factura emitida, cobrada e imprimible', async ({ page, browser }) => {
    await login(page, 'propietaria@e2e.test');
    const job = await createJob(page);

    // Una línea de trabajo en la orden: 1 × 80 € + 21 % = 96,80 €.
    await addLine(page, 'Diagnosis de frenos', '1', '80');
    await expect(page.getByRole('status')).toContainText('Línea añadida.');
    await expect(page.locator('.totals')).toContainText('96,80');

    // Presupuesto desde la orden.
    await page.getByRole('link', { name: 'Crear presupuesto' }).click();
    await page.getByLabel(/Título/).fill('Pastillas y discos delanteros');
    await page.getByRole('button', { name: 'Crear presupuesto' }).click();
    await expect(page).toHaveURL(/\/panel\/presupuestos\/[0-9a-f-]{36}/);
    await addLine(page, 'Discos delanteros', '2', '50');
    await expect(page.getByRole('status')).toContainText('Línea añadida.');
    await expect(page.locator('.totals')).toContainText('121,00');
    await page.getByRole('button', { name: 'Enviar al cliente' }).click();
    await expect(page.getByRole('status')).toContainText('Presupuesto enviado');
    const link = await page.locator('#quote-link').inputValue();
    expect(link).toMatch(/\/presupuesto\/[0-9a-f]{64}$/);
    const quoteUrl = page.url().replace(/\?.*$/, '');

    // El cliente lo abre SIN cuenta y lo acepta.
    const visitor = await browser.newContext();
    const v = await visitor.newPage();
    await v.goto(new URL(link).pathname);
    await expect(v.getByText('121,00').first()).toBeVisible();
    await v.getByRole('button', { name: 'Acepto el presupuesto' }).click();
    await expect(v.getByRole('alert')).toContainText('Escribe tu nombre');
    await v.getByLabel('Tu nombre').fill('Cliente Prueba');
    await v.getByRole('button', { name: 'Acepto el presupuesto' }).click();
    await expect(v.getByRole('alert')).toContainText('confirma que has leído');
    await v.getByLabel(/He leído el presupuesto/).check();
    await v.getByRole('button', { name: 'Acepto el presupuesto' }).click();
    await expect(v.getByRole('heading', { name: 'Presupuesto aceptado' })).toBeVisible();
    // Un solo uso: el mismo enlace ya no sirve.
    await v.goto(new URL(link).pathname);
    await expect(v.getByRole('heading', { name: /Enlace no válido/ })).toBeVisible();
    await visitor.close();

    await page.goto(quoteUrl);
    await expect(page.locator('.pnl-head')).toContainText('Aceptado');
    await page.goto(job.orderUrl);
    await expect(page.getByText(/Presupuesto aprobado por el cliente/)).toBeVisible();
    // 96,80 + 121,00
    await expect(page.locator('.totals')).toContainText('217,80');

    // Factura desde la orden (copia sus líneas).
    await page.getByRole('link', { name: 'Crear resumen de servicios' }).click();
    await page.getByRole('button', { name: 'Crear borrador' }).click();
    await expect(page.getByRole('status')).toContainText('Borrador creado');
    await expect(page.locator('.totals')).toContainText('217,80');
    await page.getByRole('button', { name: 'Emitir resumen…' }).click();
    await page.getByRole('button', { name: 'Sí, emitir' }).click();
    await expect(page.getByRole('status')).toContainText(/Resumen F\d{4}-\d{4} emitido/);
    const invoiceUrl = page.url().replace(/\?.*$/, '');
    await expect(page.getByRole('button', { name: 'Añadir línea' })).toHaveCount(0);

    // Cobro parcial y resto.
    await page.getByLabel('Importe (€)').fill('100');
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByRole('status')).toContainText('Cobro registrado.');
    await page.getByLabel('Importe (€)').fill('200');
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByRole('alert')).toBeVisible(); // nunca más del total
    await page.getByLabel('Importe (€)').fill('117,80');
    await page.getByRole('button', { name: 'Registrar' }).click();
    await expect(page.getByRole('status')).toContainText('Cobro registrado.');

    // Vista para imprimir: datos congelados y aviso bien visible de que NO es una factura.
    await page.getByRole('link', { name: 'Imprimir o guardar PDF' }).click();
    await expect(page.getByRole('heading', { name: 'Resumen de servicios' })).toBeVisible();
    await expect(page.locator('main')).toContainText('Talleres Demo E2E SL');
    await expect(page.locator('main')).toContainText('B12345674');
    await expect(page.locator('main')).toContainText('217,80');
    await expect(page.locator('main')).toContainText('No es una factura');

    // Lista: cobrada.
    await page.goto('/panel/facturas?estado=cobradas');
    await expect(page.locator(`a[href="${new URL(invoiceUrl).pathname}"]`)).toBeVisible();

    // Historial del vehículo: km, trabajos, presupuesto y factura.
    await page.goto(job.vehicleUrl);
    await expect(page.locator('#hist')).toBeVisible();
    await expect(page.getByText(/Trabajos: Diagnosis de frenos/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Presupuestos y servicios' })).toBeVisible();
  });
});

test.describe('Gestión · planificación, estadísticas, recordatorios y roles', () => {
  test('la oficina ve planificación, estadísticas y recordatorios', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    await page.goto('/panel/planificacion');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.goto('/panel/estadisticas');
    await expect(page.getByRole('heading', { name: 'Estadísticas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Servicios cobrados' })).toBeVisible();
    await page.goto('/panel/estadisticas?desde=2026-02-30&hasta=2026-03-01');
    await expect(page.getByRole('alert')).toContainText('Fechas no válidas');
    await page.goto('/panel/recordatorios');
    await expect(page.getByRole('heading', { name: 'Recordatorios', level: 1 })).toBeVisible();
    await page.getByLabel(/Avisar al cliente antes de la próxima revisión/).check();
    await page.getByRole('button', { name: 'Guardar reglas' }).click();
    await expect(page.getByRole('status')).toContainText('Reglas guardadas');
    await expect(page.getByLabel(/Avisar al cliente antes de la próxima revisión/)).toBeChecked();
  });

  test('recepción gestiona presupuestos y facturas, pero no el taller ni el equipo', async ({ page }) => {
    await login(page, 'recepcion@e2e.test');
    await page.goto('/panel/facturas');
    await expect(page.getByRole('link', { name: 'Nuevo resumen' })).toBeVisible();
    await page.goto('/panel/presupuestos');
    await expect(page.getByRole('heading', { name: 'Presupuestos', level: 1 })).toBeVisible();
    await page.goto('/panel/taller');
    await expect(page.getByText('Solo el propietario o un administrador gestionan los datos del taller.')).toBeVisible();
    await page.goto('/panel/recordatorios');
    await expect(page.getByRole('button', { name: 'Guardar reglas' })).toHaveCount(0);
  });

  test('el mecánico no ve facturas, presupuestos ni estadísticas', async ({ page }) => {
    await login(page, 'mecanico@e2e.test');
    for (const path of ['/panel/facturas', '/panel/presupuestos', '/panel/estadisticas']) {
      await page.goto(path);
      await expect(page.locator('.empty')).toContainText('oficina');
    }
  });
});

test.describe('Gestión · mantenimientos periódicos', () => {
  test('el taller fija la periodicidad, la marca en la orden y al entregar se calcula el próximo', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    // Un mantenimiento propio del taller, con su periodicidad.
    const name = `Líquido refrigerante ${stamp()}`;
    await page.goto('/panel/mantenimientos');
    await expect(page.getByRole('heading', { name: 'Mantenimientos', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Mantenimiento «Cambio de aceite y filtro»')).toBeVisible();
    const add = page.locator('form', { has: page.getByRole('button', { name: 'Añadir', exact: true }) });
    await add.getByLabel('Nombre').fill(name);
    await add.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Revisa los campos marcados');
    await expect(page.locator('.field-error').first()).toContainText('meses');
    await add.getByLabel('Cada (meses)').fill('24');
    await add.getByLabel('o cada (km)').fill('60.000');
    await add.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Mantenimiento añadido.');
    await expect(page.getByLabel(`Mantenimiento «${name}»`).getByLabel('Cada (meses)')).toHaveValue('24');

    // Se marca en la orden; cuenta al entregar (fecha de entrega y km de entrada).
    const job = await createJob(page);
    await page.goto(job.orderUrl);
    const kmIn = page.getByRole('textbox', { name: 'Kilómetros a la entrada' });
    await kmIn.fill('98000');
    await page.locator('form', { has: kmIn }).getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status')).toContainText('Kilómetros guardados.');
    const card = page.locator('section', { has: page.getByRole('heading', { name: 'Mantenimientos hechos' }) });
    await card.getByLabel(/Cambio de aceite y filtro/).check();
    await card.getByLabel(new RegExp(name)).check();
    await card.getByRole('button', { name: 'Guardar mantenimientos' }).click();
    await expect(page.getByRole('status')).toContainText('Al entregar el vehículo se calculará el próximo.');
    await expect(card.getByLabel(new RegExp(name))).toBeChecked();
    await page.getByRole('button', { name: 'Listo para recoger' }).click();
    await expect(page.getByRole('status')).toContainText('Estado actualizado.');
    await page.getByRole('button', { name: 'Entregado' }).click();
    await expect(page.locator('.pnl-title')).toContainText('Entregado');

    await page.goto(job.vehicleUrl);
    const mant = page.locator('section', { has: page.getByRole('heading', { name: 'Mantenimientos', exact: true }) });
    await expect(mant.locator('li', { hasText: name })).toContainText('a los 158.000 km');
    await expect(mant.locator('li', { hasText: name })).toContainText('Al día');
    await expect(mant.locator('li', { hasText: 'Cambio de aceite y filtro' })).toContainText('a los 113.000 km');

    // Uno hecho fuera del taller: la pre-ITV de hace casi un año → le toca pronto.
    const lastYear = new Date(Date.now() - 360 * 86_400_000).toISOString().slice(0, 10);
    await mant.getByText('Anotar uno hecho fuera del taller').click();
    await mant.getByLabel('Mantenimiento', { exact: true }).selectOption({ label: 'Pre-ITV' });
    await mant.getByLabel('Fecha en que se hizo').fill(lastYear);
    await mant.getByRole('button', { name: 'Anotar' }).click();
    await expect(page.getByRole('status')).toContainText('Mantenimiento anotado.');
    await expect(mant.locator('li', { hasText: 'Pre-ITV' })).toContainText('(anotado a mano)');
    await expect(mant.locator('li', { hasText: 'Pre-ITV' })).toContainText('Pronto');

    await page.goto('/panel/mantenimientos');
    await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Vencen pronto' }) }).locator('li', { hasText: job.plate.display }))
      .toContainText('Pre-ITV');
  });

  test('el mecánico ve la lista, pero no la cambia', async ({ page }) => {
    await login(page, 'mecanico@e2e.test');
    await page.goto('/panel/mantenimientos');
    await expect(page.getByText('La cambian el propietario y los administradores del taller.')).toBeVisible();
    await expect(page.getByText('Cambio de aceite y filtro')).toBeVisible();
    await expect(page.getByRole('button', { name: /Guardar|Añadir/ })).toHaveCount(0);
  });
});

test.describe('Gestión · copia de seguridad del taller', () => {
  test('la propietaria descarga la copia completa y una tabla para Excel', async ({ page }) => {
    await login(page, 'propietaria@e2e.test');
    const job = await createJob(page);
    await page.goto('/panel/taller');
    await page.getByRole('link', { name: 'Ir a la copia de seguridad' }).click();
    await expect(page.getByRole('heading', { name: 'Copia de seguridad', level: 1 })).toBeVisible();

    const [full] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar copia completa' }).click()]);
    expect(full.suggestedFilename()).toMatch(/^copia-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json$/);
    const text = await (await import('node:fs/promises')).readFile((await full.path())!, 'utf8');
    const copy = JSON.parse(text) as { formato: string; tablas: Record<string, unknown[]>; equipo: unknown[] };
    expect(copy.formato).toBe('copia-taller-v1');
    expect(JSON.stringify(copy.tablas.customers)).toContain(job.name);
    expect(copy.tablas.repair_orders!.length).toBeGreaterThan(0);
    expect(copy.equipo.length).toBeGreaterThan(0);
    expect(text).not.toContain('token_hash');
    expect(text).not.toContain('client_hash');

    await page.getByLabel('Qué tabla').selectOption({ label: 'Clientes' });
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar tabla' }).click()]);
    expect(csv.suggestedFilename()).toMatch(/-clientes-\d{4}-\d{2}-\d{2}\.csv$/);
    const body = await (await import('node:fs/promises')).readFile((await csv.path())!, 'utf8');
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.split('\r\n')[0]).toContain('full_name');
    expect(body).toContain(job.name);

    await page.reload();
    await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Últimas descargas' }) })).toContainText('tabla CSV');
  });

  test('el mecánico no descarga la copia', async ({ page }) => {
    await login(page, 'mecanico@e2e.test');
    await page.goto('/panel/copia');
    await expect(page.getByText('La copia la descargan el propietario o un administrador del taller.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Descargar/ })).toHaveCount(0);
  });
});
