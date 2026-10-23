/**
 * Órdenes libres y revisión del trabajo, con base de datos y Supabase Auth REALES:
 * recepción crea una orden sin asignar → el mecánico se la queda y la da por
 * terminada → la administradora la devuelve con un motivo → el mecánico la
 * vuelve a terminar → la administradora la confirma → recepción entrega.
 *
 * Lanza con scripts/test-e2e.sh (cuentas: recepcion@e2e.test, mecanico@e2e.test, gestora@e2e.test).
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
function newPlate() {
  const letters = 'BCDFGHJKLMNPRSTVWXYZ';
  const n = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const l = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  return `${n} ${l}`;
}

async function login(page: Page, email: string, next = '/panel') {
  await page.context().clearCookies();
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}

test('órdenes libres: el mecánico se la queda, la da por terminada y solo la gerencia la confirma', async ({ page }) => {
  test.setTimeout(120_000);
  const plate = newPlate();

  // 1. Recepción crea la orden sin asignar.
  await login(page, 'recepcion@e2e.test');
  await page.goto('/panel/clientes/nuevo');
  await page.getByLabel('Nombre completo o nombre comercial').fill(`Cliente Revisión ${stamp()}`);
  await page.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(page.getByRole('status')).toContainText('Cliente guardado.');
  await page.getByRole('link', { name: 'Registrar vehículo' }).click();
  await page.getByLabel('Matrícula').fill(plate);
  await page.getByLabel('Marca').fill('Renault');
  await page.getByLabel('Modelo').fill('Clio');
  await page.getByLabel(/^Año/).fill('2018');
  await page.getByLabel(/Ese año es de/).selectOption('fabricacion');
  await page.getByRole('button', { name: 'Guardar vehículo' }).click();
  await expect(page.getByRole('status')).toContainText('Vehículo registrado.');
  await page.getByRole('link', { name: 'Nueva orden' }).click();
  await page.getByLabel(/Descripción del problema/).fill('Pastillas de freno');
  await page.getByRole('button', { name: 'Crear orden' }).click();
  await expect(page.getByRole('status')).toContainText('Orden creada.');
  const orderUrl = page.url().replace(/\?.*$/, '');

  // 2. El mecánico la ve entre las libres y se la queda.
  await login(page, 'mecanico@e2e.test', '/panel/ordenes');
  const free = page.getByRole('list', { name: 'Órdenes sin asignar' }).getByRole('listitem').filter({ hasText: plate });
  await expect(free).toContainText('Pastillas de freno');
  await free.getByRole('button', { name: /Me la quedo/ }).click();
  await expect(page).toHaveURL(new RegExp(`${orderUrl}\\?cogida=1$`));
  await expect(page.getByRole('status')).toContainText('Te has quedado esta orden');
  await expect(page.getByRole('button', { name: 'Listo para recoger' })).toHaveCount(0);
  await page.getByRole('button', { name: 'En reparación' }).click();
  await expect(page.getByRole('status')).toContainText('Estado actualizado.');
  await page.getByRole('button', { name: 'Dar por terminada' }).click();
  await expect(page.getByRole('status')).toContainText('Ahora la revisa el propietario o un administrador');
  await expect(page.getByRole('heading', { name: 'Pendiente de revisión' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar: listo para recoger' })).toHaveCount(0);

  // 3. Recepción no la confirma ni la entrega todavía.
  await login(page, 'recepcion@e2e.test', '/panel/ordenes?estado=revision');
  await expect(page.getByRole('link', { name: new RegExp(plate) })).toContainText('Pendiente de revisión');
  await page.goto(orderUrl);
  await expect(page.getByRole('heading', { name: 'Pendiente de revisión' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar: listo para recoger' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Entregado' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Listo para recoger' })).toHaveCount(0);

  // 4. La administradora la devuelve con un motivo.
  await login(page, 'gestora@e2e.test');
  await expect(page.getByRole('link', { name: /trabajos terminados pendientes de tu revisión/ })).toBeVisible();
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Devolver al mecánico' }).click();
  await expect(page.getByRole('alert')).toContainText('Escribe el motivo');
  await page.getByLabel(/Motivo para devolverla al mecánico/).fill('Falta probarlo en carretera.');
  await page.getByRole('button', { name: 'Devolver al mecánico' }).click();
  await expect(page.getByRole('status')).toContainText('Orden devuelta al mecánico');

  // 5. El mecánico ve el motivo y la vuelve a terminar.
  await login(page, 'mecanico@e2e.test', '/panel/ordenes');
  await page.goto(orderUrl);
  await expect(page.getByRole('note').filter({ hasText: 'Devuelta para revisar' })).toContainText('Falta probarlo en carretera.');
  await expect(page.locator('.timeline')).toContainText('Motivo: «Falta probarlo en carretera.»');
  await page.getByRole('button', { name: 'Dar por terminada' }).click();
  await expect(page.getByRole('status')).toContainText('Ahora la revisa');

  // 6. La administradora la confirma: «Listo para recoger».
  await login(page, 'gestora@e2e.test');
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Confirmar: listo para recoger' }).click();
  await expect(page.getByRole('status')).toContainText('Trabajo confirmado');
  await expect(page.locator('.pnl-title')).toContainText('Listo para recoger');
  await expect(page.getByRole('heading', { name: 'Pendiente de revisión' })).toHaveCount(0);

  // 7. Recepción entrega el vehículo.
  await login(page, 'recepcion@e2e.test');
  await page.goto(orderUrl);
  await page.getByRole('button', { name: 'Entregado' }).click();
  await expect(page.locator('.pnl-title')).toContainText('Entregado');
});
