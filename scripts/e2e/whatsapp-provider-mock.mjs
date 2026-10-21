#!/usr/bin/env node
/**
 * ⚠ WHATSAPP SIMULADO — SOLO PARA PRUEBAS AUTOMÁTICAS.
 *
 * Imita POST /{versión}/{phone_number_id}/messages de la API de WhatsApp
 * Business (Cloud API de Meta) para probar el código real de envío sin mandar
 * mensajes. Nada sale de este ordenador.
 *
 *   número que empieza por "34699" → 400 (número sin WhatsApp: rechazo definitivo)
 *   número que empieza por "34698" → 503 (error pasajero)
 *   GET /__whatsapp?to=X → mensajes "enviados" a X (el más reciente primero)
 *
 * Uso: node whatsapp-provider-mock.mjs <puerto> <token>
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const [port = '4996', token = 'token'] = process.argv.slice(2);
const sent = [];

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && url.pathname === '/__whatsapp') {
    const to = url.searchParams.get('to') ?? '';
    return send(200, sent.filter(m => m.to === to).reverse());
  }
  if (req.method !== 'POST' || !/^\/v[0-9.]+\/[0-9]+\/messages$/.test(url.pathname)) return send(404, { error: { message: 'Unknown path', code: 100 } });
  if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: { message: 'Invalid OAuth access token', code: 190 } });
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { error: { message: 'Invalid JSON', code: 100 } }); }
    const to = String(body.to ?? '');
    if (body.messaging_product !== 'whatsapp' || body.type !== 'template' || !body.template?.name) return send(400, { error: { message: 'Invalid parameter', code: 100 } });
    const params = (body.template.components?.[0]?.parameters ?? []).map(p => p.text);
    if (params.some(p => /[\n\t]| {5,}/.test(p))) return send(400, { error: { message: 'Param text cannot have new-line/tab characters or more than 4 consecutive spaces', code: 132018 } });
    if (to.startsWith('34699')) return send(400, { error: { message: 'Message undeliverable', code: 131026 } });
    if (to.startsWith('34698')) return send(503, { error: { message: 'Service unavailable', code: 131000 } });
    const id = `wamid.${randomUUID()}`;
    sent.push({ id, to, template: body.template.name, language: body.template.language?.code ?? null, params, ref: body.biz_opaque_callback_data ?? null });
    return send(200, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id }] });
  });
}).listen(Number(port), '127.0.0.1');
