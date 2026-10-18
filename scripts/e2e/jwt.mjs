#!/usr/bin/env node
/**
 * Firma un JWT HS256 de PRUEBA para la API local (PostgREST), imitando las
 * claves "anon" y "service_role" de Supabase. Solo para pruebas locales.
 * Uso: node jwt.mjs <secreto> <rol>
 */
import { createHmac } from 'node:crypto';
const [secret, role] = process.argv.slice(2);
if (!secret || !role) { console.error('uso: jwt.mjs <secreto> <rol>'); process.exit(1); }
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'pruebas-locales', iat: now, exp: now + 3600 })}`;
process.stdout.write(`${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`);
