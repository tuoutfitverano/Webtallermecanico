#!/usr/bin/env node
/**
 * ⚠ PROVEEDOR DE EMAIL SIMULADO — SOLO PARA PRUEBAS AUTOMÁTICAS.
 *
 * Imita POST /emails de la API de Resend (Authorization: Bearer, Idempotency-Key)
 * para probar el código real de envío sin mandar correos. Nada sale de este
 * ordenador.
 *
 *   destinatario que empieza por "temporal" → 503 (error pasajero)
 *   destinatario que empieza por "rechazo"  → 422 (dirección rechazada)
 *   misma Idempotency-Key → misma respuesta, sin duplicar el correo
 *   GET /__emails?to=X → correos "enviados" a X (el más reciente primero)
 *
 * Uso: node email-provider-mock.mjs <puerto> <clave>
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const [port = '4997', key = 'clave'] = process.argv.slice(2);
const sent = [];
const byKey = new Map();

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && url.pathname === '/__emails') {
    const to = (url.searchParams.get('to') ?? '').toLowerCase();
    return send(200, sent.filter(m => m.to.includes(to)).reverse());
  }
  if (req.method !== 'POST' || url.pathname !== '/emails') return send(404, { message: 'Not found' });
  if (req.headers.authorization !== `Bearer ${key}`) return send(401, { message: 'API key is invalid' });
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(422, { message: 'Invalid JSON' }); }
    const to = Array.isArray(body.to) ? String(body.to[0]).toLowerCase() : '';
    if (to.startsWith('temporal')) return send(503, { message: 'Service unavailable' });
    if (to.startsWith('rechazo')) return send(422, { message: 'Invalid `to` field' });
    const idem = req.headers['idempotency-key'];
    if (idem && byKey.has(idem)) return send(200, { id: byKey.get(idem) });
    const id = randomUUID();
    if (idem) byKey.set(idem, id);
    sent.push({ id, to, from: body.from, subject: body.subject, text: body.text, html: body.html, reply_to: body.reply_to ?? null, idempotencyKey: idem ?? null });
    return send(200, { id });
  });
}).listen(Number(port), '127.0.0.1');
