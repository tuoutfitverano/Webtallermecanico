/**
 * Pruebas del canal WhatsApp.
 * ⚠ SIMULADAS: Meta (fetch) y la base de datos son dobles de prueba.
 * Aquí no se envía ningún WhatsApp real.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createMetaWhatsappSender, dispatchWhatsapp, metaChallenge, outcomeFromMeta, parseMetaStatuses, signMeta,
  templateParam, verifyMetaSignature, whatsappParams, type ClaimedWhatsapp, type WhatsappDispatchDeps, type WhatsappSender,
} from './whatsapp.ts';
import type { SendOutcome } from './types.ts';

const N: ClaimedWhatsapp = {
  id: '11111111-2222-3333-4444-555555555555', workshop_id: 'w1', workshop_name: 'Taller Demo', order_id: 'o1', event: 'listo',
  template: 'reparacion_estado_v1', title: 'Tu vehículo está listo para recoger',
  body: 'Seat León · OR-12\nTu vehículo está listo.\n\nMensaje del taller:    ven a las 17:00', recipient: '34600000001', attempts: 1,
};

describe('Parámetros de la plantilla', () => {
  it('sin saltos de línea ni espacios repetidos (Meta los rechaza)', () => {
    const [taller, titulo, detalle] = whatsappParams(N);
    expect(taller).toBe('Taller Demo');
    expect(titulo).toBe('Tu vehículo está listo para recoger');
    expect(detalle).toBe('Seat León · OR-12 · Tu vehículo está listo. · Mensaje del taller: ven a las 17:00');
    expect(detalle).not.toMatch(/\n|\t| {2,}/);
  });
  it('recorta los textos largos y nunca deja un parámetro vacío', () => {
    expect(templateParam('x'.repeat(800), 700)).toHaveLength(700);
    expect(templateParam('   ', 10)).toBe('—');
  });
});

describe('Envío con la API de WhatsApp Business (simulada)', () => {
  it('manda la plantilla aprobada al número, con el token solo en la cabecera', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.ABC' }] }), { status: 200 }));
    const sender = createMetaWhatsappSender({ token: 'tok', phoneNumberId: '123456', baseUrl: 'https://meta.test/v21.0', fetchImpl });
    const out = await sender.send({ id: N.id, to: N.recipient, params: whatsappParams(N) });
    expect(out).toEqual({ kind: 'aceptado', messageId: 'wamid.ABC' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://meta.test/v21.0/123456/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '34600000001', type: 'template', biz_opaque_callback_data: N.id });
    expect(body.template.name).toBe('reparacion_estado_v1');
    expect(body.template.language.code).toBe('es');
    expect(body.template.components[0].parameters).toHaveLength(3);
    expect(String(init.body)).not.toContain('tok');
  });
  it('sin conexión → reintento', async () => {
    const sender = createMetaWhatsappSender({ token: 't', phoneNumberId: '1', fetchImpl: async () => { throw new Error('red'); } });
    expect(await sender.send({ id: 'a', to: '34600000001', params: ['a', 'b', 'c'] })).toEqual({ kind: 'temporal', code: 'no_disponible' });
  });
  it('traduce las respuestas de Meta', () => {
    expect(outcomeFromMeta(200, JSON.stringify({ messages: [{ id: 'wamid.HBgLMzQ2MDAwMDAwMDAVAgARGBI' }] }))).toEqual({ kind: 'aceptado', messageId: 'wamid.HBgLMzQ2MDAwMDAwMDAVAgARGBI' });
    // 2xx sin identificador (auditoría H01): no se da por enviado ni se reintenta solo (Meta no tiene idempotencia).
    for (const body of ['{}', 'sin JSON', '', '{"messages":[]}', '{"messages":[{"id":""}]}', '{"messages":[{"id":7}]}']) {
      expect(outcomeFromMeta(200, body)).toEqual({ kind: 'permanente', code: 'sin_confirmacion' });
    }
    expect(outcomeFromMeta(429, '')).toEqual({ kind: 'temporal', code: 'limite_proveedor' });
    expect(outcomeFromMeta(400, JSON.stringify({ error: { code: 131056 } }))).toEqual({ kind: 'temporal', code: 'limite_proveedor' });
    expect(outcomeFromMeta(401, JSON.stringify({ error: { code: 190 } }))).toEqual({ kind: 'temporal', code: 'credenciales' });
    expect(outcomeFromMeta(400, JSON.stringify({ error: { code: 132001 } }))).toEqual({ kind: 'permanente', code: 'rechazado' });
    expect(outcomeFromMeta(503, '')).toEqual({ kind: 'temporal', code: 'no_disponible' });
  });
});

function deps(over: Partial<WhatsappDispatchDeps> = {}): WhatsappDispatchDeps & { recorded: [string, SendOutcome][] } {
  const recorded: [string, SendOutcome][] = [];
  return {
    recorded,
    sender: { id: 'meta', send: async () => ({ kind: 'aceptado', messageId: 'wamid.1' }) },
    claim: async () => ({ data: [N], error: null }),
    record: async (id, outcome) => { recorded.push([id, outcome]); return { error: null }; },
    log: () => {},
    ...over,
  };
}

describe('Despachador de WhatsApp', () => {
  it('sin proveedor no reclama nada (los avisos siguen pendientes)', async () => {
    const claim = vi.fn();
    const s = await dispatchWhatsapp(deps({ sender: null, claim }));
    expect(s.configured).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });
  it('envía y anota lo que dice el proveedor', async () => {
    const d = deps();
    const s = await dispatchWhatsapp(d);
    expect(s).toMatchObject({ claimed: 1, accepted: 1 });
    expect(d.recorded).toEqual([[N.id, { kind: 'aceptado', messageId: 'wamid.1' }]]);
  });
  it('no envía con una plantilla desconocida o un número raro', async () => {
    const send = vi.fn();
    const sender: WhatsappSender = { id: 'meta', send };
    const d = deps({ sender, claim: async () => ({ data: [{ ...N, template: 'otra' }, { ...N, id: 'b', recipient: '+34 600' }], error: null }) });
    const s = await dispatchWhatsapp(d);
    expect(send).not.toHaveBeenCalled();
    expect(s.failed).toBe(2);
  });
  it('un fallo del proveedor queda para reintentar', async () => {
    const d = deps({ sender: { id: 'meta', send: async () => { throw new Error('x'); } } });
    expect((await dispatchWhatsapp(d)).retrying).toBe(1);
  });
});

describe('Webhook de Meta', () => {
  const secret = 'secreto-de-la-app-de-prueba';
  const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.1', status: 'sent' }, { id: 'wamid.1', status: 'delivered' }, { id: 'wamid.2', status: 'read' }, { id: 'wamid.3', status: 'failed' },
  ] } }] }] });

  it('acepta solo la firma correcta del cuerpo exacto', async () => {
    const sig = await signMeta(secret, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(await verifyMetaSignature(secret, sig, body)).toBe(true);
    expect(await verifyMetaSignature(secret, sig, body.replace('wamid.1', 'wamid.9'))).toBe(false);
    expect(await verifyMetaSignature('otro', sig, body)).toBe(false);
    expect(await verifyMetaSignature(secret, null, body)).toBe(false);
    expect(await verifyMetaSignature('', sig, body)).toBe(false);
  });
  it('traduce entregado, leído y fallido; ignora «enviado» y lo demás', () => {
    expect(parseMetaStatuses(JSON.parse(body))).toEqual([
      { messageId: 'wamid.1', outcome: 'entregado' }, { messageId: 'wamid.2', outcome: 'leido' }, { messageId: 'wamid.3', outcome: 'fallido' },
    ]);
    expect(parseMetaStatuses({ entry: [{ changes: [{ value: { messages: [{ text: 'hola' }] } }] }] })).toEqual([]);
    expect(parseMetaStatuses('x')).toEqual([]);
  });
  it('alta del webhook: solo con el token de verificación correcto', () => {
    const p = (o: Record<string, string>) => new URLSearchParams(o);
    expect(metaChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mi-token', 'hub.challenge': '12345' }), 'mi-token')).toBe('12345');
    expect(metaChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '12345' }), 'mi-token')).toBeNull();
    expect(metaChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': 'mi-token', 'hub.challenge': '<script>' }), 'mi-token')).toBeNull();
    expect(metaChallenge(p({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), '')).toBeNull();
  });
});
