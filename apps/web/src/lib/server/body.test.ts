/**
 * Límite real de tamaño del cuerpo (auditoría H02): se mide en bytes y se corta
 * la lectura en cuanto se supera, sin leer el resto.
 */
import { describe, expect, it } from 'vitest';
import { declaredTooLarge, readBodyText, readFormLimited } from './body.ts';

/** Cuerpo en trozos SIN longitud declarada; cuenta cuántos trozos llega a pedir quien lo lee. */
function streamedRequest(chunk: Uint8Array, chunks: number) {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) return controller.close();
      pulled++;
      controller.enqueue(chunk);
    },
  });
  const request = new Request('https://taller.test/api', { method: 'POST', body, duplex: 'half' } as RequestInit);
  return { request, pulled: () => pulled };
}

describe('lectura del cuerpo con límite', () => {
  it('una longitud declarada mayor que el límite se rechaza sin leer nada', async () => {
    const { request, pulled } = streamedRequest(new Uint8Array(1024), 1000);
    request.headers.set('content-length', String(1024 * 1000));
    expect(await readBodyText(request, 16 * 1024)).toBeNull();
    // El propio flujo prepara 1 trozo al crearse; quien lee no pide ninguno más.
    expect(pulled()).toBeLessThanOrEqual(1);
  });

  it('sin longitud declarada, deja de leer en cuanto se pasa (no lee el resto)', async () => {
    // 100 MB anunciados en trozos de 64 KB: solo se leen los primeros.
    const { request, pulled } = streamedRequest(new Uint8Array(64 * 1024), 1600);
    expect(await readBodyText(request, 16 * 1024)).toBeNull();
    expect(pulled()).toBeLessThanOrEqual(3);
  });

  it('mide BYTES, no caracteres: 10.000 «ñ» son 20.000 bytes', async () => {
    const text = 'ñ'.repeat(10_000);
    expect(text.length).toBeLessThanOrEqual(16 * 1024); // con text.length habría pasado
    const request = new Request('https://taller.test/api', { method: 'POST', body: text });
    expect(await readBodyText(request, 16 * 1024)).toBeNull();
  });

  it('justo en el límite se acepta y el texto llega intacto', async () => {
    const text = 'a'.repeat(16 * 1024 - 2) + 'ñ';
    const request = new Request('https://taller.test/api', { method: 'POST', body: text });
    expect(await readBodyText(request, 16 * 1024)).toBe(text);
  });

  it('una longitud declarada que no es un número se rechaza', () => {
    for (const v of ['abc', '-1', '1e9', '12 34', '']) {
      const request = new Request('https://taller.test/api', { method: 'POST', body: 'x', headers: { 'content-length': v } });
      expect(declaredTooLarge(request, 1000)).toBe(true);
    }
    const ok = new Request('https://taller.test/api', { method: 'POST', body: 'x', headers: { 'content-length': '1' } });
    expect(declaredTooLarge(ok, 1000)).toBe(false);
  });

  it('formularios: se leen con límite; uno enorme no se procesa', async () => {
    const small = new Request('https://taller.test/panel', {
      method: 'POST', body: 'action=guardar&nombre=Jos%C3%A9', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const form = await readFormLimited(small);
    expect(form?.get('nombre')).toBe('José');
    const big = new Request('https://taller.test/panel', {
      method: 'POST', body: `x=${'a'.repeat(200_000)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(await readFormLimited(big)).toBeNull();
  });
});
