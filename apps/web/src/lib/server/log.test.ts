import { describe, expect, it } from 'vitest';
import { levelFor, logLine, requestId, safePath } from './log.ts';

describe('registro estructurado', () => {
  it('una línea JSON con hora, nivel y evento', () => {
    const line = JSON.parse(logLine('push_dispatch', { sent: 2 }, new Date('2026-10-28T10:00:00Z')));
    expect(line).toEqual({ ts: '2026-10-28T10:00:00.000Z', level: 'info', event: 'push_dispatch', sent: 2 });
  });
  it('los errores se marcan como error (para alertas)', () => {
    expect(levelFor('maintenance_error')).toBe('error');
    expect(levelFor('cron_excepcion')).toBe('error');
    expect(levelFor('panel_agenda_save_error')).toBe('error');
    expect(levelFor('push_dispatch')).toBe('info');
  });
  it('la ruta no lleva identificadores, consultas ni códigos secretos', () => {
    expect(safePath('/panel/ordenes/0d000001-0000-0000-0000-00000000000a')).toBe('/panel/ordenes/:id');
    expect(safePath('/presupuesto/Zq3k9mX2vB7nL4pR8sT1uW6yA0cD5eF')).toBe('/presupuesto/:código');
    expect(safePath('/panel/agenda')).toBe('/panel/agenda');
  });
  it('identificador de petición: el de Cloudflare o uno nuevo', () => {
    expect(requestId(new Request('https://x.test/', { headers: { 'cf-ray': '8d2f1a2b3c4d5e6f-MAD' } }))).toBe('8d2f1a2b3c4d5e6f-MAD');
    expect(requestId(new Request('https://x.test/', { headers: { 'cf-ray': '<script>' } }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
