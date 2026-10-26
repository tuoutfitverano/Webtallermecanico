/**
 * Agenda de cada persona del taller, con base de datos y Supabase Auth REALES:
 * el mecánico organiza la suya; la propietaria ve la de todo el equipo y le
 * apunta tareas; nadie ve la de otros sin ser de la gerencia.
 */
import { expect, test, type Browser } from '@playwright/test';
import { acceptCookies } from './consent.ts';

const PROXY = process.env.E2E_PROXY_URL ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';

test.skip(!PROXY || !PASSWORD, 'Lanza estas pruebas con scripts/test-e2e.sh');
test.skip(({ isMobile }) => isMobile, 'El flujo se comprueba en escritorio (el móvil, en calidad.spec.ts)');

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
async function userId(email: string) {
  const res = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const { access_token } = (await res.json()) as { access_token: string };
  return (JSON.parse(Buffer.from(access_token.split('.')[1]!, 'base64url').toString()) as { sub: string }).sub;
}
async function session(browser: Browser, email: string, next: string) {
  const context = await acceptCookies(await browser.newContext({ locale: 'es-ES' }));
  const page = await context.newPage();
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === next.split('?')[0]);
  return { page, close: () => context.close() };
}

test('cada persona organiza su agenda y la propietaria ve la de todo el equipo', async ({ browser }) => {
  test.setTimeout(120_000);
  const stamp = String(Date.now()).slice(-6);
  const mechTask = `Cambiar pastillas ${stamp}`;
  const ownerTask = `Recibir al cliente ${stamp}`;
  const mechanicId = await userId('mecanico@e2e.test');
  const ownerId = await userId('propietaria@e2e.test');

  // 1. El mecánico se apunta una tarea en su agenda.
  const m = await session(browser, 'mecanico@e2e.test', '/panel/agenda');
  await expect(m.page.getByLabel('Persona')).toHaveCount(0);
  const form = m.page.getByRole('region', { name: 'Apuntar en la agenda' });
  await form.getByLabel('Qué hay que hacer').fill(mechTask);
  await form.getByLabel('Día').fill(today);
  await form.getByLabel('Desde').fill('10:00');
  await form.getByLabel('Hasta').fill('09:00');
  await form.getByRole('button', { name: 'Apuntar' }).click();
  await expect(m.page.getByText('La hora de fin tiene que ser después de la de inicio.')).toBeVisible();
  await m.page.getByRole('region', { name: 'Apuntar en la agenda' }).getByLabel('Desde').fill('09:00');
  await m.page.getByRole('region', { name: 'Apuntar en la agenda' }).getByLabel('Hasta').fill('10:30');
  await m.page.getByRole('region', { name: 'Apuntar en la agenda' }).getByRole('button', { name: 'Apuntar' }).click();
  await expect(m.page.getByRole('status')).toContainText('Apuntado en la agenda');
  await expect(m.page.getByRole('link', { name: new RegExp(`09:00–10:30 ${mechTask}`) })).toBeVisible();

  // Día: a su hora, y se marca como hecho.
  await m.page.goto(`/panel/agenda?vista=dia&fecha=${today}`);
  const item = m.page.getByRole('article', { name: mechTask });
  await expect(item).toContainText('09:00–10:30');
  await item.getByRole('button', { name: `Hecho: ${mechTask}` }).click();
  await expect(m.page.getByRole('status')).toContainText('Marcado como hecho');
  await expect(m.page.getByRole('article', { name: mechTask })).toContainText('Hecho');
  // Mes: aparece en su día.
  await m.page.goto(`/panel/agenda?vista=mes&fecha=${today}`);
  await expect(m.page.locator('.agenda-chip', { hasText: mechTask })).toHaveCount(1);
  // No puede mirar la agenda de otra persona cambiando el enlace: ve la suya.
  await m.page.goto(`/panel/agenda?persona=${ownerId}`);
  await expect(m.page.getByRole('heading', { level: 2, name: /Mi agenda/ })).toBeVisible();

  // 2. La propietaria ve la de todo el equipo y le apunta algo al mecánico.
  const o = await session(browser, 'propietaria@e2e.test', `/panel/agenda?vista=dia&fecha=${today}&persona=todos`);
  await expect(o.page.getByRole('article', { name: mechTask })).toBeVisible();
  const oform = o.page.getByRole('region', { name: 'Apuntar en la agenda' });
  await oform.getByLabel('Para', { exact: true }).selectOption(mechanicId);
  await oform.getByLabel('Qué hay que hacer').fill(ownerTask);
  await oform.getByLabel('Tipo').selectOption('cita');
  await oform.getByLabel('Día').fill(today);
  await oform.getByLabel('Desde').fill('11:00');
  await oform.getByLabel('Hasta').fill('11:30');
  await oform.getByRole('button', { name: 'Apuntar' }).click();
  await expect(o.page.getByRole('status')).toContainText('Apuntado en la agenda');
  await o.close();

  // 3. El mecánico lo ve en su agenda, con quién se lo apuntó.
  await m.page.goto(`/panel/agenda?vista=dia&fecha=${today}`);
  await expect(m.page.getByRole('article', { name: ownerTask })).toContainText('Lo apuntó');
  // Y puede borrar lo suyo (en dos pasos).
  await m.page.getByRole('article', { name: mechTask }).getByRole('button', { name: `Borrar: ${mechTask}` }).click();
  await m.page.getByRole('article', { name: mechTask }).getByRole('button', { name: `Sí, borrar: ${mechTask}` }).click();
  await expect(m.page.getByRole('status')).toContainText('Apunte borrado');
  await expect(m.page.getByRole('article', { name: mechTask })).toHaveCount(0);
  await m.close();
});
