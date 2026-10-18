/* =========================================================
   Núcleo compartido: configuración, datos, utilidades.
   Todo se guarda en localStorage para que la demo funcione
   sin servidor y los cambios se vean al instante entre pestañas.
   ========================================================= */
'use strict';

/* ---------- Configuración del taller ----------
   Se puede personalizar desde la URL antes de una visita, p. ej.:
   presentacion.html?taller=Talleres%20Pepe&tel=600111222&color=%230a7cff
*/
const DEFAULT_CONFIG = {
  nombre: 'Talleres Motorline',
  eslogan: 'Mecánica y electrónica del automóvil',
  telefono: '912 345 678',
  whatsapp: '600123456',
  prefijo: '34',
  email: 'hola@talleresmotorline.es',
  direccion: 'Calle de la Industria 24, Madrid',
  horario: 'Lun–Vie 8:30–19:00 · Sáb 9:00–13:30',
  color: '#ff5a1f',
  moneda: 'EUR',
  locale: 'es-ES',
  iva: 0.21,
  manoObraHora: 45,
};

const CONFIG_KEY = 'tallerdemo:config';
const DATA_KEY = 'tallerdemo:data:v1';

function safeGet(storage, key) { try { return storage.getItem(key); } catch (e) { return null; } }
function safeSet(storage, key, val) { try { storage.setItem(key, val); } catch (e) { /* modo privado */ } }
function safeDel(storage, key) { try { storage.removeItem(key); } catch (e) { /* modo privado */ } }

const CONFIG = (() => {
  let saved = {};
  try { saved = JSON.parse(safeGet(localStorage, CONFIG_KEY) || '{}'); } catch (e) { saved = {}; }
  const params = new URLSearchParams(location.search);
  const map = { taller: 'nombre', eslogan: 'eslogan', tel: 'telefono', wa: 'whatsapp', email: 'email', dir: 'direccion', horario: 'horario', color: 'color' };
  let changed = false;
  for (const [param, key] of Object.entries(map)) {
    if (params.has(param) && params.get(param).trim()) { saved[key] = params.get(param).trim(); changed = true; }
  }
  if (changed) safeSet(localStorage, CONFIG_KEY, JSON.stringify(saved));
  return Object.assign({}, DEFAULT_CONFIG, saved);
})();

function saveConfig(partial) {
  let saved = {};
  try { saved = JSON.parse(safeGet(localStorage, CONFIG_KEY) || '{}'); } catch (e) { saved = {}; }
  Object.assign(saved, partial);
  safeSet(localStorage, CONFIG_KEY, JSON.stringify(saved));
}

function applyConfig(root = document) {
  if (/^#[0-9a-f]{3,8}$/i.test(CONFIG.color)) document.documentElement.style.setProperty('--accent', CONFIG.color);
  root.querySelectorAll('[data-config]').forEach(el => { el.textContent = CONFIG[el.dataset.config] || ''; });
  root.querySelectorAll('[data-config-href]').forEach(el => {
    const k = el.dataset.configHref;
    if (k === 'telefono') el.href = 'tel:' + digits(CONFIG.telefono);
    if (k === 'email') el.href = 'mailto:' + CONFIG.email;
    if (k === 'whatsapp') el.href = waLink(CONFIG.whatsapp, `Hola ${CONFIG.nombre}, quería hacer una consulta.`);
  });
  if (document.title.includes('{taller}')) document.title = document.title.replace('{taller}', CONFIG.nombre);
}

/* ---------- Estados de una orden de trabajo ---------- */
const ESTADOS = [
  { id: 'recibido', label: 'Recibido', short: 'Recibido', cliente: 'Hemos recibido tu vehículo' },
  { id: 'diagnostico', label: 'En diagnóstico', short: 'Diagnóstico', cliente: 'Estamos revisando tu vehículo' },
  { id: 'presupuesto', label: 'Pendiente de aprobación', short: 'Presupuesto', cliente: 'Tu presupuesto está listo' },
  { id: 'reparacion', label: 'En reparación', short: 'Reparación', cliente: 'Estamos trabajando en tu vehículo' },
  { id: 'calidad', label: 'Control de calidad', short: 'Calidad', cliente: 'Prueba final y control de calidad' },
  { id: 'listo', label: 'Listo para recoger', short: 'Listo', cliente: '¡Tu vehículo está listo!' },
  { id: 'entregado', label: 'Entregado', short: 'Entregado', cliente: 'Vehículo entregado' },
];
const ESTADO = Object.fromEntries(ESTADOS.map((e, i) => [e.id, Object.assign({ i }, e)]));
const FLUJO = ESTADOS.filter(e => e.id !== 'entregado');

const SERVICIOS = [
  'Revisión y cambio de aceite', 'Diagnosis electrónica', 'Frenos', 'Neumáticos y alineado',
  'Aire acondicionado', 'Pre-ITV', 'Embrague', 'Distribución', 'Batería y arranque', 'Otro',
];

/* Catálogo para presupuestos en un clic */
const CATALOGO = [
  { concepto: 'Mano de obra', tipo: 'mano', precio: DEFAULT_CONFIG.manoObraHora },
  { concepto: 'Diagnosis electrónica', tipo: 'mano', precio: 35 },
  { concepto: 'Aceite 5W30 (5 L)', tipo: 'pieza', precio: 42 },
  { concepto: 'Filtro de aceite', tipo: 'pieza', precio: 12 },
  { concepto: 'Filtro de aire', tipo: 'pieza', precio: 18 },
  { concepto: 'Filtro de habitáculo', tipo: 'pieza', precio: 16 },
  { concepto: 'Pastillas de freno (eje)', tipo: 'pieza', precio: 58 },
  { concepto: 'Disco de freno', tipo: 'pieza', precio: 46 },
  { concepto: 'Neumático 205/55 R16', tipo: 'pieza', precio: 79 },
  { concepto: 'Carga gas A/A', tipo: 'pieza', precio: 65 },
  { concepto: 'Batería 60Ah', tipo: 'pieza', precio: 105 },
];

/* ---------- Utilidades ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 9);
const digits = s => String(s || '').replace(/\D/g, '');
const normPlate = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const nowIso = () => new Date().toISOString();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtPlate(p) {
  const n = normPlate(p);
  const m = n.match(/^(\d{4})([A-Z]{3})$/);
  return m ? `${m[1]} ${m[2]}` : n;
}
function plateHtml(p) { return `<span class="plate">${esc(fmtPlate(p))}</span>`; }
function money(n) {
  return new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.moneda }).format(n || 0);
}
function fmtNum(n) { return new Intl.NumberFormat(CONFIG.locale).format(n || 0); }
function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(CONFIG.locale, opts);
}
function fmtTime(iso) { return new Date(iso).toLocaleTimeString(CONFIG.locale, { hour: '2-digit', minute: '2-digit' }); }
function dateKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function sameDay(a, b) { return dateKey(a) === dateKey(b); }
function fmtWhen(iso) {
  const d = new Date(iso), now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return `Hoy, ${fmtTime(iso)}`;
  if (sameDay(d, tomorrow)) return `Mañana, ${fmtTime(iso)}`;
  if (sameDay(d, yesterday)) return `Ayer, ${fmtTime(iso)}`;
  return `${fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' })}, ${fmtTime(iso)}`;
}
function fmtAgo(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 45) return 'ahora mismo';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  return fmtDate(iso);
}
function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
function toLocalInput(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
function waLink(tel, text) {
  let n = digits(tel);
  if (n.length <= 9) n = CONFIG.prefijo + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
function baseUrl() { return location.href.replace(/[^/]*([?#].*)?$/, ''); }
function portalLink(vehiculo, cliente) {
  return `${baseUrl()}cliente.html?m=${encodeURIComponent(normPlate(vehiculo.matricula))}&c=${encodeURIComponent(cliente.codigo)}`;
}

/* ---------- Iconos (SVG en línea) ---------- */
const ICONS = {
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  snow: '<path d="M12 2v20M4.93 4.93l14.14 14.14M2 12h20M4.93 19.07 19.07 4.93"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  star: '<polygon class="ico-fill" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  board: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  euro: '<path d="M4 10h12M4 14h9M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
};
function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    if (!el.dataset.iconDone) { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)); el.dataset.iconDone = '1'; }
  });
}

/* ---------- Datos de ejemplo (relativos a hoy) ---------- */
function seed() {
  const H = 3600e3, D = 24 * H;
  const now = Date.now();
  const ago = h => new Date(now - h * H).toISOString();
  const daysAt = (d, hh = 9, mm = 0) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(hh, mm, 0, 0); return x.toISOString(); };
  const L = (concepto, tipo, cant, precio) => ({ id: uid(), concepto, tipo, cant, precio });
  const ev = (estado, iso, nota = '', origen = 'taller', tipo = 'estado') => ({ id: uid(), fecha: iso, estado, nota, origen, tipo });

  const mecanicos = [
    { id: 'm1', nombre: 'Javier Ruiz', especialidad: 'Mecánica general' },
    { id: 'm2', nombre: 'Marta López', especialidad: 'Electrónica y diagnosis' },
    { id: 'm3', nombre: 'Rubén Sanz', especialidad: 'Frenos y suspensión' },
  ];

  const clientes = [
    { id: 'c1', nombre: 'Laura Gómez', telefono: '600111222', email: 'laura.gomez@example.com', codigo: '2580', alta: daysAt(-900) },
    { id: 'c2', nombre: 'Carlos Martín', telefono: '600333444', email: 'carlos.m@example.com', codigo: '1111', alta: daysAt(-600) },
    { id: 'c3', nombre: 'Ana Torres', telefono: '600555666', email: 'ana.torres@example.com', codigo: '3030', alta: daysAt(-400) },
    { id: 'c4', nombre: 'Miguel Fernández', telefono: '600777888', email: '', codigo: '4455', alta: daysAt(-300) },
    { id: 'c5', nombre: 'Lucía Navarro', telefono: '600999000', email: 'lucia.n@example.com', codigo: '7272', alta: daysAt(-200) },
    { id: 'c6', nombre: 'Pedro Jiménez', telefono: '611222333', email: '', codigo: '9090', alta: daysAt(-60) },
    { id: 'c7', nombre: 'Raquel Moreno', telefono: '622111999', email: 'raquel.m@example.com', codigo: '5151', alta: daysAt(-500) },
    { id: 'c8', nombre: 'Andrés Castillo', telefono: '633777222', email: '', codigo: '6262', alta: daysAt(-120) },
    { id: 'c9', nombre: 'Transportes Hnos. Vidal', telefono: '644888111', email: 'flota@example.com', codigo: '8383', alta: daysAt(-700) },
  ];

  const vehiculos = [
    { id: 'v1', clienteId: 'c1', matricula: '1234KLM', marca: 'Seat', modelo: 'León 1.5 TSI', anio: 2019, km: 87450, color: 'Gris', itv: daysAt(48), proximaRevisionKm: 90000 },
    { id: 'v2', clienteId: 'c1', matricula: '4821JTB', marca: 'Renault', modelo: 'Clio 1.5 dCi', anio: 2015, km: 142300, color: 'Blanco', itv: daysAt(-6), proximaRevisionKm: 150000 },
    { id: 'v3', clienteId: 'c2', matricula: '5678BCD', marca: 'Volkswagen', modelo: 'Golf 2.0 TDI', anio: 2017, km: 168900, color: 'Azul', itv: daysAt(120), proximaRevisionKm: 180000 },
    { id: 'v4', clienteId: 'c3', matricula: '9012MNP', marca: 'Toyota', modelo: 'Corolla Hybrid', anio: 2021, km: 52300, color: 'Rojo', itv: daysAt(400), proximaRevisionKm: 60000 },
    { id: 'v5', clienteId: 'c4', matricula: '3456HJK', marca: 'Peugeot', modelo: '308 1.2 PureTech', anio: 2018, km: 119800, color: 'Negro', itv: daysAt(20), proximaRevisionKm: 120000 },
    { id: 'v6', clienteId: 'c5', matricula: '7788LCV', marca: 'Kia', modelo: 'Sportage 1.6 CRDi', anio: 2020, km: 74100, color: 'Plata', itv: daysAt(210), proximaRevisionKm: 90000 },
    { id: 'v7', clienteId: 'c6', matricula: '2468GTR', marca: 'Ford', modelo: 'Focus 1.0 EcoBoost', anio: 2016, km: 131500, color: 'Blanco', itv: daysAt(75), proximaRevisionKm: 135000 },
    { id: 'v8', clienteId: 'c7', matricula: '6123KZX', marca: 'BMW', modelo: 'Serie 1 118d', anio: 2018, km: 98200, color: 'Negro', itv: daysAt(160), proximaRevisionKm: 110000 },
    { id: 'v9', clienteId: 'c8', matricula: '0917LFG', marca: 'Dacia', modelo: 'Sandero Stepway', anio: 2022, km: 31400, color: 'Naranja', itv: daysAt(600), proximaRevisionKm: 45000 },
    { id: 'v10', clienteId: 'c9', matricula: '4402HYT', marca: 'Renault', modelo: 'Trafic 2.0 dCi', anio: 2017, km: 241000, color: 'Blanco', itv: daysAt(25), proximaRevisionKm: 250000 },
    { id: 'v11', clienteId: 'c9', matricula: '7719JNC', marca: 'Citroën', modelo: 'Berlingo 1.6 HDi', anio: 2016, km: 198700, color: 'Blanco', itv: daysAt(90), proximaRevisionKm: 200000 },
  ];

  const ordenes = [];
  const mk = o => ordenes.push(Object.assign({ salida: null, presupuesto: null, diagnostico: '', lineas: [], eventos: [] }, o));

  /* --- Trabajos activos en el taller --- */
  mk({
    id: 'OT-1048', vehiculoId: 'v1', clienteId: 'c1', mecanicoId: 'm3', estado: 'presupuesto', km: 87450,
    entrada: ago(26), prevista: daysAt(1, 18, 0),
    motivo: 'Ruido metálico al frenar. Aprovechar para hacer la revisión de los 90.000 km.',
    diagnostico: 'Pastillas delanteras al 10 % y discos por debajo del mínimo. Aceite y filtros según plan de mantenimiento.',
    lineas: [
      L('Pastillas de freno delanteras', 'pieza', 1, 58), L('Disco de freno delantero', 'pieza', 2, 46),
      L('Aceite 5W30 (5 L)', 'pieza', 1, 42), L('Filtro de aceite', 'pieza', 1, 12), L('Filtro de aire', 'pieza', 1, 18),
      L('Mano de obra', 'mano', 2.5, 45),
    ],
    presupuesto: { estado: 'pendiente', enviado: ago(2) },
    eventos: [
      ev('recibido', ago(26), 'Vehículo recibido en el taller. Km: 87.450.'),
      ev('diagnostico', ago(23), 'Rubén está revisando el sistema de frenos.'),
      ev('presupuesto', ago(2), 'Te hemos enviado el presupuesto. Puedes aprobarlo desde esta página.'),
    ],
  });
  mk({
    id: 'OT-1047', vehiculoId: 'v3', clienteId: 'c2', mecanicoId: 'm1', estado: 'reparacion', km: 168900,
    entrada: ago(50), prevista: daysAt(0, 19, 0),
    motivo: 'El embrague patina al acelerar en marchas largas.',
    diagnostico: 'Kit de embrague desgastado y volante bimasa con holgura.',
    lineas: [L('Kit de embrague', 'pieza', 1, 289), L('Volante bimasa', 'pieza', 1, 420), L('Mano de obra', 'mano', 6, 45)],
    presupuesto: { estado: 'aprobado', enviado: ago(44), respondido: ago(43) },
    eventos: [
      ev('recibido', ago(50), 'Vehículo recibido. Km: 168.900.'),
      ev('diagnostico', ago(48)),
      ev('presupuesto', ago(44), 'Presupuesto enviado.'),
      ev('reparacion', ago(43), 'Presupuesto aprobado por el cliente.', 'cliente'),
      ev('reparacion', ago(5), 'Piezas recibidas. Javier ya está montando el embrague.', 'taller', 'nota'),
    ],
  });
  mk({
    id: 'OT-1049', vehiculoId: 'v4', clienteId: 'c3', mecanicoId: 'm2', estado: 'diagnostico', km: 52300,
    entrada: ago(3), prevista: daysAt(1, 13, 0),
    motivo: 'Testigo de motor encendido y tirones al arrancar en frío.',
    eventos: [
      ev('recibido', ago(3), 'Vehículo recibido. Km: 52.300.'),
      ev('diagnostico', ago(1.5), 'Marta está conectando la máquina de diagnosis.'),
    ],
  });
  mk({
    id: 'OT-1046', vehiculoId: 'v5', clienteId: 'c4', mecanicoId: 'm1', estado: 'calidad', km: 119800,
    entrada: ago(76), prevista: daysAt(0, 17, 30),
    motivo: 'Cambio de correa de distribución (mantenimiento a 120.000 km).',
    diagnostico: 'Correa con grietas. Se sustituye kit completo con bomba de agua.',
    lineas: [L('Kit distribución + bomba de agua', 'pieza', 1, 265), L('Anticongelante (5 L)', 'pieza', 1, 24), L('Mano de obra', 'mano', 4, 45)],
    presupuesto: { estado: 'aprobado', enviado: ago(72), respondido: ago(70) },
    eventos: [
      ev('recibido', ago(76)), ev('diagnostico', ago(74)), ev('presupuesto', ago(72)),
      ev('reparacion', ago(70), 'Presupuesto aprobado por el cliente.', 'cliente'),
      ev('calidad', ago(1), 'Trabajo terminado. Haciendo prueba en carretera.'),
    ],
  });
  mk({
    id: 'OT-1045', vehiculoId: 'v6', clienteId: 'c5', mecanicoId: 'm3', estado: 'listo', km: 74100,
    entrada: ago(28), prevista: daysAt(0, 12, 0),
    motivo: 'Cambio de 4 neumáticos y alineado.',
    lineas: [L('Neumático 215/60 R17', 'pieza', 4, 96), L('Alineado de dirección', 'mano', 1, 45), L('Equilibrado y válvulas', 'mano', 4, 8)],
    presupuesto: { estado: 'aprobado', enviado: ago(27), respondido: ago(26.5) },
    eventos: [
      ev('recibido', ago(28)), ev('presupuesto', ago(27)),
      ev('reparacion', ago(26.5), 'Presupuesto aprobado por el cliente.', 'cliente'),
      ev('calidad', ago(4)),
      ev('listo', ago(0.8), 'Ya puedes pasar a recogerlo. Te esperamos.'),
    ],
  });
  mk({
    id: 'OT-1050', vehiculoId: 'v7', clienteId: 'c6', mecanicoId: 'm2', estado: 'recibido', km: 131500,
    entrada: ago(0.4), prevista: daysAt(2, 18, 0),
    motivo: 'El aire acondicionado no enfría.',
    eventos: [ev('recibido', ago(0.4), 'Vehículo recibido. Km: 131.500.')],
  });

  /* --- Historial (trabajos entregados) --- */
  const past = (id, vehiculoId, clienteId, mecanicoId, daysBack, km, motivo, lineas) => {
    const entrada = new Date(now - daysBack * D).toISOString();
    const salida = new Date(now - daysBack * D + 7 * H).toISOString();
    mk({
      id, vehiculoId, clienteId, mecanicoId, estado: 'entregado', km, entrada, prevista: salida, salida, motivo, lineas,
      presupuesto: { estado: 'aprobado', enviado: entrada, respondido: entrada },
      eventos: [ev('recibido', entrada), ev('reparacion', entrada), ev('listo', new Date(now - daysBack * D + 6 * H).toISOString()), ev('entregado', salida)],
    });
  };
  past('OT-1031', 'v1', 'c1', 'm1', 210, 75120, 'Revisión 75.000 km', [L('Aceite 5W30 (5 L)', 'pieza', 1, 42), L('Filtro de aceite', 'pieza', 1, 12), L('Filtro de habitáculo', 'pieza', 1, 16), L('Mano de obra', 'mano', 1, 45)]);
  past('OT-1012', 'v1', 'c1', 'm3', 480, 61300, 'Cambio de neumáticos delanteros', [L('Neumático 205/55 R16', 'pieza', 2, 79), L('Equilibrado y válvulas', 'mano', 2, 8)]);
  past('OT-0987', 'v1', 'c1', 'm2', 760, 48900, 'Pre-ITV y cambio de batería', [L('Batería 60Ah', 'pieza', 1, 105), L('Revisión pre-ITV', 'mano', 1, 30)]);
  past('OT-1038', 'v2', 'c1', 'm1', 95, 141800, 'Cambio de aceite y filtros', [L('Aceite 5W40 (5 L)', 'pieza', 1, 39), L('Filtro de aceite', 'pieza', 1, 12), L('Filtro de combustible', 'pieza', 1, 28), L('Mano de obra', 'mano', 1, 45)]);
  past('OT-1003', 'v2', 'c1', 'm3', 540, 128400, 'Amortiguadores traseros', [L('Amortiguador trasero', 'pieza', 2, 68), L('Mano de obra', 'mano', 1.5, 45)]);
  past('OT-1035', 'v3', 'c2', 'm2', 150, 161200, 'Revisión y carga de A/A', [L('Carga gas A/A', 'pieza', 1, 65), L('Diagnosis electrónica', 'mano', 1, 35)]);
  past('OT-1040', 'v4', 'c3', 'm1', 60, 50100, 'Revisión 50.000 km', [L('Aceite 0W20 (4 L)', 'pieza', 1, 48), L('Filtro de aceite', 'pieza', 1, 14), L('Mano de obra', 'mano', 1, 45)]);
  past('OT-1042', 'v5', 'c4', 'm3', 12, 118900, 'Pastillas de freno traseras', [L('Pastillas de freno (eje)', 'pieza', 1, 52), L('Mano de obra', 'mano', 1, 45)]);
  past('OT-1043', 'v6', 'c5', 'm1', 8, 73600, 'Cambio de aceite', [L('Aceite 5W30 (5 L)', 'pieza', 1, 42), L('Filtro de aceite', 'pieza', 1, 12), L('Mano de obra', 'mano', 0.8, 45)]);
  past('OT-1039', 'v8', 'c7', 'm3', 14, 97900, 'Amortiguadores delanteros y alineado', [L('Amortiguador delantero', 'pieza', 2, 92), L('Copela amortiguador', 'pieza', 2, 28), L('Alineado de dirección', 'mano', 1, 45), L('Mano de obra', 'mano', 2.5, 45)]);
  past('OT-1041', 'v10', 'c9', 'm1', 10, 240600, 'Embrague y revisión de flota', [L('Kit de embrague', 'pieza', 1, 310), L('Aceite 5W30 (5 L)', 'pieza', 2, 42), L('Filtro de aceite', 'pieza', 1, 14), L('Filtro de combustible', 'pieza', 1, 32), L('Mano de obra', 'mano', 6.5, 45)]);
  past('OT-1037', 'v11', 'c9', 'm2', 6, 198400, 'Diagnosis y sustitución del EGR', [L('Diagnosis electrónica', 'mano', 1, 35), L('Válvula EGR', 'pieza', 1, 185), L('Mano de obra', 'mano', 2, 45)]);
  past('OT-1036', 'v9', 'c8', 'm1', 2, 31200, 'Revisión 30.000 km', [L('Aceite 5W30 (5 L)', 'pieza', 1, 42), L('Filtro de aceite', 'pieza', 1, 12), L('Filtro de aire', 'pieza', 1, 18), L('Filtro de habitáculo', 'pieza', 1, 16), L('Mano de obra', 'mano', 1.2, 45)]);
  past('OT-1044', 'v7', 'c6', 'm2', 4, 131200, 'Diagnosis testigo ABS', [L('Diagnosis electrónica', 'mano', 1, 35), L('Sensor ABS delantero', 'pieza', 1, 54), L('Mano de obra', 'mano', 0.7, 45)]);

  const citas = [
    { id: uid(), fecha: daysAt(0, 16, 0), nombre: 'Sergio Prieto', telefono: '622333111', matricula: '9876HGF', servicio: 'Revisión y cambio de aceite', nota: '', estado: 'pendiente', origen: 'web', creada: ago(20) },
    { id: uid(), fecha: daysAt(0, 17, 30), nombre: 'Ana Torres', telefono: '600555666', matricula: '9012MNP', servicio: 'Diagnosis electrónica', nota: 'Recoger el coche y comentar diagnóstico', estado: 'confirmada', origen: 'telefono', creada: ago(30) },
    { id: uid(), fecha: daysAt(1, 9, 0), nombre: 'Elena Ruiz', telefono: '633444555', matricula: '1357KDS', servicio: 'Pre-ITV', nota: 'Tiene la ITV el viernes', estado: 'confirmada', origen: 'web', creada: ago(40) },
    { id: uid(), fecha: daysAt(1, 11, 30), nombre: 'Laura Gómez', telefono: '600111222', matricula: '4821JTB', servicio: 'Pre-ITV', nota: 'ITV caducada, revisar antes de pasarla', estado: 'pendiente', origen: 'web', creada: ago(6) },
    { id: uid(), fecha: daysAt(2, 10, 0), nombre: 'Tomás Herrera', telefono: '644555666', matricula: '8642LBN', servicio: 'Frenos', nota: 'Vibra el volante al frenar', estado: 'pendiente', origen: 'web', creada: ago(3) },
    { id: uid(), fecha: daysAt(3, 9, 30), nombre: 'Carlos Martín', telefono: '600333444', matricula: '5678BCD', servicio: 'Neumáticos y alineado', nota: '', estado: 'confirmada', origen: 'telefono', creada: ago(10) },
  ];

  const log = [
    { id: uid(), fecha: ago(0.4), tipo: 'orden', texto: 'Nueva orden OT-1050 · Ford Focus (2468 GTR)', origen: 'taller', clienteId: 'c6', ordenId: 'OT-1050' },
    { id: uid(), fecha: ago(0.8), tipo: 'estado', texto: 'Kia Sportage (7788 LCV) · Listo para recoger', origen: 'taller', clienteId: 'c5', ordenId: 'OT-1045' },
    { id: uid(), fecha: ago(2), tipo: 'presupuesto', texto: 'Presupuesto enviado a Laura Gómez · OT-1048', origen: 'taller', clienteId: 'c1', ordenId: 'OT-1048' },
    { id: uid(), fecha: ago(3), tipo: 'cita', texto: 'Cita online: Tomás Herrera · Frenos', origen: 'web' },
    { id: uid(), fecha: ago(6), tipo: 'cita', texto: 'Cita online: Laura Gómez · Pre-ITV', origen: 'web' },
  ];

  return { version: 1, creado: nowIso(), mecanicos, clientes, vehiculos, ordenes, citas, log };
}

/* ---------- Almacén con sincronización entre pestañas ---------- */
const Store = {
  data: null,
  listeners: [],
  load() {
    let parsed = null;
    try { parsed = JSON.parse(safeGet(localStorage, DATA_KEY) || 'null'); } catch (e) { parsed = null; }
    if (!parsed || !Array.isArray(parsed.ordenes)) { parsed = seed(); this.data = parsed; this.persist(); }
    this.data = parsed;
    return this.data;
  },
  persist() { safeSet(localStorage, DATA_KEY, JSON.stringify(this.data)); },
  save() { this.persist(); this.emit('local'); },
  reset() { safeDel(localStorage, DATA_KEY); this.data = seed(); this.save(); },
  on(fn) { this.listeners.push(fn); },
  emit(src) { this.listeners.forEach(fn => { try { fn(src); } catch (e) { console.error(e); } }); },
};
window.addEventListener('storage', e => {
  if (e.key === DATA_KEY) { Store.load(); Store.emit('remote'); }
  if (e.key === CONFIG_KEY) location.reload();
});

/* ---------- Consultas ---------- */
const db = () => Store.data;
const getCliente = id => db().clientes.find(c => c.id === id);
const getVehiculo = id => db().vehiculos.find(v => v.id === id);
const getMecanico = id => db().mecanicos.find(m => m.id === id);
const getOrden = id => db().ordenes.find(o => o.id === id);
const vehiculosDe = clienteId => db().vehiculos.filter(v => v.clienteId === clienteId);
const ordenesDeVehiculo = vid => db().ordenes.filter(o => o.vehiculoId === vid).sort((a, b) => new Date(b.entrada) - new Date(a.entrada));
const ordenesDeCliente = cid => db().ordenes.filter(o => o.clienteId === cid).sort((a, b) => new Date(b.entrada) - new Date(a.entrada));
const ordenesActivas = () => db().ordenes.filter(o => o.estado !== 'entregado');
const vehiculoPorMatricula = m => db().vehiculos.find(v => normPlate(v.matricula) === normPlate(m));
const nombreVehiculo = v => v ? `${v.marca} ${v.modelo}`.trim() : 'Vehículo';

function totales(o) {
  const base = (o.lineas || []).reduce((s, l) => s + (Number(l.cant) || 0) * (Number(l.precio) || 0), 0);
  const iva = base * CONFIG.iva;
  return { base, iva, total: base + iva };
}
function estaRetrasada(o) { return !['listo', 'entregado'].includes(o.estado) && o.prevista && new Date(o.prevista) < new Date(); }

function nuevoIdOrden() {
  const max = db().ordenes.reduce((m, o) => Math.max(m, parseInt(String(o.id).replace(/\D/g, ''), 10) || 0), 1000);
  return `OT-${max + 1}`;
}
function nuevoCodigo() {
  let c;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (db().clientes.some(x => x.codigo === c));
  return c;
}

/* ---------- Acciones ---------- */
function addLog(entry) {
  db().log.unshift(Object.assign({ id: uid(), fecha: nowIso() }, entry));
  db().log = db().log.slice(0, 80);
}
function etiquetaOrden(o) {
  const v = getVehiculo(o.vehiculoId);
  return `${nombreVehiculo(v)} (${fmtPlate(v?.matricula)})`;
}
function cambiarEstado(o, estado, { nota = '', origen = 'taller' } = {}) {
  o.estado = estado;
  o.eventos.push({ id: uid(), fecha: nowIso(), estado, nota, origen, tipo: 'estado' });
  if (estado === 'entregado') o.salida = nowIso();
  addLog({ tipo: 'estado', texto: `${etiquetaOrden(o)} · ${ESTADO[estado].label}`, origen, clienteId: o.clienteId, ordenId: o.id });
  Store.save();
}
function addNota(o, nota, origen = 'taller') {
  o.eventos.push({ id: uid(), fecha: nowIso(), estado: o.estado, nota, origen, tipo: 'nota' });
  addLog({ tipo: 'nota', texto: `Nota en ${o.id}: “${nota.slice(0, 60)}${nota.length > 60 ? '…' : ''}”`, origen, clienteId: o.clienteId, ordenId: o.id });
  Store.save();
}
function enviarPresupuesto(o) {
  o.presupuesto = { estado: 'pendiente', enviado: nowIso() };
  o.estado = 'presupuesto';
  o.eventos.push({ id: uid(), fecha: nowIso(), estado: 'presupuesto', nota: `Presupuesto de ${money(totales(o).total)} listo. Puedes aprobarlo desde esta página.`, origen: 'taller', tipo: 'estado' });
  addLog({ tipo: 'presupuesto', texto: `Presupuesto enviado · ${o.id} · ${money(totales(o).total)}`, origen: 'taller', clienteId: o.clienteId, ordenId: o.id });
  Store.save();
}
function responderPresupuesto(o, aprobado, origen = 'cliente') {
  if (!o.presupuesto) o.presupuesto = { estado: 'pendiente', enviado: nowIso() };
  o.presupuesto.estado = aprobado ? 'aprobado' : 'rechazado';
  o.presupuesto.respondido = nowIso();
  const quien = origen === 'cliente' ? 'por el cliente' : 'por teléfono';
  if (aprobado) {
    o.estado = 'reparacion';
    o.eventos.push({ id: uid(), fecha: nowIso(), estado: 'reparacion', nota: `Presupuesto aprobado ${quien}. ¡Nos ponemos manos a la obra!`, origen, tipo: 'estado' });
  } else {
    o.eventos.push({ id: uid(), fecha: nowIso(), estado: o.estado, nota: `Presupuesto rechazado ${quien}. Te llamaremos para buscar alternativas.`, origen, tipo: 'nota' });
  }
  const c = getCliente(o.clienteId);
  addLog({ tipo: 'presupuesto', texto: `${c?.nombre || 'Cliente'} ha ${aprobado ? 'APROBADO' : 'rechazado'} el presupuesto de ${o.id} (${money(totales(o).total)})`, origen, clienteId: o.clienteId, ordenId: o.id });
  Store.save();
}
function crearCita(c, origen = 'web') {
  const cita = Object.assign({ id: uid(), estado: 'pendiente', origen, creada: nowIso(), nota: '' }, c);
  db().citas.push(cita);
  addLog({ tipo: 'cita', texto: `${origen === 'web' ? 'Cita online' : 'Cita'}: ${cita.nombre} · ${cita.servicio} · ${fmtWhen(cita.fecha)}`, origen });
  Store.save();
  return cita;
}

/* ---------- UI compartida ---------- */
function toast(title, body = '', type = '') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'ok' ? 'checkCircle' : type === 'warn' ? 'alert' : 'bell')}<div><strong>${esc(title)}</strong>${body ? `<span>${esc(body)}</span>` : ''}</div>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 5200);
}

function estadoBadge(estado) {
  const e = ESTADO[estado];
  return `<span class="badge st st-${estado}">${esc(e ? e.label : estado)}</span>`;
}

function stepperHtml(o, labels = true) {
  const cur = ESTADO[o.estado].i;
  const bars = FLUJO.map((e, i) => {
    const cls = o.estado === 'entregado' || i < cur ? 'done' : i === cur ? (o.estado === 'listo' ? 'done' : 'cur') : '';
    return `<div class="s ${cls}"></div>`;
  }).join('');
  const lab = labels ? `<div class="stepper-labels">${FLUJO.map((e, i) => `<span class="${i === cur ? 'on' : ''}">${e.short}</span>`).join('')}</div>` : '';
  return `<div class="st st-${o.estado}"><div class="stepper">${bars}</div>${lab}</div>`;
}

function renderDemoBar(current) {
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  const link = (href, label, key) => `<a href="${href}" class="${current === key ? 'is-current' : ''}">${label}</a>`;
  bar.innerHTML = `<div class="wrap">
    <strong><span class="demo-dot"></span>Modo demostración</strong>
    <span class="hide-sm" style="color:#94a3b8">Abre dos pestañas y mira cómo se actualiza en directo</span>
    <nav class="demo-links" aria-label="Partes de la demo">
      ${link('presentacion.html', 'Qué incluye', 'pitch')}
      ${link('index.html', 'Web del taller', 'public')}
      ${link('cliente.html', 'Portal cliente', 'cliente')}
      ${link('taller.html', 'Panel del taller', 'taller')}
      <button type="button" data-reset title="Volver a los datos iniciales">${icon('refresh')} </button>
    </nav></div>`;
  document.body.prepend(bar);
  $('[data-reset]', bar).addEventListener('click', () => {
    if (confirm('¿Reiniciar la demo con los datos de ejemplo?')) { Store.reset(); location.reload(); }
  });
  if (window.matchMedia('(max-width: 760px)').matches) $('.hide-sm', bar).remove();
}

/* Ventana imprimible de factura / presupuesto */
function imprimirDocumento(o, tipo = 'Factura') {
  const v = getVehiculo(o.vehiculoId), c = getCliente(o.clienteId), t = totales(o);
  const rows = o.lineas.map(l => `<tr><td>${esc(l.concepto)}</td><td>${l.tipo === 'mano' ? 'Mano de obra' : 'Recambio'}</td><td class="n">${fmtNum(l.cant)}</td><td class="n">${money(l.precio)}</td><td class="n">${money(l.cant * l.precio)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${tipo} ${o.id}</title>
  <style>body{font-family:system-ui,sans-serif;color:#0e1726;margin:40px;font-size:14px}h1{font-size:28px;margin:0}table{width:100%;border-collapse:collapse;margin-top:24px}
  th,td{padding:10px;border-bottom:1px solid #e3e7ed;text-align:left}th{background:#f0f2f5;font-size:12px;text-transform:uppercase}.n{text-align:right}
  .top{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid ${esc(CONFIG.color)};padding-bottom:20px}.box{margin-top:24px;display:flex;gap:40px}
  .tot{margin-left:auto;width:280px;margin-top:20px}.tot div{display:flex;justify-content:space-between;padding:6px 0}.tot .g{font-size:20px;font-weight:800;border-top:2px solid #0e1726;padding-top:10px}
  small{color:#64748b}</style></head><body>
  <div class="top"><div><h1>${esc(CONFIG.nombre)}</h1><small>${esc(CONFIG.direccion)} · ${esc(CONFIG.telefono)} · ${esc(CONFIG.email)}</small></div>
  <div style="text-align:right"><h1>${tipo}</h1><small>${o.id} · ${fmtDate(o.salida || o.entrada)}</small></div></div>
  <div class="box"><div><small>Cliente</small><br><b>${esc(c?.nombre)}</b><br>${esc(c?.telefono)}<br>${esc(c?.email || '')}</div>
  <div><small>Vehículo</small><br><b>${esc(nombreVehiculo(v))}</b><br>${esc(fmtPlate(v?.matricula))} · ${fmtNum(o.km)} km</div>
  <div><small>Trabajo</small><br>${esc(o.motivo)}</div></div>
  <table><thead><tr><th>Concepto</th><th>Tipo</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="tot"><div><span>Base imponible</span><b>${money(t.base)}</b></div><div><span>IVA ${Math.round(CONFIG.iva * 100)} %</span><b>${money(t.iva)}</b></div><div class="g"><span>Total</span><span>${money(t.total)}</span></div></div>
  <p style="margin-top:40px"><small>Documento de demostración generado automáticamente.</small></p>
  <script>window.onload=()=>window.print()<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) { toast('Permite las ventanas emergentes', 'para imprimir o guardar en PDF', 'warn'); return; }
  w.document.write(html);
  w.document.close();
}
