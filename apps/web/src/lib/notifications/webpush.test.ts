import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fromB64url, sendPush, validVapidKeys, vapidAuthorization, type VapidKeys } from './webpush.ts';

function newKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x!, 'base64url'), Buffer.from(pub.y!, 'base64url')]);
  return { publicKey: raw.toString('base64url'), privateKey: privateKey.export({ format: 'jwk' }).d!, subject: 'https://app.ejemplo.es' };
}

describe('notificaciones en el móvil (Web Push)', () => {
  it('firma VAPID válida: el servicio del navegador puede comprobarla con la clave pública', async () => {
    const keys = newKeys();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', keys, Date.UTC(2026, 9, 26));
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
    expect(k).toBe(keys.publicKey);
    const [head, body, sig] = token!.split('.');
    expect(JSON.parse(Buffer.from(head!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString());
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('https://app.ejemplo.es');
    expect(claims.exp).toBe(Date.UTC(2026, 9, 26) / 1000 + 12 * 3600);
    const raw = fromB64url(keys.publicKey);
    const publicKey = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
      x: Buffer.from(raw.slice(1, 33)).toString('base64url'), y: Buffer.from(raw.slice(33)).toString('base64url') } });
    const ok = verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig!, 'base64url'));
    expect(ok).toBe(true);
  });

  it('claves con mala forma no se usan', () => {
    const keys = newKeys();
    expect(validVapidKeys(keys)).toBe(true);
    expect(validVapidKeys({ ...keys, publicKey: 'corta' })).toBe(false);
    expect(validVapidKeys({ ...keys, subject: 'cualquiera' })).toBe(false);
  });

  it('el «toque» va vacío, con caducidad y la firma; devuelve el código del servicio', async () => {
    const keys = newKeys();
    let seen: RequestInit | undefined;
    const status = await sendPush('https://push.example/abc', keys, {
      fetch: (async (_url: string, init?: RequestInit) => { seen = init; return new Response(null, { status: 201 }); }) as typeof fetch,
    });
    expect(status).toBe(201);
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBeUndefined();
    expect((seen?.headers as Record<string, string>).ttl).toBe('86400');
    expect((seen?.headers as Record<string, string>).authorization).toMatch(/^vapid t=/);
    const failed = await sendPush('https://push.example/abc', keys, { fetch: (async () => { throw new Error('red'); }) as typeof fetch });
    expect(failed).toBe(0);
  });
});
