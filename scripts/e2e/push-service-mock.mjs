#!/usr/bin/env node
/**
 * ⚠ SERVICIO DE NOTIFICACIONES SIMULADO — SOLO PARA PRUEBAS AUTOMÁTICAS.
 *
 * Hace de servicio de notificaciones del navegador (el de Google, Apple o
 * Mozilla): recibe el «toque» de Web Push y comprueba la firma VAPID con la
 * clave pública de la plataforma, como hacen los de verdad. Nada sale de aquí.
 *
 *   POST /push/<id>        → 201 si la firma es válida (401 si no); <id> «gone…» → 410
 *   GET  /__push?id=<id>   → toques recibidos para ese dispositivo
 *
 * Uso: node push-service-mock.mjs <puerto> <clave-pública-vapid>
 */
import { createServer } from 'node:http';
import { createPublicKey, verify } from 'node:crypto';

const [port = '4995', publicKeyB64 = ''] = process.argv.slice(2);
const raw = Buffer.from(publicKeyB64, 'base64url');
const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') } });
const received = [];

function validVapid(header, origin) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header ?? '');
  if (!m || m[2] !== publicKeyB64) return false;
  const [head, body, sig] = m[1].split('.');
  if (!verify('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))) return false;
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  return claims.aud === origin && claims.exp > Date.now() / 1000 && /^(https:|mailto:)/.test(claims.sub);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/__push') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(received.filter(r => r.id === url.searchParams.get('id'))));
  }
  const id = /^\/push\/([\w-]+)$/.exec(url.pathname)?.[1];
  if (req.method !== 'POST' || !id) { res.writeHead(404); return res.end(); }
  let size = 0;
  req.on('data', c => { size += c.length; });
  req.on('end', () => {
    if (!validVapid(req.headers.authorization, url.origin)) { res.writeHead(401); return res.end(); }
    if (id.startsWith('gone')) { res.writeHead(410); return res.end(); }
    received.push({ id, size, ttl: req.headers.ttl, at: Date.now() });
    res.writeHead(201); res.end();
  });
}).listen(Number(port), '127.0.0.1');
