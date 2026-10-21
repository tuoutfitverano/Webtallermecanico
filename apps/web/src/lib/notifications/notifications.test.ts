/**
 * Pruebas de las notificaciones por email.
 * ⚠ SIMULADAS: el proveedor (fetch) y la base de datos son dobles de prueba.
 * Aquí no se envía ningún email real.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { REPAIR_STATUS_CUSTOMER_TEXT } from '@talleres/core';
import { createResendSender, outcomeFromResend } from './resend.ts';
import { renderEmail, type ClaimedNotification } from './templates.ts';
import { dispatchEmails, type DispatchDeps } from './dispatcher.ts';
import { parseResendEvent, signSvix, verifySvix } from './webhook.ts';
import { bearerMatches } from './auth.ts';
import type { ChannelSender, OutgoingMessage, SendOutcome } from './types.ts';

const N: ClaimedNotification = {
  id: '11111111-2222-3333-4444-555555555555', workshop_id: 'w1', workshop_name: 'Taller <Demo> & Cía', reply_to: 'taller@ejemplo.test',
  order_id: 'o1', event: 'listo', template: 'reparacion_estado_v1', title: 'Tu vehículo está listo para recoger',
  body: 'Seat León · OR-12\nTu vehículo está listo.\n\nMensaje del taller: <b>Ven</b> a las 17:00', recipient: 'cliente@ejemplo.test', attempts: 1,
};

describe('Texto para el cliente sincronizado entre core y la base de datos', () => {
  it('cada texto de estado de packages/core está igual en la migración', () => {
    const sql = readFileSync(new URL('../../../../../supabase/migrations/20261023090000_notificaciones.sql', import.meta.url), 'utf8');
    for (const text of Object.values(REPAIR_STATUS_CUSTOMER_TEXT)) expect(sql).toContain(`'${text}'`);
  });
});

describe('Plantilla del email', () => {
  it('asunto claro con el taller, HTML escapado y texto plano', () => {
    const e = renderEmail(N, 'https://app.ejemplo.test');
    expect(e.subject).toBe('Taller <Demo> & Cía: Tu vehículo está listo para recoger');
    expect(e.html).toContain('Taller &lt;Demo&gt; &amp; Cía');
    expect(e.html).toContain('&lt;b&gt;Ven&lt;/b&gt;');
    expect(e.html).not.toContain('<b>Ven</b>');
    expect(e.html).toContain('https://app.ejemplo.test/portal/reparaciones/o1');
    expect(e.text).toContain('Mensaje del taller: <b>Ven</b> a las 17:00');
    expect(e.text).toContain('dejar de recibir avisos');
  });

  it('sin dirección del portal no se inventa un enlace', () => {
    const e = renderEmail(N, null);
    expect(e.html).not.toContain('href=');
    expect(e.text).toContain('Puedes consultarlo en tu portal');
  });

  it('aviso_v1 lleva a la página indicada del portal, y solo a rutas del portal', () => {
    const q = renderEmail({ ...N, template: 'aviso_v1', title: 'Tienes un presupuesto', link_path: '/portal/presupuestos/q1' }, 'https://app.ejemplo.test');
    expect(q.html).toContain('https://app.ejemplo.test/portal/presupuestos/q1');
    expect(q.html).toContain('Abrir mi portal');
    for (const bad of ['https://otro.test/x', '/panel/ordenes', '/portal/../panel', '/portal/x?y=1']) {
      const e = renderEmail({ ...N, template: 'aviso_v1', order_id: null, link_path: bad }, 'https://app.ejemplo.test');
      expect(e.html).not.toContain('href=');
    }
  });

  it('el asunto no admite saltos de línea (cabeceras)', () => {
    expect(renderEmail({ ...N, title: 'Hola\r\nBcc: x@y.z' }, null).subject).not.toMatch(/[\r\n]/);
  });
});

describe('Resend (fetch simulado)', () => {
  const msg: OutgoingMessage = { id: N.id, to: 'cliente@ejemplo.test', subject: 'S', html: '<p>h</p>', text: 't', fromName: 'Taller "Demo" <x>', replyTo: 'taller@ejemplo.test' };

  it('envía al endpoint documentado con clave, idempotencia y remitente del taller', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    const out = await createResendSender({ apiKey: 're_test', fromAddress: 'avisos@ejemplo.test', fetchImpl }).send(msg);
    expect(out).toEqual({ kind: 'aceptado', messageId: 'msg_1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer re_test');
    expect(headers['idempotency-key']).toBe(N.id);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ from: '"Taller Demo x" <avisos@ejemplo.test>', to: ['cliente@ejemplo.test'], reply_to: 'taller@ejemplo.test', text: 't' });
  });

  it('distingue errores temporales y definitivos', () => {
    expect(outcomeFromResend(429, '')).toEqual({ kind: 'temporal', code: 'limite_proveedor' });
    expect(outcomeFromResend(503, '')).toEqual({ kind: 'temporal', code: 'no_disponible' });
    expect(outcomeFromResend(401, '')).toEqual({ kind: 'temporal', code: 'credenciales' });
    expect(outcomeFromResend(422, '{"message":"Invalid `to` field"}')).toEqual({ kind: 'permanente', code: 'rechazado' });
    expect(outcomeFromResend(409, '')).toEqual({ kind: 'permanente', code: 'conflicto' });
    expect(outcomeFromResend(200, 'no-json')).toEqual({ kind: 'aceptado', messageId: '' });
  });

  it('tiempo agotado o red caída → temporal (se reintentará)', async () => {
    const slow: typeof fetch = (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))));
    expect(await createResendSender({ apiKey: 'k', fromAddress: 'a@b.es', fetchImpl: slow, timeoutMs: 20 }).send(msg)).toEqual({ kind: 'temporal', code: 'no_disponible' });
  });
});

// ---------------------------------------------------------------- despachador
function fakeSender(outcomes: SendOutcome[] | (() => Promise<SendOutcome>)): ChannelSender & { sent: OutgoingMessage[] } {
  const sent: OutgoingMessage[] = [];
  return {
    id: 'simulado', sent,
    async send(m) { sent.push(m); return typeof outcomes === 'function' ? outcomes() : outcomes.shift() ?? { kind: 'temporal', code: 'error' }; },
  };
}
function deps(over: Partial<DispatchDeps> = {}): DispatchDeps & { recorded: unknown[]; logs: string[] } {
  const recorded: unknown[] = [];
  const logs: string[] = [];
  return {
    sender: fakeSender([{ kind: 'aceptado', messageId: 'm1' }]),
    claim: async () => ({ data: [N], error: null }),
    record: async (...args) => { recorded.push(args); return { error: null }; },
    portalOrigin: 'https://app.ejemplo.test',
    log: (e, meta) => logs.push(`${e} ${JSON.stringify(meta ?? {})}`),
    recorded, logs,
    ...over,
  };
}

describe('Despachador', () => {
  it('sin proveedor configurado no reclama nada ni da nada por enviado', async () => {
    const claim = vi.fn();
    const r = await dispatchEmails(deps({ sender: null, claim }));
    expect(r).toMatchObject({ configured: false, claimed: 0, accepted: 0 });
    expect(claim).not.toHaveBeenCalled();
  });

  it('envía y anota "aceptado" (no "entregado")', async () => {
    const d = deps();
    const r = await dispatchEmails(d);
    expect(r).toMatchObject({ configured: true, claimed: 1, accepted: 1 });
    expect(d.recorded).toEqual([[N.id, { kind: 'aceptado', messageId: 'm1' }, 'simulado']]);
  });

  it('un fallo del proveedor queda registrado para reintentar', async () => {
    const d = deps({ sender: fakeSender([{ kind: 'temporal', code: 'no_disponible' }]) });
    expect(await dispatchEmails(d)).toMatchObject({ retrying: 1, accepted: 0 });
    expect(d.recorded).toEqual([[N.id, { kind: 'temporal', code: 'no_disponible' }, 'simulado']]);
  });

  it('una excepción inesperada no se pierde: cuenta como temporal', async () => {
    const d = deps({ sender: fakeSender(() => Promise.reject(new Error('boom'))) });
    expect(await dispatchEmails(d)).toMatchObject({ retrying: 1 });
  });

  it('una plantilla desconocida no se envía', async () => {
    const sender = fakeSender([{ kind: 'aceptado', messageId: 'x' }]);
    const d = deps({ sender, claim: async () => ({ data: [{ ...N, template: 'otra' }], error: null }) });
    expect(await dispatchEmails(d)).toMatchObject({ failed: 1 });
    expect(sender.sent).toHaveLength(0);
  });

  it('el lote está limitado (nada de bucles sin fin)', async () => {
    const claim = vi.fn(async () => ({ data: [], error: null }));
    await dispatchEmails(deps({ claim }), { limit: 5000 });
    expect(claim).toHaveBeenCalledWith({ limit: 50, orderId: null });
  });

  it('los registros no llevan direcciones ni contenidos', async () => {
    const d = deps();
    await dispatchEmails(d);
    expect(d.logs.join(' ')).not.toMatch(/@|León|listo/);
  });
});

describe('Webhook firmado (Svix)', () => {
  const secret = `whsec_${btoa('clave-de-prueba-de-32-caracteres!')}`;
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'msg_1' } });
  const now = 1_800_000_000;

  it('acepta una firma válida y reciente', async () => {
    const sig = await signSvix(secret, 'msg_a', String(now), body);
    expect(await verifySvix(secret, { id: 'msg_a', timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(true);
    // También con varias firmas (rotación de secreto).
    expect(await verifySvix(secret, { id: 'msg_a', timestamp: String(now), signature: `v1,otra v1,${sig}` }, body, now)).toBe(true);
  });

  it('rechaza firmas falsas, cuerpos alterados, envíos antiguos y cabeceras ausentes', async () => {
    const sig = await signSvix(secret, 'msg_a', String(now), body);
    expect(await verifySvix(secret, { id: 'msg_a', timestamp: String(now), signature: 'v1,falsa' }, body, now)).toBe(false);
    expect(await verifySvix(secret, { id: 'msg_a', timestamp: String(now), signature: `v1,${sig}` }, body.replace('msg_1', 'msg_2'), now)).toBe(false);
    expect(await verifySvix(secret, { id: 'msg_a', timestamp: String(now - 600), signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvix(secret, { id: null, timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvix('', { id: 'msg_a', timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(false);
  });

  it('traduce los eventos que importan e ignora el resto', () => {
    expect(parseResendEvent({ type: 'email.delivered', data: { email_id: 'm' } })).toEqual({ messageId: 'm', outcome: 'entregado' });
    expect(parseResendEvent({ type: 'email.bounced', data: { email_id: 'm' } })).toEqual({ messageId: 'm', outcome: 'rebotado' });
    expect(parseResendEvent({ type: 'email.complained', data: { email_id: 'm' } })).toEqual({ messageId: 'm', outcome: 'queja' });
    expect(parseResendEvent({ type: 'email.opened', data: { email_id: 'm' } })).toBeNull();
    expect(parseResendEvent({ type: 'email.delivered', data: {} })).toBeNull();
    expect(parseResendEvent('x')).toBeNull();
  });
});

describe('Endpoint programado', () => {
  it('exige exactamente el secreto', () => {
    expect(bearerMatches('Bearer secreto-largo-de-prueba-123456', 'secreto-largo-de-prueba-123456')).toBe(true);
    expect(bearerMatches('Bearer secreto-largo-de-prueba-123457', 'secreto-largo-de-prueba-123456')).toBe(false);
    expect(bearerMatches('secreto-largo-de-prueba-123456', 'secreto-largo-de-prueba-123456')).toBe(false);
    expect(bearerMatches(null, 'x')).toBe(false);
    expect(bearerMatches('Bearer ', '')).toBe(false);
  });
});
