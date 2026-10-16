/* Web pública del taller */
'use strict';

const SERVICES = [
  { icon: 'drop', t: 'Mantenimiento y aceite', d: 'Revisiones oficiales según el plan del fabricante sin perder la garantía.', p: 79 },
  { icon: 'zap', t: 'Diagnosis electrónica', d: 'Leemos las averías de la centralita y te explicamos qué significan.', p: 35 },
  { icon: 'disc', t: 'Frenos', d: 'Pastillas, discos y líquido. Tu seguridad, revisada a fondo.', p: 89 },
  { icon: 'gauge', t: 'Neumáticos y alineado', d: 'Las mejores marcas al mejor precio, con montaje y equilibrado.', p: 59 },
  { icon: 'snow', t: 'Aire acondicionado', d: 'Carga de gas, detección de fugas y limpieza del circuito.', p: 65 },
  { icon: 'shield', t: 'Pre-ITV', d: 'Revisamos todos los puntos de la inspección para que pases a la primera.', p: 30 },
];

function renderServices() {
  $('#servicesGrid').innerHTML = SERVICES.map(s => `
    <article class="service card">
      <span class="ico-box">${icon(s.icon)}</span>
      <h3>${s.t}</h3>
      <p>${s.d}</p>
      <span class="price">Desde <b>${money(s.p)}</b></span>
    </article>`).join('');
  $$('[data-stars]').forEach(el => { el.innerHTML = icon('star').repeat(5); });
}

/* Tarjeta "en vivo" del hero: muestra un trabajo real de la demo */
function renderLiveCard() {
  const activas = ordenesActivas();
  const o = getOrden('OT-1048') && getOrden('OT-1048').estado !== 'entregado' ? getOrden('OT-1048') : activas[0];
  const el = $('#liveCard');
  if (!o) { el.innerHTML = `<div class="live-head"><span class="live-tag"><i></i>En directo</span></div><h3>Taller al día</h3><p class="muted">No hay vehículos en reparación ahora mismo.</p>`; return; }
  const v = getVehiculo(o.vehiculoId);
  const last = o.eventos[o.eventos.length - 1];
  el.innerHTML = `
    <div class="live-head"><span class="live-tag"><i></i>Seguimiento en directo</span>${plateHtml(v.matricula)}</div>
    <span class="xs muted">${esc(o.id)}</span>
    <h3>${esc(nombreVehiculo(v))}</h3>
    <div class="st st-${o.estado}"><div class="status-big" style="margin-top:8px"><span class="ring">${icon(o.estado === 'listo' ? 'checkCircle' : 'wrench')}</span><div><b>${ESTADO[o.estado].label}</b><span class="small muted">${esc(ESTADO[o.estado].cliente)}</span></div></div></div>
    ${stepperHtml(o)}
    <div class="live-foot"><span>Última actualización<br><b>${fmtAgo(last.fecha)}</b></span><span style="text-align:right">Entrega prevista<br><b>${fmtWhen(o.prevista)}</b></span></div>`;
}

/* Seguimiento rápido */
function setupTrack() {
  $('#trackForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    location.href = `cliente.html?m=${encodeURIComponent(normPlate(f.get('m')))}&c=${encodeURIComponent(String(f.get('c')).trim())}`;
  });
}

/* Reserva de cita */
const SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];

function renderSlots() {
  const dia = $('#diaInput').value;
  const box = $('#slots');
  if (!dia) { box.innerHTML = '<span class="form-hint">Elige primero un día.</span>'; return; }
  const d = new Date(dia + 'T00:00');
  if (d.getDay() === 0) { box.innerHTML = '<span class="form-error">Los domingos estamos cerrados. Elige otro día.</span>'; $('#horaInput').value = ''; return; }
  const sabado = d.getDay() === 6;
  const ocupadas = db().citas.filter(c => c.estado !== 'cancelada' && dateKey(c.fecha) === dia).map(c => fmtTime(c.fecha));
  const now = new Date();
  const sel = $('#horaInput').value;
  box.innerHTML = SLOTS.filter(h => !sabado || h < '13:30').map(h => {
    const past = new Date(`${dia}T${h}`) < now;
    const taken = ocupadas.includes(h);
    return `<button type="button" class="slot ${sel === h ? 'is-on' : ''}" data-h="${h}" ${past || taken ? 'disabled' : ''}>${h}</button>`;
  }).join('');
}

function setupBooking() {
  $('#servicioSel').innerHTML = '<option value="">Selecciona…</option>' + SERVICIOS.map(s => `<option>${s}</option>`).join('');
  const dia = $('#diaInput');
  const today = new Date();
  dia.min = dateKey(today);
  const def = new Date(); def.setDate(def.getDate() + 1); if (def.getDay() === 0) def.setDate(def.getDate() + 1);
  dia.value = dateKey(def);
  const params = new URLSearchParams(location.search);
  if (params.get('matricula')) $('#bookingForm').matricula.value = fmtPlate(params.get('matricula'));
  if (SERVICIOS.includes(params.get('servicio'))) $('#servicioSel').value = params.get('servicio');
  dia.addEventListener('change', () => { $('#horaInput').value = ''; renderSlots(); });
  $('#slots').addEventListener('click', e => {
    const b = e.target.closest('.slot');
    if (!b || b.disabled) return;
    $('#horaInput').value = b.dataset.h;
    renderSlots();
  });
  renderSlots();

  $('#bookingForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $('#bookingError');
    const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); };
    if (!f.nombre.trim() || digits(f.telefono).length < 9 || normPlate(f.matricula).length < 4 || !f.servicio) return fail('Revisa los campos: nombre, teléfono (9 cifras), matrícula y servicio son obligatorios.');
    if (!f.dia || !f.hora) return fail('Elige el día y la hora de la cita.');
    err.classList.add('hidden');
    const cita = crearCita({
      fecha: new Date(`${f.dia}T${f.hora}`).toISOString(),
      nombre: f.nombre.trim(), telefono: digits(f.telefono), matricula: normPlate(f.matricula),
      servicio: f.servicio, nota: f.nota.trim(),
    }, 'web');
    $('#bookingCard').innerHTML = `
      <div class="success-box">
        <div class="ok-ico">${icon('check')}</div>
        <h3 style="font-size:1.5rem">¡Cita reservada!</h3>
        <p class="muted" style="margin:8px 0 18px">${esc(cita.nombre.split(' ')[0])}, te esperamos el <b>${fmtDate(cita.fecha, { weekday: 'long', day: 'numeric', month: 'long' })}</b> a las <b>${fmtTime(cita.fecha)}</b> para <b>${esc(cita.servicio.toLowerCase())}</b>.</p>
        <p class="small muted">Te enviaremos la confirmación por WhatsApp al ${esc(cita.telefono)}.</p>
        <div class="hero-actions" style="justify-content:center">
          <a class="btn" href="index.html#cita" onclick="location.reload()">Reservar otra cita</a>
          <a class="btn btn-dark" href="taller.html#agenda" data-icon="board">Ver cómo le llega al taller</a>
        </div>
      </div>`;
    hydrateIcons($('#bookingCard'));
    toast('Cita reservada', 'Ya aparece en la agenda del taller', 'ok');
  });
}

function setupMenu() {
  const btn = $('#menuToggle'), nav = $('#nav');
  btn.addEventListener('click', () => { const open = nav.classList.toggle('is-open'); btn.setAttribute('aria-expanded', open); });
  nav.addEventListener('click', e => { if (e.target.closest('a')) { nav.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); } });
}

document.addEventListener('DOMContentLoaded', () => {
  Store.load();
  renderDemoBar('public');
  applyConfig();
  hydrateIcons();
  renderServices();
  renderLiveCard();
  setupTrack();
  setupBooking();
  setupMenu();
  $('#year').textContent = new Date().getFullYear();
  Store.on(() => { renderLiveCard(); if ($('#slots')) renderSlots(); });
  setInterval(renderLiveCard, 60000);
});
