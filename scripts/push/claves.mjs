#!/usr/bin/env node
/**
 * Crea un par de claves VAPID para las notificaciones en el móvil (Web Push).
 *
 *   node scripts/push/claves.mjs          → las enseña para copiarlas
 *   node scripts/push/claves.mjs --json   → {"VAPID_PUBLIC_KEY": …, "VAPID_PRIVATE_KEY": …}
 *
 * La pública la ve el navegador; la privada es SECRETA (solo en el servidor).
 * «Publicar versión real» las crea sola la primera vez. Cambiarlas obliga a
 * cada cliente a volver a activar las notificaciones en su móvil.
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const priv = privateKey.export({ format: 'jwk' });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
const keys = { VAPID_PUBLIC_KEY: raw.toString('base64url'), VAPID_PRIVATE_KEY: priv.d };
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(keys));
else for (const [k, v] of Object.entries(keys)) console.log(`${k}=${v}`);
