/* Portal del cliente: estado del vehículo, presupuestos, historial y vehículos */
'use strict';

const SESSION_KEY = 'tallerdemo:sesion';
const DAY_MS = 864e5;
let me = null;
let tab = 'estado';
let filtroVehiculo = 'todos';
let seenLog = new Set();

const DEMO_USERS = [
  { m: '1234KLM', c: '2580', who: 'Laura', what: 'presupuesto pendiente de aprobar' },
  { m: '5678BCD', c: '1111', who: 'Carlos', what: 'coche en reparación' },
  { m: '7788LCV', c: '7272', who: 'Lucía', what: 'coche listo para recoger' },
];

function login(matricula, codigo) {
  const v = vehiculoPorMatricula(matricula);
  const c = v && getCliente(v.clienteId);
  if (!c || String(c.codigo) !== String(codigo).trim()) return false;
  me = c.id;
  safeSet(sessionStorage, SESSION_KEY, me);
  markSeen();
  return true;
}
function logout() { me = null; safeDel(sessionStorage, SESSION_KEY); tab = 'estado'; render(); }
function markSeen() { seenLog = new Set(db().log.map(l => l.id)); }

/* ---------- Render ---------- */
function render() {
  const app = $('#app');
  const right = $('#headerRight');
  if (!me || !getCliente(me)) {
    right.innerHTML = `<a class="btn btn-sm btn-ghost" href="index.html">Volver a la web</a>`;
    app.innerHTML = loginHtml();
    bindLogin();
  } else {
    const c = getCliente(me);
    right.innerHTML = `<span class="small muted hide-sm">${esc(c.nombre)}</span><button class="btn btn-sm" id="logoutBtn">${icon('logout')}<span>Salir</span></button>`;
    $('#logoutBtn').addEventListener('click', logout);
    app.innerHTML = dashboardHtml(c);
    bindDashboard();
  }
  hydrateIcons();
}

function loginHtml() {
  return `
  <div class="login-wrap">
    <form class="login card" id="loginForm" autocomplete="off">
      <span class="brand-mark">${icon('car')}</span>
      <h1>Consulta tu vehículo</h1>
      <p class="muted">Introduce la matrícula y el código de cliente que te dimos al dejar el coche.</p>
      <div class="stack" style="margin-top:22px">
        <label class="field"><span>Matrícula</span><input class="input input-plate" name="m" placeholder="1234 ABC" required></label>
        <label class="field"><span>Código de cliente</span><input class="input" name="c" placeholder="4 cifras" inputmode="numeric" maxlength="6" required></label>
        <p class="form-error hidden" id="loginError">Matrícula o código incorrectos. Revisa los datos o llámanos.</p>
        <button class="btn btn-primary btn-lg btn-block" type="submit">Entrar ${icon('arrow')}</button>
      </div>
      <div class="demo-hint">
        <b>Accesos de demostración</b>
        <div class="stack" style="gap:6px;margin-top:8px">
          ${DEMO_USERS.map(u => `<button type="button" class="btn btn-sm btn-block" data-demo="${u.m}|${u.c}" style="justify-content:space-between"><span>${esc(u.who)} · <span class="muted">${esc(u.what)}</span></span><span class="muted">${fmtPlate(u.m)} / ${u.c}</span></button>`).join('')}
        </div>
      </div>
    </form>
  </div>`;
}

function bindLogin() {
  const form = $('#loginForm');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(form);
    if (login(f.get('m'), f.get('c'))) render();
    else $('#loginError').classList.remove('hidden');
  });
  $$('[data-demo]').forEach(b => b.addEventListener('click', () => {
    const [m, c] = b.dataset.demo.split('|');
    form.m.value = fmtPlate(m); form.c.value = c;
    if (login(m, c)) render();
  }));
}

function dashboardHtml(c) {
  const ordenes = ordenesDeCliente(c.id);
  const activas = ordenes.filter(o => o.estado !== 'entregado');
  const historial = ordenes.filter(o => o.estado === 'entregado');
  const pendientes = activas.filter(o => o.presupuesto && o.presupuesto.estado === 'pendiente').length;
  const vs = vehiculosDe(c.id);
  const avisos = vs.filter(v => avisosVehiculo(v).some(a => a.level !== 'ok')).length;

  let body = '';
  if (tab === 'estado') body = activas.length ? activas.map(orderCardHtml).join('') : emptyActive();
  if (tab === 'historial') body = historialHtml(historial, vs);
  if (tab === 'vehiculos') body = `<div class="vehicles">${vs.map(vehicleHtml).join('')}</div>`;

  const sub = activas.length
    ? `Tienes ${activas.length === 1 ? '1 vehículo' : activas.length + ' vehículos'} en el taller${pendientes ? ` · <b style="color:var(--warn)">${pendientes} presupuesto pendiente</b>` : ''}`
    : 'Ahora mismo no tienes vehículos en el taller';

  return `
  <div class="app-main"><div class="wrap">
    <div class="page-title">
      <div class="greeting"><span class="avatar">${initials(c.nombre)}</span><div><h1>Hola, ${esc(c.nombre.split(' ')[0])}</h1><p class="muted">${sub}</p></div></div>
      <a class="btn btn-wa" href="${waLink(CONFIG.whatsapp, `Hola, soy ${c.nombre}. Tengo una consulta sobre mi vehículo.`)}" target="_blank" rel="noopener">${icon('chat')} Hablar con el taller</a>
    </div>
    <nav class="tabs" style="margin-bottom:20px" role="tablist">
      <button class="tab ${tab === 'estado' ? 'is-on' : ''}" data-tab="estado">${icon('gauge')} Estado actual ${activas.length ? `<span class="count">${activas.length}</span>` : ''}</button>
      <button class="tab ${tab === 'historial' ? 'is-on' : ''}" data-tab="historial">${icon('history')} Historial</button>
      <button class="tab ${tab === 'vehiculos' ? 'is-on' : ''}" data-tab="vehiculos">${icon('car')} Mis vehículos ${avisos ? `<span class="count">${avisos}</span>` : ''}</button>
    </nav>
    <div class="stack" style="gap:20px">${body}</div>
  </div></div>`;
}

function emptyActive() {
  return `<div class="empty">${icon('checkCircle')}<b style="color:var(--ink)">Todo en orden</b><p>No tienes ningún vehículo en el taller. Cuando lo traigas, aquí verás cada paso de la reparación.</p>
    <div class="hero-actions" style="justify-content:center;margin-top:16px"><a class="btn btn-primary" href="index.html#cita">${icon('calendar')} Pedir cita</a><button class="btn" data-tab="historial">Ver historial</button></div></div>`;
}

function orderCardHtml(o) {
  const v = getVehiculo(o.vehiculoId);
  const mec = getMecanico(o.mecanicoId);
  const last = o.eventos[o.eventos.length - 1];
  const e = ESTADO[o.estado];
  const ringIcon = { recibido: 'car', diagnostico: 'search', presupuesto: 'clipboard', reparacion: 'wrench', calidad: 'shield', listo: 'checkCircle' }[o.estado] || 'car';
  const ready = o.estado === 'listo'
    ? `<div class="ready-banner">${icon('checkCircle')}<div><b>¡Tu vehículo está listo!</b><br><span class="small">Puedes pasar a recogerlo · ${esc(CONFIG.horario)}</span></div></div>` : '';

  return `
  <article class="card order-card st st-${o.estado}">
    ${ready}
    <div class="order-head">
      <div>
        <div class="row">${plateHtml(v.matricula)}<span class="xs muted">Orden ${esc(o.id)}</span></div>
        <h2>${esc(nombreVehiculo(v))}</h2>
        <div class="status-big"><span class="ring">${icon(ringIcon)}</span><div><b>${e.label}</b><span class="small muted">${esc(e.cliente)}</span></div></div>
      </div>
      <div class="small muted" style="text-align:right">Última actualización<br><b style="color:var(--ink)">${fmtAgo(last.fecha)}</b></div>
      <div style="grid-column:1/-1">${stepperHtml(o)}</div>
    </div>
    <div class="order-body">
      <div>
        <div class="facts">
          <div class="fact"><small>Entrada</small><b>${fmtWhen(o.entrada)}</b></div>
          <div class="fact"><small>Entrega prevista</small><b>${o.estado === 'listo' ? 'Ya disponible' : fmtWhen(o.prevista)}</b></div>
          <div class="fact"><small>Mecánico</small><b>${esc(mec ? mec.nombre.split(' ')[0] : '—')}</b></div>
        </div>
        <div class="stack">
          <div><span class="label">Motivo de la visita</span><p>${esc(o.motivo)}</p></div>
          ${o.diagnostico ? `<div><span class="label">Diagnóstico</span><p>${esc(o.diagnostico)}</p></div>` : ''}
          ${budgetHtml(o)}
        </div>
      </div>
      <div>
        <h4 style="margin-bottom:14px">Seguimiento</h4>
        ${timelineHtml(o)}
      </div>
    </div>
  </article>`;
}

function budgetHtml(o) {
  const p = o.presupuesto;
  if (!p || !o.lineas.length) {
    if (['recibido', 'diagnostico'].includes(o.estado)) {
      return `<div class="alert alert-info">${icon('clock')}<span>Estamos revisando tu vehículo. En cuanto terminemos el diagnóstico te enviaremos el presupuesto aquí mismo para que lo apruebes.</span></div>`;
    }
    return '';
  }
  const t = totales(o);
  const badge = { pendiente: '<span class="badge badge-warn">Pendiente de tu aprobación</span>', aprobado: '<span class="badge badge-ok">Aprobado</span>', rechazado: '<span class="badge badge-bad">Rechazado</span>' }[p.estado];
  const actions = p.estado === 'pendiente' ? `
    <div class="budget-actions">
      <p>Revisa el presupuesto. Solo haremos los trabajos que apruebes.</p>
      <button class="btn" data-reject="${o.id}">Rechazar</button>
      <button class="btn btn-ok" data-approve="${o.id}">${icon('check')} Aprobar ${money(t.total)}</button>
    </div>` : p.respondido ? `<div class="small muted" style="padding:12px 16px;border-top:1px solid var(--line)">${p.estado === 'aprobado' ? 'Aprobado' : 'Respondido'} ${fmtWhen(p.respondido).toLowerCase()}</div>` : '';
  return `
  <div class="budget ${p.estado === 'pendiente' ? 'pending' : ''}">
    <div class="budget-head"><h4>Presupuesto</h4>${badge}</div>
    <table class="tbl">
      <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Importe</th></tr></thead>
      <tbody>
        ${o.lineas.map(l => `<tr><td>${esc(l.concepto)}<span class="tipo-tag">${l.tipo === 'mano' ? 'Mano de obra' : 'Recambio'}</span></td><td class="num">${fmtNum(l.cant)}${l.tipo === 'mano' ? ' h' : ''}</td><td class="num">${money(l.cant * l.precio)}</td></tr>`).join('')}
        <tr class="tot"><td colspan="2">Base imponible</td><td class="num">${money(t.base)}</td></tr>
        <tr><td colspan="2">IVA (${Math.round(CONFIG.iva * 100)} %)</td><td class="num">${money(t.iva)}</td></tr>
        <tr class="grand"><td colspan="2">Total</td><td class="num">${money(t.total)}</td></tr>
      </tbody>
    </table>
    ${actions}
  </div>`;
}

function timelineHtml(o) {
  const evs = o.eventos.slice().reverse();
  return `<ol class="timeline">${evs.map(ev => {
    const title = ev.tipo === 'nota' ? (ev.origen === 'cliente' ? 'Tu respuesta' : 'Mensaje del taller') : ESTADO[ev.estado].label;
    return `<li class="st st-${ev.estado}">
      <div class="t-time">${fmtWhen(ev.fecha)}</div>
      <div class="t-title">${esc(title)}</div>
      ${ev.nota ? `<div class="t-note">${esc(ev.nota)}</div>` : ''}
    </li>`;
  }).join('')}</ol>`;
}

function historialHtml(historial, vs) {
  const filtered = filtroVehiculo === 'todos' ? historial : historial.filter(o => o.vehiculoId === filtroVehiculo);
  const total = filtered.reduce((s, o) => s + totales(o).total, 0);
  const chips = vs.length > 1 ? `<div class="filter-chips">
      <button class="fchip ${filtroVehiculo === 'todos' ? 'is-on' : ''}" data-fv="todos">Todos</button>
      ${vs.map(v => `<button class="fchip ${filtroVehiculo === v.id ? 'is-on' : ''}" data-fv="${v.id}">${esc(v.marca)} ${esc(fmtPlate(v.matricula))}</button>`).join('')}
    </div>` : '<span></span>';
  if (!filtered.length) return `${chips}<div class="empty">${icon('history')}<p>Todavía no hay reparaciones terminadas.</p></div>`;
  return `
    <div class="row-between">${chips}<span class="small muted">${filtered.length} ${filtered.length === 1 ? 'visita' : 'visitas'} · ${money(total)}</span></div>
    <div class="history">
    ${filtered.map(o => {
      const v = getVehiculo(o.vehiculoId);
      const d = new Date(o.salida || o.entrada);
      return `<article class="card hist-item">
        <div class="hist-date"><b>${d.getDate()}</b><span>${d.toLocaleDateString(CONFIG.locale, { month: 'short' })} ${String(d.getFullYear()).slice(2)}</span></div>
        <div><h4>${esc(o.motivo)}</h4><span class="small muted">${esc(nombreVehiculo(v))} · ${esc(fmtPlate(v.matricula))} · ${fmtNum(o.km)} km · ${esc(o.id)}</span></div>
        <div class="hist-total"><b>${money(totales(o).total)}</b><button class="btn btn-sm btn-ghost" data-invoice="${o.id}">${icon('file')} Factura</button></div>
        <div class="hist-lines">${o.lineas.map(l => `<span class="chip">${esc(l.concepto)}</span>`).join('')}</div>
      </article>`;
    }).join('')}
    </div>`;
}

function avisosVehiculo(v) {
  const out = [];
  if (v.itv) {
    const days = Math.ceil((new Date(v.itv) - Date.now()) / DAY_MS);
    if (days < 0) out.push({ level: 'bad', text: `ITV caducada hace ${-days} ${-days === 1 ? 'día' : 'días'}. Te hacemos la pre-ITV para que pases a la primera.` });
    else if (days <= 30) out.push({ level: 'warn', text: `La ITV caduca en ${days} días (${fmtDate(v.itv)}).` });
    else out.push({ level: 'ok', text: `ITV en vigor hasta el ${fmtDate(v.itv)}.` });
  }
  if (v.proximaRevisionKm) {
    const left = v.proximaRevisionKm - v.km;
    if (left <= 0) out.push({ level: 'bad', text: `Revisión pasada por ${fmtNum(-left)} km.` });
    else if (left <= 3000) out.push({ level: 'warn', text: `Próxima revisión en ${fmtNum(left)} km.` });
  }
  return out;
}

function vehicleHtml(v) {
  const ords = ordenesDeVehiculo(v.id);
  const gastado = ords.filter(o => o.estado === 'entregado').reduce((s, o) => s + totales(o).total, 0);
  const enTaller = ords.find(o => o.estado !== 'entregado');
  const left = v.proximaRevisionKm - v.km;
  const pct = Math.max(4, Math.min(100, 100 - (left / 15000) * 100));
  const meterCls = left <= 0 ? 'bad' : left <= 3000 ? 'warn' : '';
  const avisos = avisosVehiculo(v);
  const necesitaCita = avisos.some(a => a.level !== 'ok');
  const servicio = avisos.some(a => a.level !== 'ok' && a.text.includes('ITV')) ? 'Pre-ITV' : 'Revisión y cambio de aceite';
  return `
  <article class="card vehicle">
    <div class="row-between">${plateHtml(v.matricula)}${enTaller ? estadoBadge(enTaller.estado) : ''}</div>
    <div><h3>${esc(nombreVehiculo(v))}</h3><span class="small muted">${esc(v.anio)} · ${esc(v.color || '')} · ${fmtNum(v.km)} km</span></div>
    <div>
      <div class="row-between small" style="margin-bottom:6px"><span class="muted">Próxima revisión</span><b>${fmtNum(v.proximaRevisionKm)} km</b></div>
      <div class="meter ${meterCls}"><i style="width:${pct}%"></i></div>
    </div>
    ${avisos.map(a => `<div class="alert alert-${a.level}">${icon(a.level === 'ok' ? 'checkCircle' : 'alert')}<span>${esc(a.text)}</span></div>`).join('')}
    <div class="row-between small"><span class="muted">${ords.length} ${ords.length === 1 ? 'visita' : 'visitas'} al taller</span><span class="muted">${money(gastado)} en mantenimiento</span></div>
    <div class="row" style="flex-wrap:wrap">
      <a class="btn btn-sm ${necesitaCita ? 'btn-primary' : ''}" href="index.html?matricula=${encodeURIComponent(v.matricula)}&servicio=${encodeURIComponent(servicio)}#cita">${icon('calendar')} Pedir cita</a>
      <button class="btn btn-sm btn-ghost" data-fv-go="${v.id}">${icon('history')} Ver historial</button>
    </div>
  </article>`;
}

/* ---------- Eventos ---------- */
function bindDashboard() {
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); window.scrollTo({ top: 0 }); }));
  $$('[data-fv]').forEach(b => b.addEventListener('click', () => { filtroVehiculo = b.dataset.fv; render(); }));
  $$('[data-fv-go]').forEach(b => b.addEventListener('click', () => { filtroVehiculo = b.dataset.fvGo; tab = 'historial'; render(); }));
  $$('[data-approve]').forEach(b => b.addEventListener('click', () => {
    const o = getOrden(b.dataset.approve);
    responderPresupuesto(o, true, 'cliente');
    markSeen();
    toast('¡Presupuesto aprobado!', 'El taller ya ha recibido tu aprobación y empieza la reparación.', 'ok');
  }));
  $$('[data-reject]').forEach(b => b.addEventListener('click', () => {
    if (!confirm('¿Seguro que quieres rechazar el presupuesto? El taller te llamará para buscar alternativas.')) return;
    responderPresupuesto(getOrden(b.dataset.reject), false, 'cliente');
    markSeen();
    toast('Presupuesto rechazado', 'Te llamaremos para comentarlo.', 'warn');
  }));
  $$('[data-invoice]').forEach(b => b.addEventListener('click', () => openInvoice(getOrden(b.dataset.invoice))));
}

function openInvoice(o) {
  const v = getVehiculo(o.vehiculoId), t = totales(o);
  $('#invoiceTitle').textContent = `Factura ${o.id}`;
  $('#invoiceBody').innerHTML = `
    <div class="row-between" style="margin-bottom:16px">
      <div><b>${esc(nombreVehiculo(v))}</b> ${plateHtml(v.matricula)}<br><span class="small muted">${fmtDate(o.salida)} · ${fmtNum(o.km)} km · ${esc(o.motivo)}</span></div>
      <button class="btn btn-dark btn-sm" id="printBtn">${icon('printer')} Imprimir / PDF</button>
    </div>
    <div class="budget"><table class="tbl">
      <thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead>
      <tbody>
        ${o.lineas.map(l => `<tr><td>${esc(l.concepto)}</td><td class="num">${fmtNum(l.cant)}</td><td class="num">${money(l.precio)}</td><td class="num">${money(l.cant * l.precio)}</td></tr>`).join('')}
        <tr class="tot"><td colspan="3">Base imponible</td><td class="num">${money(t.base)}</td></tr>
        <tr><td colspan="3">IVA (${Math.round(CONFIG.iva * 100)} %)</td><td class="num">${money(t.iva)}</td></tr>
        <tr class="grand"><td colspan="3">Total</td><td class="num">${money(t.total)}</td></tr>
      </tbody></table></div>`;
  $('#printBtn').addEventListener('click', () => imprimirDocumento(o, 'Factura'));
  $('#invoiceDialog').showModal();
}

/* Avisos en directo cuando el taller cambia algo */
function notifyRemote() {
  if (!me) return;
  const nuevos = db().log.filter(l => !seenLog.has(l.id) && l.clienteId === me && l.origen === 'taller');
  nuevos.reverse().forEach(l => {
    const o = l.ordenId && getOrden(l.ordenId);
    if (o && l.tipo === 'estado') toast(ESTADO[o.estado].cliente, etiquetaOrden(o), o.estado === 'listo' ? 'ok' : '');
    else if (o && l.tipo === 'presupuesto') {
      if (o.presupuesto && o.presupuesto.estado === 'pendiente') toast('Tienes un presupuesto nuevo', 'Revísalo y apruébalo desde aquí', 'warn');
      else toast('Presupuesto aprobado', 'Ya estamos trabajando en tu vehículo', 'ok');
    }
    else toast('Nuevo mensaje del taller', l.texto);
  });
  markSeen();
}

document.addEventListener('DOMContentLoaded', () => {
  Store.load();
  renderDemoBar('cliente');
  applyConfig();
  hydrateIcons();

  const p = new URLSearchParams(location.search);
  if (p.get('m') && p.get('c')) {
    if (!login(p.get('m'), p.get('c'))) setTimeout(() => { const e = $('#loginError'); if (e) e.classList.remove('hidden'); }, 0);
    history.replaceState(null, '', location.pathname);
  } else {
    me = safeGet(sessionStorage, SESSION_KEY);
    markSeen();
  }
  render();

  Store.on(src => { if (src === 'remote') notifyRemote(); render(); });
  $$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#invoiceDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  setInterval(render, 60000);
});
