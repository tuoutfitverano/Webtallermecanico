/**
 * Consumo de extras (WhatsApp y matrículas, a cargo del taller) con base de
 * datos y Supabase Auth REALES: lo que enseña el panel es lo que calcula la
 * base de datos, y solo lo ven propiedad y administración.
 */
import { expect, test, type Page } from '@playwright/test';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');

async function login(page: Page, email: string, next: string) {
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === next);
}
async function tokenFor(email: string) {
  const res = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}
const usageAs = async (email: string) => fetch(`${PROXY}/rest/v1/rpc/workshop_usage`, {
  method: 'POST',
  headers: { apikey: ANON, authorization: `Bearer ${await tokenFor(email)}`, 'content-type': 'application/json' },
  body: JSON.stringify({ p_workshop_id: DEMO }),
});
const euros = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);

test('la propietaria ve el consumo del mes de su taller, el mismo que calcula la base de datos', async ({ page }) => {
  const res = await usageAs('propietaria@e2e.test');
  expect(res.status).toBe(200);
  const [u] = (await res.json()) as Array<{ plan: string; whatsapp: number; matriculas: number; whatsapp_cents: number; matriculas_cents: number }>;
  expect(u!.plan).toBe('profesional');

  await login(page, 'propietaria@e2e.test', '/panel/taller');
  await expect(page.getByRole('region', { name: 'Cuenta en la plataforma' })).toContainText('Profesional');
  const card = page.getByRole('region', { name: 'Consumo de este mes' });
  const table = card.getByRole('table');
  await expect(table.getByRole('row', { name: /Avisos por WhatsApp/ })).toContainText(String(u!.whatsapp));
  await expect(table.getByRole('row', { name: /Consultas por matrícula/ })).toContainText(String(u!.matriculas));
  await expect(table.getByRole('row', { name: /Total/ })).toContainText(euros(u!.whatsapp_cents + u!.matriculas_cents));
  await expect(card).toContainText('0,06 € cada uno');
  await expect(card).toContainText('0,75 € cada una');
});

test('ni recepción ni mecánicos ven el consumo', async () => {
  for (const email of ['recepcion@e2e.test', 'mecanico@e2e.test']) {
    const res = await usageAs(email);
    expect(res.status, email).toBeGreaterThanOrEqual(400);
  }
});
