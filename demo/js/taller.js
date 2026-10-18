/* Panel del taller: tablero de trabajos, agenda, clientes y recepción de vehículos */
'use strict';

const VIEWS = [
  { id: 'tablero', label: 'Tablero', icon: 'board' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar' },
  { id: 'clientes', label: 'Clientes', icon: 'users' },
  { id: 'nueva', label: 'Nueva orden', icon: 'plus' },
];

const state = {
  view: 'tablero',
  filtroMec: 'todos',
  busqueda: '',
  openId: null,
  clienteSel: null,
  busquedaCli: '',
  prefill: null,
  creada: null,
  seen: new Set(),
  flash: new Set(),
};

/* ---------- Utilidades del panel ---------- */
function setView(v) {
  if (!VIEWS.some(x => x.id === v)) v = 'tablero';
  state.view = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  render();
  window.scrollTo({ top: 0 });
}
const citasDeHoy = () => db().citas.filter(c => sameDay(c.fecha, new Date()) && !['cancelada', 'recepcionada'].includes(c.estado));
const ordenAbierta = vid => db().ordenes.find(o => o.vehiculoId === vid && o.estado !== 'entregado');
function copiar(text) {
  const ok = () => toast('Copiado al portapapeles', '', 'ok');
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, () => prompt('Copia el enlace:', text));
  else prompt('Copia el enlace:', text);
}

function mensajeCliente(o) {
  const c = getCliente(o.clienteId), v = getVehiculo(o.vehiculoId);
  const link = portalLink(v, c);
  const nombre = c.nombre.split(' ')[0];
  const veh = `${nombreVehiculo(v)} (${fmtPlate(v.matricula)})`;
  if (o.estado === 'presupuesto') return `Hola ${nombre}, te escribimos de ${CONFIG.nombre}. Ya tenemos el presupuesto de tu ${veh}: ${money(totales(o).total)} IVA incluido. Puedes revisarlo y aprobarlo con un clic aquí: ${link}`;
  if (o.estado === 'listo') return `Hola ${nombre}, ¡tu ${veh} ya está listo! Puedes pasar a recogerlo (${CONFIG.horario}). Detalle del trabajo y factura: ${link}`;
  if (o.estado === 'entregado') return `Hola ${nombre}, gracias por confiar en ${CONFIG.nombre}. Aquí tienes el historial y la factura de tu ${veh}: ${link}`;
  return `Hola ${nombre}, te escribimos de ${CONFIG.nombre}. Estado de tu ${veh}: ${ESTADO[o.estado].label}. Puedes seguir la reparación en directo aquí: ${link} (tu código: ${c.codigo})`;
}

/* Mover un trabajo de estado con las reglas del flujo */
function moverOrden(o, destino) {
  if (!o || destino === o.estado) return;
  if (destino === 'presupuesto') {
    if (!o.lineas.length) {
      openOrder(o.id, 'budget');
      toast('Añade las líneas del presupuesto', 'y pulsa “Enviar al cliente”', 'warn');
      return;
    }
    enviarPresupuesto(o);
    toast('Presupuesto enviado', `${getCliente(o.clienteId).nombre} puede aprobarlo desde su móvil`, 'ok');
    return;
  }
  const avanza = ESTADO[destino].i > ESTADO.presupuesto.i;
  if (avanza && o.lineas.length && (!o.presupuesto || o.presupuesto.estado !== 'aprobado')) {
    if (!confirm('El cliente aún no ha aprobado el presupuesto.\n¿Lo marcas como aprobado por teléfono?')) return;
    responderPresupuesto(o, true, 'taller');
    if (destino === 'reparacion') return;
  }
  cambiarEstado(o, destino);
  if (destino === 'entregado') toast('Vehículo entregado', `${o.id} pasa al historial del cliente`, 'ok');
  if (destino === 'listo') toast('Cliente avisado', 'Ya ve “Listo para recoger” en su portal', 'ok');
}

function siguiente(o) {
  if (o.estado === 'listo') return 'entregado';
  const i = ESTADO[o.estado].i;
  return FLUJO[i + 1] ? FLUJO[i + 1].id : null;
}

/* ---------- Render general ---------- */
function render() {
  renderTabs();
  renderBell();
  const view = $('#view');
  if (state.view === 'tablero') view.innerHTML = tableroHtml();
  if (state.view === 'agenda') view.innerHTML = agendaHtml();
  if (state.view === 'clientes') view.innerHTML = clientesHtml();
  if (state.view === 'nueva') view.innerHTML = state.creada ? creadaHtml() : nuevaHtml();
  hydrateIcons(view);
  bindView();
}

function renderTabs() {
  const counts = { tablero: ordenesActivas().length, agenda: citasDeHoy().length };
  $('#tabs').innerHTML = VIEWS.map(v => `<button class="tab ${state.view === v.id ? 'is-on' : ''}" data-view="${v.id}">${icon(v.icon)} ${v.label}${counts[v.id] ? ` <span class="count">${counts[v.id]}</span>` : ''}</button>`).join('');
  $$('#tabs [data-view]').forEach(b => b.addEventListener('click', () => { if (b.dataset.view === 'nueva') { state.creada = null; } setView(b.dataset.view); }));
}

/* ---------- Tablero ---------- */
function tableroHtml() {
  const act = ordenesActivas();
  const now = new Date();
  const facturado = db().ordenes.filter(o => o.estado === 'entregado' && o.salida && now - new Date(o.salida) <= 30 * 864e5)
    .reduce((s, o) => s + totales(o).total, 0);
  const pend = act.filter(o => o.presupuesto && o.presupuesto.estado === 'pendiente').length;
  const listos = act.filter(o => o.estado === 'listo').length;
  const retr = act.filter(estaRetrasada).length;

  const q = normPlate(state.busqueda);
  const ql = state.busqueda.trim().toLowerCase();
  const visibles = act.filter(o => {
    if (state.filtroMec !== 'todos' && o.mecanicoId !== state.filtroMec) return false;
    if (!ql) return true;
    const v = getVehiculo(o.vehiculoId), c = getCliente(o.clienteId);
    return (q && normPlate(v.matricula).includes(q)) || o.id.toLowerCase().includes(ql) || c.nombre.toLowerCase().includes(ql) || nombreVehiculo(v).toLowerCase().includes(ql);
  });

  const cols = FLUJO.map(e => {
    const items = visibles.filter(o => o.estado === e.id).sort((a, b) => new Date(a.prevista) - new Date(b.prevista));
    return `<section class="col st st-${e.id}" data-col="${e.id}">
      <div class="col-head"><i></i>${e.label}<span class="n">${items.length}</span></div>
      <div class="col-body">${items.length ? items.map(jobHtml).join('') : '<div class="col-empty">Arrastra aquí un trabajo</div>'}</div>
    </section>`;
  }).join('');

  return `
    <div class="kpis">
      <div class="kpi card"><small>${icon('car')} En el taller</small><b>${act.length}</b></div>
      <div class="kpi card ${pend ? 'k-warn' : ''}"><small>${icon('clipboard')} Esperando aprobación</small><b>${pend}</b></div>
      <div class="kpi card ${listos ? 'k-ok' : ''}"><small>${icon('checkCircle')} Listos para recoger</small><b>${listos}</b></div>
      <div class="kpi card ${retr ? 'k-bad' : ''}"><small>${icon('clock')} Retrasados</small><b>${retr}</b></div>
      <div class="kpi card is-click" data-goto="agenda"><small>${icon('calendar')} Citas hoy</small><b>${citasDeHoy().length}</b></div>
      <div class="kpi card"><small>${icon('euro')} Facturado 30 días</small><b style="font-size:1.35rem">${money(facturado)}</b></div>
    </div>
    <div class="toolbar">
      <label class="search-box">${icon('search')}<span class="sr-only">Buscar</span><input class="input" id="boardSearch" placeholder="Matrícula, cliente, OT…" value="${esc(state.busqueda)}"></label>
      <div class="filter-chips">
        <button class="fchip ${state.filtroMec === 'todos' ? 'is-on' : ''}" data-mec="todos">Todos</button>
        ${db().mecanicos.map(m => `<button class="fchip ${state.filtroMec === m.id ? 'is-on' : ''}" data-mec="${m.id}">${esc(m.nombre.split(' ')[0])}</button>`).join('')}
      </div>
      <span class="small muted" style="margin-left:auto">Arrastra las tarjetas o usa los botones. El cliente lo ve al instante.</span>
    </div>
    <div class="board" id="board">${cols}</div>`;
}

function jobHtml(o) {
  const v = getVehiculo(o.vehiculoId), c = getCliente(o.clienteId), m = getMecanico(o.mecanicoId);
  const late = estaRetrasada(o);
  const next = siguiente(o);
  let flag = '';
  if (o.presupuesto) {
    if (o.presupuesto.estado === 'pendiente') flag = `<span class="badge badge-warn">Esperando al cliente · ${money(totales(o).total)}</span>`;
    else if (o.presupuesto.estado === 'rechazado') flag = '<span class="badge badge-bad">Presupuesto rechazado</span>';
    else if (o.estado === 'reparacion' && o.presupuesto.respondido && Date.now() - new Date(o.presupuesto.respondido) < 6 * 3600e3) flag = `<span class="badge badge-ok">Aprobado ${fmtAgo(o.presupuesto.respondido)}</span>`;
  }
  let nextLabel = next ? ESTADO[next].short : '';
  if (o.estado === 'diagnostico') nextLabel = o.lineas.length ? 'Enviar presupuesto' : 'Presupuestar';
  if (o.estado === 'presupuesto' && o.presupuesto && o.presupuesto.estado === 'pendiente') nextLabel = 'Aprobado por tel.';
  if (o.estado === 'listo') nextLabel = 'Entregar';
  return `<article class="job st st-${o.estado} ${state.flash.has(o.id) ? 'flash' : ''}" draggable="true" data-id="${o.id}" tabindex="0">
    <div class="job-top">${plateHtml(v.matricula)}<span class="job-id">${esc(o.id)}</span></div>
    <div class="job-car">${esc(nombreVehiculo(v))}<div class="small muted" style="font-weight:500">${esc(c.nombre)}</div></div>
    <div class="job-motivo">${esc(o.motivo)}</div>
    ${flag}
    <div class="job-meta"><span>${icon('user')}${esc(m ? m.nombre.split(' ')[0] : 'Sin asignar')}</span><span class="${late ? 'late' : ''}">${icon('clock')}${late ? 'Retrasado · ' : ''}${fmtWhen(o.prevista)}</span></div>
    <div class="job-actions">
      <button class="btn btn-sm" data-open="${o.id}">Abrir</button>
      ${next ? `<button class="btn btn-sm btn-dark" data-next="${o.id}">${esc(nextLabel)} ${icon('arrow')}</button>` : ''}
    </div>
  </article>`;
}

/* ---------- Agenda ---------- */
function agendaHtml() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const dias = [];
  for (let i = 0; i < 14; i++) { const d = new Date(hoy); d.setDate(hoy.getDate() + i); dias.push(d); }
  const citas = db().citas.filter(c => c.estado !== 'cancelada');
  const bloques = dias.map((d, i) => {
    const del = citas.filter(c => sameDay(c.fecha, d)).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (!del.length && i > 0) return '';
    const titulo = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : d.toLocaleDateString(CONFIG.locale, { weekday: 'long' });
    return `<section>
      <div class="day-head"><h3>${titulo}</h3><span class="small muted">${fmtDate(d.toISOString(), { day: 'numeric', month: 'long' })} · ${del.length} ${del.length === 1 ? 'cita' : 'citas'}</span></div>
      ${del.length ? del.map(citaHtml).join('') : '<div class="empty" style="padding:22px">No hay citas para hoy.</div>'}
    </section>`;
  }).join('');

  const optsServ = SERVICIOS.map(s => `<option>${s}</option>`).join('');
  const manana = new Date(); manana.setDate(manana.getDate() + 1);
  return `
    <div class="page-title">
      <div><h1>Agenda</h1><p class="muted">Las citas pedidas desde la web entran aquí solas. Recepciona el coche con un clic.</p></div>
    </div>
    <details class="card card-pad" style="margin-bottom:22px">
      <summary style="cursor:pointer;font-weight:700">${icon('plus')} Añadir cita (llamada o mostrador)</summary>
      <form id="citaForm" class="form-grid" style="margin-top:16px;grid-template-columns:repeat(3,minmax(0,1fr))">
        <label class="field"><span>Nombre</span><input class="input" name="nombre" required></label>
        <label class="field"><span>Teléfono</span><input class="input" name="telefono" required inputmode="tel"></label>
        <label class="field"><span>Matrícula</span><input class="input input-plate" name="matricula" required></label>
        <label class="field"><span>Servicio</span><select class="select" name="servicio">${optsServ}</select></label>
        <label class="field"><span>Día y hora</span><input class="input" type="datetime-local" name="fecha" required value="${toLocalInput(new Date(manana.setHours(10, 0, 0, 0)).toISOString())}"></label>
        <label class="field"><span>Nota</span><input class="input" name="nota"></label>
        <div><button class="btn btn-dark" type="submit">${icon('calendar')} Guardar cita</button></div>
      </form>
    </details>
    <div class="agenda">${bloques}</div>`;
}

function citaHtml(c) {
  const v = vehiculoPorMatricula(c.matricula);
  const o = c.ordenId && getOrden(c.ordenId);
  const badge = c.estado === 'recepcionada' ? `<span class="badge badge-ok">En taller · ${esc(c.ordenId || '')}</span>`
    : c.estado === 'confirmada' ? '<span class="badge badge-info">Confirmada</span>' : '<span class="badge badge-warn">Por confirmar</span>';
  const msg = `Hola ${c.nombre.split(' ')[0]}, te confirmamos tu cita en ${CONFIG.nombre} el ${fmtDate(c.fecha, { weekday: 'long', day: 'numeric', month: 'long' })} a las ${fmtTime(c.fecha)} (${c.servicio}). ¡Te esperamos! ${CONFIG.direccion}`;
  return `<article class="card cita ${c.estado === 'recepcionada' ? 'done' : ''}">
    <div class="cita-hora">${fmtTime(c.fecha)}</div>
    <div>
      <div class="row" style="flex-wrap:wrap"><b>${esc(c.nombre)}</b>${plateHtml(c.matricula)}${badge}${c.origen === 'web' ? '<span class="badge no-dot">Online</span>' : ''}${v ? '<span class="badge no-dot badge-info">Cliente habitual</span>' : ''}</div>
      <div class="small muted">${esc(c.servicio)}${c.nota ? ` · “${esc(c.nota)}”` : ''} · ${esc(c.telefono)}</div>
    </div>
    <div class="cita-actions">
      ${c.estado === 'recepcionada'
        ? (o ? `<button class="btn btn-sm" data-open="${o.id}">Ver orden</button>` : '')
        : `<a class="btn btn-sm btn-wa" href="${waLink(c.telefono, msg)}" target="_blank" rel="noopener" data-confirm="${c.id}">${icon('chat')} Confirmar</a>
           <button class="btn btn-sm btn-dark" data-recep="${c.id}">${icon('car')} Recepcionar</button>
           <button class="btn btn-sm btn-ghost icon-btn" data-cancel="${c.id}" title="Cancelar cita" aria-label="Cancelar cita">${icon('x')}</button>`}
    </div>
  </article>`;
}

/* ---------- Clientes ---------- */
function clientesHtml() {
  const q = state.busquedaCli.trim().toLowerCase();
  const qp = normPlate(state.busquedaCli);
  const lista = db().clientes.filter(c => {
    if (!q) return true;
    return c.nombre.toLowerCase().includes(q) || digits(c.telefono).includes(digits(q) || '#') || (qp && vehiculosDe(c.id).some(v => normPlate(v.matricula).includes(qp)));
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (!state.clienteSel || !getCliente(state.clienteSel)) state.clienteSel = lista[0] ? lista[0].id : null;
  return `
    <div class="page-title"><div><h1>Clientes</h1><p class="muted">${db().clientes.length} clientes · ${db().vehiculos.length} vehículos · historial completo de cada uno.</p></div></div>
    <div class="clients">
      <div class="stack">
        <label class="search-box">${icon('search')}<span class="sr-only">Buscar cliente</span><input class="input" id="cliSearch" placeholder="Nombre, teléfono o matrícula" value="${esc(state.busquedaCli)}"></label>
        <div class="client-list">
          ${lista.map(c => {
            const vs = vehiculosDe(c.id);
            const enTaller = vs.some(v => ordenAbierta(v.id));
            return `<button class="client-row ${state.clienteSel === c.id ? 'is-on' : ''}" data-cli="${c.id}">
              <div class="row-between"><b>${esc(c.nombre)}</b>${enTaller ? '<span class="badge badge-info">En taller</span>' : ''}</div>
              <div class="row" style="flex-wrap:wrap">${vs.map(v => plateHtml(v.matricula)).join('')}</div>
            </button>`;
          }).join('') || '<div class="empty">Sin resultados</div>'}
        </div>
      </div>
      <div>${state.clienteSel ? clienteDetalleHtml(getCliente(state.clienteSel)) : ''}</div>
    </div>`;
}

function clienteDetalleHtml(c) {
  const vs = vehiculosDe(c.id);
  const ords = ordenesDeCliente(c.id);
  const gastado = ords.filter(o => o.estado === 'entregado').reduce((s, o) => s + totales(o).total, 0);
  const v0 = vs[0];
  return `<div class="card card-pad stack">
    <div class="row-between">
      <div class="greeting"><span class="avatar">${initials(c.nombre)}</span><div><h2 style="font-size:1.35rem">${esc(c.nombre)}</h2><span class="small muted">${esc(c.telefono)}${c.email ? ' · ' + esc(c.email) : ''} · cliente desde ${fmtDate(c.alta, { month: 'long', year: 'numeric' })}</span></div></div>
      <div style="text-align:right"><span class="small muted">Facturado total</span><br><b style="font-family:var(--font-display);font-size:1.3rem">${money(gastado)}</b></div>
    </div>
    <div class="row" style="flex-wrap:wrap">
      <span class="small muted">Código de acceso al portal:</span><span class="code-box">${esc(c.codigo)}</span>
      ${v0 ? `<button class="btn btn-sm" data-copy="${esc(portalLink(v0, c))}">${icon('copy')} Copiar enlace</button>
      <a class="btn btn-sm" href="${esc(portalLink(v0, c))}" target="_blank" rel="noopener">${icon('globe')} Ver su portal</a>
      <a class="btn btn-sm btn-wa" href="${waLink(c.telefono, `Hola ${c.nombre.split(' ')[0]}, este es tu acceso a ${CONFIG.nombre}: ${portalLink(v0, c)} · Código: ${c.codigo}`)}" target="_blank" rel="noopener">${icon('chat')} Enviar acceso</a>` : ''}
    </div>
    ${vs.map(v => {
      const os = ordenesDeVehiculo(v.id);
      return `<div class="budget">
        <div class="budget-head"><div class="row" style="flex-wrap:wrap">${plateHtml(v.matricula)}<b>${esc(nombreVehiculo(v))}</b><span class="small muted">${esc(v.anio || '')} · ${fmtNum(v.km)} km${v.itv ? ' · ITV ' + fmtDate(v.itv) : ''}</span></div><span class="small muted">${os.length} ${os.length === 1 ? 'visita' : 'visitas'}</span></div>
        ${os.length ? `<table class="tbl"><thead><tr><th>Fecha</th><th>Trabajo</th><th>Estado</th><th class="num">Total</th></tr></thead><tbody>
          ${os.map(o => `<tr style="cursor:pointer" data-open="${o.id}"><td class="nowrap">${fmtDate(o.entrada)}</td><td>${esc(o.motivo)}<br><span class="xs muted">${esc(o.id)} · ${fmtNum(o.km)} km</span></td><td>${estadoBadge(o.estado)}</td><td class="num">${o.lineas.length ? money(totales(o).total) : '—'}</td></tr>`).join('')}
        </tbody></table>` : '<p class="small muted" style="padding:14px 16px">Sin visitas registradas.</p>'}
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------- Nueva orden (recepción del vehículo) ---------- */
function nuevaHtml() {
  const p = state.prefill || {};
  const prevista = new Date(); prevista.setDate(prevista.getDate() + 1); prevista.setHours(18, 0, 0, 0);
  return `
    <div class="page-title"><div><h1>Recepción de vehículo</h1><p class="muted">Escribe la matrícula: si ya es cliente, se rellena todo solo.</p></div></div>
    <form id="newForm" class="card card-pad stack" autocomplete="off" style="max-width:900px">
      ${p.citaId ? `<div class="alert alert-info">${icon('calendar')}<span>Recepcionando la cita de <b>${esc(p.nombre)}</b> · ${esc(p.servicio)}</span></div>` : ''}
      <div id="knownBox"></div>
      <h3 style="font-size:1rem">${icon('car')} Vehículo</h3>
      <div class="form-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <label class="field"><span>Matrícula *</span><input class="input input-plate" name="matricula" required value="${esc(p.matricula ? fmtPlate(p.matricula) : '')}" placeholder="1234 ABC"></label>
        <label class="field"><span>Marca *</span><input class="input" name="marca" required></label>
        <label class="field"><span>Modelo</span><input class="input" name="modelo"></label>
        <label class="field"><span>Kilómetros *</span><input class="input" name="km" type="number" min="0" required></label>
      </div>
      <h3 style="font-size:1rem;margin-top:8px">${icon('user')} Cliente</h3>
      <div class="form-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <label class="field"><span>Nombre *</span><input class="input" name="nombre" required value="${esc(p.nombre || '')}"></label>
        <label class="field"><span>Teléfono *</span><input class="input" name="telefono" required inputmode="tel" value="${esc(p.telefono || '')}"></label>
        <label class="field"><span>Email</span><input class="input" name="email" type="email"></label>
      </div>
      <h3 style="font-size:1rem;margin-top:8px">${icon('wrench')} Trabajo</h3>
      <div class="form-grid" style="grid-template-columns:2fr 1fr 1fr">
        <label class="field"><span>Motivo / síntomas *</span><input class="input" name="motivo" required value="${esc(p.motivo || '')}" placeholder="Ej.: ruido al frenar, revisión 60.000 km…"></label>
        <label class="field"><span>Mecánico</span><select class="select" name="mecanicoId">${db().mecanicos.map(m => `<option value="${m.id}">${esc(m.nombre)} · ${esc(m.especialidad)}</option>`).join('')}</select></label>
        <label class="field"><span>Entrega prevista</span><input class="input" type="datetime-local" name="prevista" value="${toLocalInput(prevista.toISOString())}"></label>
      </div>
      <p class="form-error hidden" id="newError"></p>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn btn-primary btn-lg" type="submit">${icon('check')} Crear orden y avisar al cliente</button>
        ${p.citaId ? '<button class="btn btn-ghost" type="button" data-clear-prefill>Cancelar</button>' : ''}
      </div>
    </form>`;
}

function creadaHtml() {
  const o = getOrden(state.creada);
  if (!o) { state.creada = null; return nuevaHtml(); }
  const c = getCliente(o.clienteId), v = getVehiculo(o.vehiculoId);
  return `<div class="card success-box" style="max-width:640px;margin:20px auto">
    <div class="ok-ico">${icon('check')}</div>
    <h2>Orden ${esc(o.id)} creada</h2>
    <p class="muted" style="margin:8px 0 18px">${esc(nombreVehiculo(v))} ${plateHtml(v.matricula)} de <b>${esc(c.nombre)}</b> ya está en el tablero como <b>Recibido</b>.</p>
    <div class="row" style="justify-content:center;margin-bottom:22px"><span class="small muted">Código del cliente:</span><span class="code-box" style="font-size:1.3rem">${esc(c.codigo)}</span></div>
    <div class="hero-actions" style="justify-content:center;margin-top:0">
      <a class="btn btn-wa" href="${waLink(c.telefono, mensajeCliente(o))}" target="_blank" rel="noopener">${icon('chat')} Enviar seguimiento por WhatsApp</a>
      <button class="btn btn-dark" data-open="${o.id}">Abrir orden</button>
      <button class="btn" data-goto="tablero">Ir al tablero</button>
    </div>
    <p class="xs muted" style="margin-top:18px">Enlace directo del cliente: <a href="${esc(portalLink(v, c))}" target="_blank" rel="noopener">${esc(portalLink(v, c))}</a></p>
  </div>`;
}

function rellenarConocido(form) {
  const v = vehiculoPorMatricula(form.matricula.value);
  const box = $('#knownBox');
  if (!v) { box.innerHTML = ''; return; }
  const c = getCliente(v.clienteId);
  const abierta = ordenAbierta(v.id);
  form.marca.value = v.marca; form.modelo.value = v.modelo;
  if (!form.km.value) form.km.value = v.km;
  form.km.min = v.km;
  form.nombre.value = c.nombre; form.telefono.value = c.telefono; form.email.value = c.email || '';
  box.innerHTML = abierta
    ? `<div class="alert alert-warn">${icon('alert')}<span>Este vehículo ya tiene la orden <b>${esc(abierta.id)}</b> abierta (${esc(ESTADO[abierta.estado].label)}). <button type="button" class="btn btn-sm" data-open="${abierta.id}">Abrirla</button></span></div>`
    : `<div class="alert alert-ok">${icon('checkCircle')}<span>Cliente habitual: <b>${esc(c.nombre)}</b> · ${ordenesDeVehiculo(v.id).length} visitas anteriores · último km ${fmtNum(v.km)}. Datos rellenados automáticamente.</span></div>`;
  hydrateIcons(box);
  $$('[data-open]', box).forEach(b => b.addEventListener('click', () => openOrder(b.dataset.open)));
}

function crearOrden(form) {
  const f = Object.fromEntries(new FormData(form));
  const err = $('#newError');
  const fail = m => { err.textContent = m; err.classList.remove('hidden'); };
  const mat = normPlate(f.matricula);
  const km = parseInt(f.km, 10);
  if (mat.length < 4) return fail('La matrícula no es válida.');
  if (!f.marca.trim() || !f.nombre.trim() || digits(f.telefono).length < 9 || !f.motivo.trim() || isNaN(km)) return fail('Completa los campos obligatorios (*). El teléfono debe tener 9 cifras.');
  let v = vehiculoPorMatricula(mat);
  if (v && ordenAbierta(v.id)) return fail(`Este vehículo ya tiene la orden ${ordenAbierta(v.id).id} abierta.`);
  let c;
  if (v) {
    c = getCliente(v.clienteId);
    v.km = Math.max(v.km, km);
    if (f.email && !c.email) c.email = f.email.trim();
  } else {
    c = db().clientes.find(x => digits(x.telefono) === digits(f.telefono));
    if (!c) {
      c = { id: 'c' + uid(), nombre: f.nombre.trim(), telefono: digits(f.telefono), email: f.email.trim(), codigo: nuevoCodigo(), alta: nowIso() };
      db().clientes.push(c);
    }
    v = { id: 'v' + uid(), clienteId: c.id, matricula: mat, marca: f.marca.trim(), modelo: f.modelo.trim(), anio: '', km, color: '', itv: null, proximaRevisionKm: Math.ceil((km + 15000) / 1000) * 1000 };
    db().vehiculos.push(v);
  }
  const o = {
    id: nuevoIdOrden(), vehiculoId: v.id, clienteId: c.id, mecanicoId: f.mecanicoId, estado: 'recibido', km,
    entrada: nowIso(), prevista: f.prevista ? new Date(f.prevista).toISOString() : nowIso(), salida: null,
    motivo: f.motivo.trim(), diagnostico: '', lineas: [], presupuesto: null,
    eventos: [{ id: uid(), fecha: nowIso(), estado: 'recibido', nota: `Vehículo recibido en el taller. Km: ${fmtNum(km)}.`, origen: 'taller', tipo: 'estado' }],
  };
  db().ordenes.push(o);
  if (state.prefill && state.prefill.citaId) {
    const cita = db().citas.find(x => x.id === state.prefill.citaId);
    if (cita) { cita.estado = 'recepcionada'; cita.ordenId = o.id; }
  }
  addLog({ tipo: 'orden', texto: `Nueva orden ${o.id} · ${etiquetaOrden(o)}`, origen: 'taller', clienteId: c.id, ordenId: o.id });
  state.prefill = null;
  state.creada = o.id;
  state.flash.add(o.id);
  Store.save();
  toast(`Orden ${o.id} creada`, `${c.nombre} ya puede seguirla con el código ${c.codigo}`, 'ok');
}

/* ---------- Detalle de orden (modal) ---------- */
function openOrder(id, focus) {
  state.openId = id;
  renderOrder();
  const dlg = $('#orderDialog');
  if (!dlg.open) dlg.showModal();
  if (focus === 'budget') setTimeout(() => $('#budgetSec')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
}

function renderOrder() {
  const o = getOrden(state.openId);
  if (!o) { $('#orderDialog').close(); return; }
  const v = getVehiculo(o.vehiculoId), c = getCliente(o.clienteId);
  const nota = $('#noteInput') ? $('#noteInput').value : '';
  $('#orderHead').innerHTML = `
    ${plateHtml(v.matricula)}
    <div><h3>${esc(nombreVehiculo(v))}</h3><span class="xs muted">${esc(o.id)} · entrada ${fmtWhen(o.entrada).toLowerCase()} · ${fmtNum(o.km)} km</span></div>
    ${estadoBadge(o.estado)}
    <button class="btn btn-ghost icon-btn" data-close aria-label="Cerrar">${icon('x')}</button>`;

  const evs = o.eventos.slice().reverse();
  $('#orderBody').innerHTML = `
  <div class="od-grid">
    <div class="stack">
      <section class="card od-section">
        <h4>${icon('gauge')} Estado del trabajo</h4>
        <div class="status-pick">${ESTADOS.map(e => `<button type="button" class="st st-${e.id} ${o.estado === e.id ? 'is-on' : ''}" data-set="${e.id}">${e.short}</button>`).join('')}</div>
        <div class="form-grid" style="margin-top:16px">
          <label class="field"><span>Mecánico</span><select class="select" id="mecSel">${db().mecanicos.map(m => `<option value="${m.id}" ${m.id === o.mecanicoId ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select></label>
          <label class="field"><span>Entrega prevista</span><input class="input" type="datetime-local" id="prevInput" value="${o.prevista ? toLocalInput(o.prevista) : ''}"></label>
        </div>
      </section>
      <section class="card od-section">
        <h4>${icon('wrench')} Motivo y diagnóstico</h4>
        <p class="small" style="margin-bottom:10px"><b>Motivo:</b> ${esc(o.motivo)}</p>
        <label class="field"><span>Diagnóstico (lo ve el cliente)</span><textarea class="textarea" id="diagInput" placeholder="Qué habéis encontrado, explicado de forma sencilla…">${esc(o.diagnostico)}</textarea></label>
      </section>
      <section class="card od-section" id="budgetSec">${budgetEditorHtml(o)}</section>
    </div>
    <div class="stack">
      <section class="card od-section">
        <h4>${icon('user')} Cliente</h4>
        <b>${esc(c.nombre)}</b>
        <div class="small muted" style="margin:2px 0 12px"><a href="tel:${esc(digits(c.telefono))}">${esc(c.telefono)}</a>${c.email ? ' · ' + esc(c.email) : ''}</div>
        <div class="row" style="margin-bottom:12px"><span class="small muted">Código portal</span><span class="code-box">${esc(c.codigo)}</span></div>
        <div class="stack" style="gap:8px">
          <a class="btn btn-wa btn-block" href="${waLink(c.telefono, mensajeCliente(o))}" target="_blank" rel="noopener">${icon('chat')} Avisar por WhatsApp</a>
          <div class="row">
            <button class="btn btn-sm" style="flex:1" data-copy="${esc(portalLink(v, c))}">${icon('copy')} Copiar enlace</button>
            <a class="btn btn-sm" style="flex:1" href="${esc(portalLink(v, c))}" target="_blank" rel="noopener">${icon('globe')} Ver como cliente</a>
          </div>
        </div>
      </section>
      <section class="card od-section">
        <h4>${icon('chat')} Seguimiento para el cliente</h4>
        <div class="stack" style="gap:8px;margin-bottom:16px">
          <textarea class="textarea" id="noteInput" style="min-height:70px" placeholder="Ej.: Ya han llegado las piezas, mañana a primera hora lo montamos.">${esc(nota)}</textarea>
          <div class="quick-items" style="margin:0">
            ${['Esperando la llegada de piezas.', 'Estamos haciendo la prueba en carretera.', 'Hemos encontrado algo más, te llamamos.', 'Lavado de cortesía incluido.'].map(t => `<button type="button" data-quicknote="${esc(t)}">${esc(t)}</button>`).join('')}
          </div>
          <button class="btn btn-dark btn-sm" id="noteBtn">${icon('send')} Publicar en su portal</button>
        </div>
        <ol class="timeline">${evs.map(ev => `<li class="st st-${ev.estado}">
          <div class="t-time">${fmtWhen(ev.fecha)} ${ev.origen === 'cliente' ? '· <span class="t-who" style="color:var(--ok)">CLIENTE</span>' : ''}</div>
          <div class="t-title">${ev.tipo === 'nota' ? 'Nota' : esc(ESTADO[ev.estado].label)}</div>
          ${ev.nota ? `<div class="t-note">${esc(ev.nota)}</div>` : ''}
        </li>`).join('')}</ol>
      </section>
    </div>
  </div>`;
  bindOrder(o);
}

function budgetEditorHtml(o) {
  const p = o.presupuesto;
  const t = totales(o);
  const badge = !p ? '<span class="badge">Borrador</span>'
    : p.estado === 'pendiente' ? '<span class="badge badge-warn">Enviado · esperando al cliente</span>'
    : p.estado === 'aprobado' ? `<span class="badge badge-ok">Aprobado ${p.respondido ? fmtAgo(p.respondido) : ''}</span>`
    : '<span class="badge badge-bad">Rechazado</span>';
  return `
    <div class="row-between" style="margin-bottom:12px"><h4 style="margin:0">${icon('clipboard')} Presupuesto</h4>${badge}</div>
    <div class="budget budget-scroll">
      <table class="tbl line-edit">
        <thead><tr><th>Concepto</th><th>Tipo</th><th>Cant.</th><th>Precio</th><th class="num">Importe</th><th></th></tr></thead>
        <tbody>
          ${o.lineas.map(l => `<tr data-line="${l.id}">
            <td><input class="input" data-f="concepto" value="${esc(l.concepto)}" aria-label="Concepto"></td>
            <td><select class="select" data-f="tipo" aria-label="Tipo"><option value="pieza" ${l.tipo === 'pieza' ? 'selected' : ''}>Recambio</option><option value="mano" ${l.tipo === 'mano' ? 'selected' : ''}>M. obra</option></select></td>
            <td><input class="input w-cant" data-f="cant" type="number" step="0.1" min="0" value="${l.cant}" aria-label="Cantidad"></td>
            <td><input class="input w-precio" data-f="precio" type="number" step="0.01" min="0" value="${l.precio}" aria-label="Precio"></td>
            <td class="num" data-imp>${money(l.cant * l.precio)}</td>
            <td><button type="button" class="btn btn-ghost icon-btn btn-sm" data-del="${l.id}" aria-label="Quitar línea">${icon('trash')}</button></td>
          </tr>`).join('') || '<tr><td colspan="6" class="muted small" style="padding:14px 16px">Sin líneas. Añade recambios y mano de obra con los botones de abajo.</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="quick-items">
      ${CATALOGO.map((it, i) => `<button type="button" data-add="${i}">+ ${esc(it.concepto)} <span class="muted">${money(it.precio)}</span></button>`).join('')}
      <button type="button" data-add="-1">+ Línea libre</button>
    </div>
    <div class="row-between" id="budgetTotals">${totalsHtml(t)}</div>
    <div class="row" style="flex-wrap:wrap;margin-top:14px">
      <button class="btn btn-primary btn-sm" data-send-budget ${o.lineas.length ? '' : 'disabled'}>${icon('send')} ${p && p.estado === 'pendiente' ? 'Reenviar al cliente' : 'Enviar al cliente'}</button>
      ${p && p.estado === 'pendiente' ? `<button class="btn btn-sm" data-phone-ok>${icon('phone')} Aprobado por teléfono</button>` : ''}
      <button class="btn btn-sm btn-ghost" data-print ${o.lineas.length ? '' : 'disabled'}>${icon('printer')} Imprimir</button>
    </div>`;
}
function totalsHtml(t) {
  return `<span class="small muted">Base ${money(t.base)} · IVA ${money(t.iva)}</span><b style="font-family:var(--font-display);font-size:1.25rem">Total ${money(t.total)}</b>`;
}

function bindOrder(o) {
  const body = $('#orderBody');
  $('#orderHead [data-close]').addEventListener('click', () => $('#orderDialog').close());
  $$('[data-set]', body).forEach(b => b.addEventListener('click', () => { moverOrden(o, b.dataset.set); renderOrder(); }));
  $('#mecSel').addEventListener('change', e => { o.mecanicoId = e.target.value; Store.save(); toast('Mecánico asignado', getMecanico(o.mecanicoId).nombre, 'ok'); });
  $('#prevInput').addEventListener('change', e => { if (e.target.value) { o.prevista = new Date(e.target.value).toISOString(); Store.save(); toast('Fecha de entrega actualizada', fmtWhen(o.prevista), 'ok'); } });
  $('#diagInput').addEventListener('change', e => { o.diagnostico = e.target.value.trim(); Store.save(); toast('Diagnóstico guardado', 'Visible en el portal del cliente', 'ok'); });
  $$('[data-quicknote]', body).forEach(b => b.addEventListener('click', () => { $('#noteInput').value = b.dataset.quicknote; $('#noteInput').focus(); }));
  $('#noteBtn').addEventListener('click', () => {
    const t = $('#noteInput').value.trim();
    if (!t) return $('#noteInput').focus();
    $('#noteInput').value = '';
    addNota(o, t);
    renderOrder();
    toast('Nota publicada', 'El cliente la ve en su portal', 'ok');
  });
  $$('[data-copy]', body).forEach(b => b.addEventListener('click', () => copiar(b.dataset.copy)));
  bindBudget(o);
}

function bindBudget(o) {
  const sec = $('#budgetSec');
  const rerender = () => { sec.innerHTML = budgetEditorHtml(o); bindBudget(o); };
  $$('[data-line]', sec).forEach(row => {
    const l = o.lineas.find(x => x.id === row.dataset.line);
    $$('[data-f]', row).forEach(inp => inp.addEventListener('change', () => {
      const f = inp.dataset.f;
      l[f] = (f === 'cant' || f === 'precio') ? Math.max(0, parseFloat(inp.value) || 0) : inp.value;
      Store.save();
      $('[data-imp]', row).textContent = money(l.cant * l.precio);
      $('#budgetTotals').innerHTML = totalsHtml(totales(o));
    }));
  });
  $$('[data-del]', sec).forEach(b => b.addEventListener('click', () => { o.lineas = o.lineas.filter(l => l.id !== b.dataset.del); Store.save(); rerender(); }));
  $$('[data-add]', sec).forEach(b => b.addEventListener('click', () => {
    const i = parseInt(b.dataset.add, 10);
    const it = i >= 0 ? CATALOGO[i] : { concepto: '', tipo: 'pieza', precio: 0 };
    const existing = i >= 0 && o.lineas.find(l => l.concepto === it.concepto && l.precio === it.precio);
    if (existing) existing.cant = Math.round((existing.cant + 1) * 10) / 10;
    else o.lineas.push({ id: uid(), concepto: it.concepto, tipo: it.tipo, cant: 1, precio: it.precio });
    Store.save();
    rerender();
    if (i < 0) { const rows = $$('[data-line]', sec); $('[data-f="concepto"]', rows[rows.length - 1]).focus(); }
  }));
  const send = $('[data-send-budget]', sec);
  if (send) send.addEventListener('click', () => {
    if (o.lineas.some(l => !String(l.concepto).trim())) { toast('Hay líneas sin concepto', 'Escribe el concepto o elimínalas', 'warn'); return; }
    enviarPresupuesto(o);
    renderOrder();
    toast('Presupuesto enviado', `${getCliente(o.clienteId).nombre} ya lo ve en su portal y puede aprobarlo`, 'ok');
  });
  const phone = $('[data-phone-ok]', sec);
  if (phone) phone.addEventListener('click', () => { responderPresupuesto(o, true, 'taller'); renderOrder(); toast('Presupuesto aprobado', 'El trabajo pasa a reparación', 'ok'); });
  const pr = $('[data-print]', sec);
  if (pr) pr.addEventListener('click', () => imprimirDocumento(o, 'Presupuesto'));
}

/* ---------- Actividad / notificaciones ---------- */
function renderBell() {
  const unseen = db().log.filter(l => !state.seen.has(l.id) && l.origen !== 'taller').length;
  const btn = $('#bellBtn');
  let dot = $('.bell .dot');
  if (unseen) {
    if (!dot) { dot = document.createElement('span'); dot.className = 'dot'; btn.parentElement.appendChild(dot); }
    dot.textContent = unseen;
  } else if (dot) dot.remove();
  const pop = $('#activity');
  if (!pop.classList.contains('hidden')) renderActivity();
}
function renderActivity() {
  const items = db().log.slice(0, 25);
  $('#activity').innerHTML = `<div class="popover-head">Actividad reciente <span class="xs muted">${items.length} eventos</span></div>
    ${items.map(l => `<div class="log-item from-${l.origen}">
      <span class="ico-box">${icon(l.origen === 'cliente' ? 'user' : l.origen === 'web' ? 'globe' : l.tipo === 'cita' ? 'calendar' : 'wrench')}</span>
      <div><div>${esc(l.texto)}</div><div class="when">${fmtAgo(l.fecha)} · ${l.origen === 'cliente' ? 'Cliente' : l.origen === 'web' ? 'Web' : 'Taller'}</div></div>
    </div>`).join('')}`;
}
function notifyRemote() {
  const nuevos = db().log.filter(l => !state.knownLog.has(l.id));
  nuevos.reverse().forEach(l => {
    state.knownLog.add(l.id);
    if (l.origen === 'taller') return;
    if (l.ordenId) { state.flash.add(l.ordenId); setTimeout(() => state.flash.delete(l.ordenId), 2000); }
    const aprobado = /APROBADO/.test(l.texto);
    toast(l.origen === 'web' ? 'Nueva cita desde la web' : aprobado ? '¡Presupuesto aprobado!' : 'Actividad del cliente', l.texto.replace('APROBADO', 'aprobado'), aprobado || l.origen === 'web' ? 'ok' : 'warn');
  });
}

/* ---------- Eventos de la vista ---------- */
function bindView() {
  const view = $('#view');
  $$('[data-goto]', view).forEach(b => b.addEventListener('click', () => setView(b.dataset.goto)));
  $$('[data-open]', view).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openOrder(b.dataset.open); }));
  $$('[data-copy]', view).forEach(b => b.addEventListener('click', () => copiar(b.dataset.copy)));

  if (state.view === 'tablero') {
    const search = $('#boardSearch');
    search.addEventListener('input', () => {
      state.busqueda = search.value;
      const pos = search.selectionStart;
      render();
      const s2 = $('#boardSearch'); s2.focus(); s2.setSelectionRange(pos, pos);
    });
    $$('[data-mec]', view).forEach(b => b.addEventListener('click', () => { state.filtroMec = b.dataset.mec; render(); }));
    $$('[data-next]', view).forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const o = getOrden(b.dataset.next);
      const n = o.estado === 'diagnostico' ? 'presupuesto' : siguiente(o);
      if (o.estado === 'presupuesto' && o.presupuesto && o.presupuesto.estado === 'pendiente') {
        responderPresupuesto(o, true, 'taller');
        toast('Presupuesto aprobado por teléfono', `${o.id} pasa a reparación`, 'ok');
      } else moverOrden(o, n);
    }));
    $$('.job', view).forEach(card => {
      card.addEventListener('dblclick', () => openOrder(card.dataset.id));
      card.addEventListener('keydown', e => { if (e.key === 'Enter') openOrder(card.dataset.id); });
      card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', card.dataset.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    $$('.col', view).forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop-on'); });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop-on'); });
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('drop-on');
        const o = getOrden(e.dataTransfer.getData('text/plain'));
        moverOrden(o, col.dataset.col);
      });
    });
  }

  if (state.view === 'agenda') {
    const form = $('#citaForm');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      if (!f.nombre.trim() || digits(f.telefono).length < 9 || normPlate(f.matricula).length < 4 || !f.fecha) { toast('Revisa los datos de la cita', 'Nombre, teléfono (9 cifras), matrícula y fecha', 'warn'); return; }
      crearCita({ fecha: new Date(f.fecha).toISOString(), nombre: f.nombre.trim(), telefono: digits(f.telefono), matricula: normPlate(f.matricula), servicio: f.servicio, nota: f.nota.trim(), estado: 'confirmada' }, 'telefono');
      toast('Cita guardada', fmtWhen(new Date(f.fecha).toISOString()), 'ok');
    });
    $$('[data-confirm]', view).forEach(a => a.addEventListener('click', () => {
      const c = db().citas.find(x => x.id === a.dataset.confirm);
      if (c && c.estado === 'pendiente') { c.estado = 'confirmada'; Store.save(); }
    }));
    $$('[data-cancel]', view).forEach(b => b.addEventListener('click', () => {
      const c = db().citas.find(x => x.id === b.dataset.cancel);
      if (c && confirm(`¿Cancelar la cita de ${c.nombre}?`)) { c.estado = 'cancelada'; Store.save(); toast('Cita cancelada', c.nombre, 'warn'); }
    }));
    $$('[data-recep]', view).forEach(b => b.addEventListener('click', () => {
      const c = db().citas.find(x => x.id === b.dataset.recep);
      state.prefill = { citaId: c.id, matricula: c.matricula, nombre: c.nombre, telefono: c.telefono, servicio: c.servicio, motivo: c.servicio + (c.nota ? '. ' + c.nota : '') };
      state.creada = null;
      setView('nueva');
    }));
  }

  if (state.view === 'clientes') {
    const s = $('#cliSearch');
    s.addEventListener('input', () => {
      state.busquedaCli = s.value; state.clienteSel = null;
      const pos = s.selectionStart;
      render();
      const s2 = $('#cliSearch'); s2.focus(); s2.setSelectionRange(pos, pos);
    });
    $$('[data-cli]', view).forEach(b => b.addEventListener('click', () => { state.clienteSel = b.dataset.cli; render(); }));
  }

  if (state.view === 'nueva' && !state.creada) {
    const form = $('#newForm');
    form.matricula.addEventListener('input', () => rellenarConocido(form));
    if (form.matricula.value) rellenarConocido(form);
    form.addEventListener('submit', e => { e.preventDefault(); crearOrden(form); });
    const clr = $('[data-clear-prefill]', view);
    if (clr) clr.addEventListener('click', () => { state.prefill = null; setView('agenda'); });
  }
}

function tickClock() {
  const el = $('#clock');
  if (el) el.textContent = new Date().toLocaleString(CONFIG.locale, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

document.addEventListener('DOMContentLoaded', () => {
  Store.load();
  renderDemoBar('taller');
  applyConfig();
  hydrateIcons();
  state.seen = new Set(db().log.filter(l => l.origen === 'taller' || new Date(l.fecha) < Date.now() - 3600e3).map(l => l.id));
  state.knownLog = new Set(db().log.map(l => l.id));
  state.view = VIEWS.some(v => v.id === location.hash.slice(1)) ? location.hash.slice(1) : 'tablero';

  $('[data-goto="nueva"]').addEventListener('click', () => { state.creada = null; setView('nueva'); });
  $('#bellBtn').addEventListener('click', e => {
    e.stopPropagation();
    const pop = $('#activity');
    const open = pop.classList.toggle('hidden') === false;
    $('#bellBtn').setAttribute('aria-expanded', open);
    if (open) { renderActivity(); db().log.forEach(l => state.seen.add(l.id)); renderBell(); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.bell')) $('#activity').classList.add('hidden'); });
  $('#orderDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#orderDialog').addEventListener('close', () => { state.openId = null; });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h !== state.view) setView(h); });

  Store.on(src => {
    if (src === 'remote') {
      notifyRemote();
      render();
      if (state.openId && $('#orderDialog').open) renderOrder();
    } else {
      db().log.forEach(l => state.knownLog.add(l.id));
      render();
    }
  });

  render();
  tickClock();
  setInterval(tickClock, 30000);
  setInterval(() => { if (!$('#orderDialog').open) render(); }, 60000);
});
