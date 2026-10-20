/**
 * Diseño alternativo «premium» (/premium): convive con la portada actual y
 * usa los mismos datos y formularios reales.
 */
import { expect, test } from '@playwright/test';

const REST = process.env.E2E_REST_URL ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';

test.skip(!REST || !SERVICE, 'Lanza estas pruebas con scripts/test-e2e.sh');

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 20}` });
});

test('contenido real: taller, ocho fases, seis estados y capturas que existen', async ({ page }) => {
  await page.goto('/premium');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/La mecánica,\s*evolucionada\./i);
  await expect(page.locator('.pm-phase')).toHaveCount(8);
  await expect(page.locator('.pm-step')).toHaveCount(6);
  await expect(page.locator('.pm-step h3').first()).toHaveText('Vehículo recibido');
  // Lo que no está activo se dice: matrícula y email pendientes.
  await expect(page.locator('#fases')).toContainText('Pendiente de contratar el proveedor');
  await expect(page.locator('#fases')).toContainText('Email pendiente de credenciales');
  // Todas las capturas del software cargan de verdad.
  const imgs = page.locator('.pm img');
  for (let i = 0; i < (await imgs.count()); i++) {
    await imgs.nth(i).scrollIntoViewIfNeeded();
    await expect.poll(() => imgs.nth(i).evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  // La portada actual sigue igual.
  await page.goto('/');
  await expect(page.locator('.pm')).toHaveCount(0);
});

test('«Pedir cita» de un servicio rellena el formulario y la solicitud se guarda', async ({ page }) => {
  await page.goto('/premium');
  await page.getByRole('link', { name: 'Pedir cita: Frenos' }).click();
  const form = page.locator('#solicitar-cita');
  await expect(form.getByLabel('Servicio')).toHaveValue('frenos');

  const name = `E2E Premium ${Date.now()}`;
  await form.getByLabel('Nombre').fill(name);
  await form.getByLabel('Teléfono').fill('600 123 456');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();
  await expect(form.getByRole('heading', { name: 'Solicitud de cita recibida' })).toBeVisible();

  const res = await fetch(`${REST}/web_requests?name=eq.${encodeURIComponent(name)}&select=kind,status,service`, {
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
  });
  expect(await res.json()).toEqual([{ kind: 'cita', status: 'nueva', service: 'frenos' }]);
});

test('móvil: el menú se abre, se cierra con Escape y al elegir una sección', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Solo en móvil');
  await page.goto('/premium');
  const menu = page.getByRole('button', { name: 'Menú' });
  const nav = page.getByRole('navigation', { name: 'Secciones' });
  await expect(nav).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).toBeHidden();
  await menu.click();
  await nav.getByRole('link', { name: 'Proceso' }).click();
  await expect(nav).toBeHidden();
  await expect(page.locator('#proceso')).toBeInViewport();
});

test.describe('sin JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('todo el contenido y el menú se ven', async ({ page }) => {
    await page.goto('/premium');
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Ocho fases/i })).toBeVisible();
    await expect(page.locator('.pm-step').last()).toBeVisible();
  });
});
