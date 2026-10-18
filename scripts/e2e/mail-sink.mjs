#!/usr/bin/env node
/**
 * Buzón de correo SOLO para pruebas: un servidor SMTP mínimo que guarda en
 * memoria los correos que envía Supabase Auth (confirmación, recuperación…)
 * y una pequeña API HTTP para que las pruebas los lean.
 *
 *   GET /messages?to=correo   → correos recibidos (el más reciente primero)
 *   GET /templates/<nombre>   → plantillas de supabase/templates para Supabase Auth
 *
 * Uso: node mail-sink.mjs <puerto-smtp> <puerto-http> <carpeta-plantillas>
 */
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const [smtpPort, httpPort] = process.argv.slice(2).map(Number);
const messages = [];

// Plantillas de correo del repositorio (supabase/templates): las pruebas usan
// exactamente las mismas que se configuran en Supabase.
const templatesDir = process.argv[4] ?? '';

function decodeQuotedPrintable(text) {
  return text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function parse(raw) {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const body = rest.join('\n\n');
  const header = name => (head.match(new RegExp(`^${name}:\\s*(.*)$`, 'im')) ?? [])[1] ?? '';
  const qp = /quoted-printable/i.test(raw);
  const b64 = /content-transfer-encoding:\s*base64/i.test(raw);
  let text = body;
  if (b64) {
    text = body.split(/\r?\n--/)[0] ? Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8') : body;
  } else if (qp) {
    text = decodeQuotedPrintable(body);
  }
  const links = [...text.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  return { subject: header('Subject'), to: header('To'), links, body: text };
}

net.createServer(socket => {
  let buffer = '';
  let inData = false;
  let to = [];
  const reply = line => socket.write(`${line}\r\n`);
  reply('220 buzon-de-pruebas ESMTP');
  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    while (true) {
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end === -1) return;
        const raw = buffer.slice(0, end).replace(/^\.\./gm, '.');
        buffer = buffer.slice(end + 5);
        inData = false;
        messages.unshift({ ...parse(raw), rcpt: to, at: Date.now(), raw: raw.slice(0, 20000) });
        to = [];
        reply('250 OK');
        continue;
      }
      const nl = buffer.indexOf('\r\n');
      if (nl === -1) return;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 2);
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') { socket.write('250-buzon-de-pruebas\r\n250 8BITMIME\r\n'); }
      else if (cmd === 'MAIL') reply('250 OK');
      else if (cmd === 'RCPT') { to.push((line.match(/<([^>]+)>/) ?? [])[1]?.toLowerCase() ?? ''); reply('250 OK'); }
      else if (cmd === 'DATA') { inData = true; reply('354 Fin con <CRLF>.<CRLF>'); }
      else if (cmd === 'QUIT') { reply('221 Adiós'); socket.end(); return; }
      else reply('250 OK');
    }
  });
  socket.on('error', () => {});
}).listen(smtpPort, '127.0.0.1');

http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/messages') {
    const to = url.searchParams.get('to')?.toLowerCase();
    const list = to ? messages.filter(m => m.rcpt.includes(to)) : messages;
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(list));
    return;
  }
  if (url.pathname.startsWith('/templates/') && templatesDir) {
    try {
      const html = readFileSync(join(templatesDir, basename(url.pathname)), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  res.writeHead(404).end();
}).listen(httpPort, '127.0.0.1');
