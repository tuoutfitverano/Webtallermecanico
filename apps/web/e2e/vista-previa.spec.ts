/**
 * Vista previa navegable (no es una prueba). Crea datos de DEMOSTRACIÓN en la
 * base de datos temporal de las pruebas, recorre el panel (como propietaria) y
 * el portal (como clienta) y guarda el HTML de cada pantalla. Después,
 * scripts/vista-previa/build.py lo convierte en páginas estáticas.
 *
 *   VISTA_PREVIA_DIR=<carpeta> bash scripts/test-e2e.sh e2e/vista-previa.spec.ts --project escritorio
 *
 * Los proveedores de email y matrículas son los SIMULADOS de las pruebas.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const DIR = process.env.VISTA_PREVIA_DIR ?? '';
const PROXY = process.env.E2E_PROXY_URL ?? '';
const ANON = process.env.E2E_ANON_KEY ?? '';
const SERVICE = process.env.E2E_SERVICE_KEY ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const DEMO = 'd0000000-0000-0000-0000-000000000001';

test.skip(!DIR || !PROXY, 'Solo para generar la vista previa (VISTA_PREVIA_DIR)');
test.setTimeout(10 * 60_000);

/** Contraseña de las cuentas «Prueba Trabajador» y «Prueba Cliente» (solo datos de demostración). */
const DEMO_PASSWORD = 'PruebaAuto2026';
const WORKER = 'prueba.trabajador@autovalue.test';
const CLIENT = 'prueba.cliente@autovalue.test';

async function token(email: string, password = PASSWORD) {
  const r = await fetch(`${PROXY}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = (await r.json()) as { access_token: string; user: { id: string } };
  return { tok: body.access_token, id: body.user.id };
}
async function rest(method: string, path: string, tok: string, body?: unknown) {
  const r = await fetch(`${PROXY}/rest/v1${path}`, {
    method, headers: { apikey: ANON, authorization: `Bearer ${tok}`, 'content-type': 'application/json', prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (r.status >= 400) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return (text ? JSON.parse(text) : []) as Array<Record<string, string>>;
}
async function createUser(email: string, fullName: string) {
  const r = await fetch(`${PROXY}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }) });
  expect(r.status).toBeLessThan(300);
  return token(email, DEMO_PASSWORD);
}
async function login(page: Page, email: string, next: string, password = PASSWORD) {
  await page.context().clearCookies();
  await page.goto(`/acceso?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(u => u.pathname === next);
}

/** Recorre las páginas enlazadas desde `start` (solo bajo `prefixes`) y guarda su HTML. */
async function crawl(page: Page, role: string, start: string[], prefixes: string[], limit: number) {
  const out = `${DIR}/${role}`;
  mkdirSync(out, { recursive: true });
  const seen = new Set<string>();
  const queue = [...start];
  const index: Record<string, string> = {};
  while (queue.length && seen.size < limit) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    // Desde el navegador (resuelve demo.localhost y envía las cookies de la sesión).
    const res = await page.evaluate(async p => {
      const r = await fetch(p, { redirect: 'manual' });
      return { status: r.status, html: r.status === 200 ? await r.text() : '' };
    }, path);
    if (res.status !== 200) continue;
    const html = res.html;
    const file = `${Object.keys(index).length}.html`;
    writeFileSync(`${out}/${file}`, html);
    index[path] = file;
    for (const m of html.matchAll(/href="(\/[^"#]*)/g)) {
      const link = m[1]!.replace(/&amp;/g, '&');
      if (prefixes.some(p => link === p || link.startsWith(`${p}/`) || link.startsWith(`${p}?`)) && !link.includes('taller=') && !seen.has(link)) queue.push(link);
    }
  }
  writeFileSync(`${out}/index.json`, JSON.stringify(index, null, 1));
  return Object.keys(index).length;
}

test('vista previa: datos de demostración y recorrido de pantallas', async ({ page }) => {
  const owner = await token('propietaria@e2e.test');
  const mech = await token('mecanico@e2e.test');

  // ---- Cuenta «Prueba Trabajador»: mecánico del taller, por invitación (como en la realidad)
  const worker = await createUser(WORKER, 'Prueba Trabajador');
  const [wInv] = await rest('POST', '/rpc/create_workshop_invitation', owner.tok, { p_workshop_id: DEMO, p_email: WORKER, p_role: 'mecanico' });
  await rest('POST', '/rpc/accept_workshop_invitation', worker.tok, { p_token: wInv!.token });

  // ---- Clientes y vehículos de demostración (nombres y datos ficticios).
  // Matrículas de la serie «X…», que en España no se emitirá hasta dentro de muchos
  // años: no pueden coincidir con ningún coche real (los modelos son de ejemplo).
  const people = [
    { full_name: 'María López Sanz', phone: '612 345 678', email: 'maria.lopez@correo.test' },
    { full_name: 'Javier Ruiz Moreno', phone: '623 456 789', email: 'javier.ruiz@correo.test' },
    { full_name: 'Lucía Fernández Gil', phone: '634 567 890', email: null },
    { full_name: 'Transportes Henares (demo)', phone: '949 123 456', email: 'flota@henares.test', internal_notes: 'Flota de furgonetas. Facturar a fin de mes.' },
    { full_name: 'Carlos Martín Ortega', phone: '645 678 901', email: 'carlos.martin@correo.test' },
    { full_name: 'Prueba Cliente', phone: '600 000 001', email: CLIENT },
  ];
  const customers = [];
  for (const p of people) customers.push((await rest('POST', '/customers', owner.tok, { workshop_id: DEMO, ...p }))[0]!);
  const cars = [
    { c: 0, plate: '4821XKL', make: 'Seat', model: 'León 1.5 TSI', year: 2019, fuel: 'gasolina' },
    { c: 1, plate: '7395XJH', make: 'Renault', model: 'Clio dCi', year: 2016, fuel: 'diesel' },
    { c: 2, plate: '1250XLR', make: 'Toyota', model: 'Corolla Hybrid', year: 2021, fuel: 'hibrido' },
    { c: 3, plate: '9034XHZ', make: 'Ford', model: 'Transit Custom', year: 2015, fuel: 'diesel' },
    { c: 3, plate: '2267XKC', make: 'Ford', model: 'Transit Connect', year: 2018, fuel: 'diesel' },
    { c: 4, plate: '5518XMB', make: 'Peugeot', model: '308 PureTech', year: 2023, fuel: 'gasolina' },
    // Coches de «Prueba Cliente» (modelo y año pedidos por el propietario; el combustible
    // no se rellena: no se inventa ningún dato que nadie haya dado)
    { c: 5, plate: '4721XKT', make: 'Volkswagen', model: 'Golf GTI', year: 2019, fuel: null },
    { c: 5, plate: '8352XHW', make: 'Citroën', model: 'C3', year: 2014, fuel: null },
    { c: 5, plate: '6147XLP', make: 'Mercedes-Benz', model: 'Clase A', year: 2022, fuel: null },
  ];
  const vehicles = [];
  for (const v of cars) {
    vehicles.push((await rest('POST', '/vehicles', owner.tok, {
      workshop_id: DEMO, customer_id: customers[v.c]!.id, plate: v.plate, make: v.make, model: v.model, year: v.year, year_kind: 'primera_matriculacion', fuel: v.fuel,
    }))[0]!);
  }

  // ---- Cuenta «Prueba Cliente» vinculada a su ficha por invitación (como en la realidad)
  const client = await createUser(CLIENT, 'Prueba Cliente');
  const [inv] = await rest('POST', '/rpc/create_customer_invitation', owner.tok, { p_customer_id: customers[5]!.id });
  await rest('POST', '/rpc/accept_customer_invitation', client.tok, { p_token: inv!.token });

  // ---- Órdenes en distintos estados (el historial y los avisos los crea la base de datos)
  const flow = ['recibido', 'diagnosis', 'esperando_recambios', 'en_reparacion', 'listo', 'entregado'];
  const jobs = [
    { v: 0, c: 0, to: 'listo', problem: 'Ruido metálico al frenar y vibración en el volante.', diagnosis: 'Discos y pastillas delanteras desgastados por debajo del mínimo.', work: 'Cambio de discos y pastillas delanteros. Prueba en carretera correcta.', notes: 'Tu coche está listo. Puedes pasar a recogerlo de 9:00 a 19:00.', details: true },
    { v: 0, c: 0, to: 'entregado', problem: 'Revisión de los 60.000 km.', diagnosis: '', work: 'Cambio de aceite y filtros. Revisión de niveles.', notes: '', details: true },
    { v: 1, c: 1, to: 'esperando_recambios', problem: 'Testigo de motor encendido y pérdida de potencia.', diagnosis: 'Válvula EGR obstruida.', work: '', notes: 'Estamos esperando la pieza; te avisamos en cuanto llegue.', details: false },
    { v: 2, c: 2, to: 'diagnosis', problem: 'El aire acondicionado no enfría.', diagnosis: '', work: '', notes: '', details: false },
    { v: 3, c: 3, to: 'en_reparacion', problem: 'Embrague patina en cuestas.', diagnosis: 'Kit de embrague y volante bimasa desgastados.', work: '', notes: '', details: false },
    { v: 5, c: 4, to: 'recibido', problem: 'Primera revisión y ruido en la suspensión trasera.', diagnosis: '', work: '', notes: '', details: false },
    // Prueba Cliente
    { v: 6, c: 5, to: 'listo', problem: 'Revisión anual y ruido en la dirección al girar.', diagnosis: 'Rótula de dirección izquierda con holgura.', work: 'Sustitución de la rótula, alineado y revisión anual.', notes: 'Tu Golf ya está listo. Puedes recogerlo de 9:00 a 19:00.', details: true, worker: true },
    { v: 7, c: 5, to: 'en_reparacion', problem: 'Le cuesta arrancar en frío.', diagnosis: 'Batería agotada y bujías desgastadas.', work: '', notes: 'Estamos cambiando la batería; mañana te contamos.', details: true, worker: true },
    { v: 8, c: 5, to: 'diagnosis', problem: 'Testigo de neumáticos encendido.', diagnosis: '', work: '', notes: '', details: false, worker: true },
  ];
  for (const j of jobs) {
    const [o] = await rest('POST', '/repair_orders', owner.tok, {
      workshop_id: DEMO, vehicle_id: vehicles[j.v]!.id, customer_id: customers[j.c]!.id, problem_description: j.problem,
      assigned_to: 'worker' in j || j.c <= 1 ? worker.id : mech.id,
    });
    for (const s of flow.slice(1, flow.indexOf(j.to) + 1)) await rest('PATCH', `/repair_orders?id=eq.${o!.id}`, owner.tok, { status: s });
    await rest('PATCH', `/repair_orders?id=eq.${o!.id}`, owner.tok, {
      diagnosis: j.diagnosis || null, work_done: j.work || null, customer_notes: j.notes || null, show_details_to_customer: j.details,
      internal_notes: 'Nota interna de ejemplo: el cliente nunca la ve.',
    });
  }

  // ---- Dos solicitudes de cita desde la web pública (por el formulario real)
  for (const [name, phone] of [['Ana Torres', '656 789 012'], ['Pedro Gómez', '667 890 123']] as const) {
    await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
    await page.goto(`/?visita=${encodeURIComponent(name)}#solicitar`);
    await page.getByRole('tab', { name: 'Pedir cita' }).click();
    const form = page.locator('#solicitar-cita');
    await form.getByLabel('Nombre').fill(name, { timeout: 15_000 });
    await form.getByLabel('Teléfono').fill(phone);
    await form.getByLabel('Servicio').selectOption({ index: 1 });
    await form.getByLabel('Descripción del problema').fill('Quiero cita para revisar el coche esta semana.');
    await form.getByRole('checkbox').check();
    await form.getByRole('button', { name: 'Enviar solicitud de cita' }).click();
    await expect(form.getByRole('heading', { name: /recibida/ })).toBeVisible();
  }
  // ---- Una solicitud de «digitalizar mi taller» (sección comercial de la demo)
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `198.51.100.${Math.floor(Math.random() * 200) + 1}` });
  await page.goto('/?visita=comercial#digitalizar');
  const sales = page.locator('#solicitar-digitalizacion');
  await sales.getByRole('textbox', { name: 'Nombre *', exact: true }).fill('Rosa Martín', { timeout: 15_000 });
  await sales.getByLabel('Nombre de tu taller').fill('Talleres Martín (ejemplo)');
  await sales.getByLabel('Correo electrónico').fill('rosa.martin@ejemplo.test');
  await sales.getByLabel('¿Qué te gustaría mejorar en tu taller?').fill('Llevo las órdenes en papel y quiero una web nueva.');
  await sales.getByRole('checkbox').check();
  await sales.getByRole('button', { name: 'Quiero digitalizar mi taller' }).click();
  await expect(sales.getByRole('heading', { name: 'Solicitud recibida' })).toBeVisible();
  await page.setExtraHTTPHeaders({});

  // ---- Recorrido de pantallas
  await login(page, 'propietaria@e2e.test', '/panel');
  const t = await crawl(page, 'taller', ['/panel', '/panel/taller', '/panel/solicitudes', '/panel/avisos', '/cuenta', '/cuenta/contrasena'], ['/panel', '/cuenta'], 170);
  await login(page, WORKER, '/panel', DEMO_PASSWORD);
  const w = await crawl(page, 'trabajador', ['/panel', '/panel/ordenes', '/cuenta', '/cuenta/contrasena'], ['/panel', '/cuenta'], 80);
  await login(page, CLIENT, '/portal', DEMO_PASSWORD);
  const c = await crawl(page, 'cliente', ['/portal', '/portal/avisos', '/portal/datos', '/cuenta', '/cuenta/contrasena'], ['/portal', '/cuenta'], 60);
  expect(t).toBeGreaterThan(20);
  expect(w).toBeGreaterThan(5);
  expect(c).toBeGreaterThan(5);
});
