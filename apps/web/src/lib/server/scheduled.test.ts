import { describe, expect, it } from 'vitest';
import { cronRequest, runScheduled } from './scheduled.ts';

const SECRET = 'x'.repeat(32);

describe('Tarea programada', () => {
  it('llama al endpoint del área privada con el secreto', async () => {
    let seen: Request | null = null;
    const code = await runScheduled({ APP_URL: 'https://app.ejemplo.test', NOTIFICATIONS_CRON_SECRET: SECRET }, async r => {
      seen = r;
      return new Response('{}', { status: 200 });
    });
    expect(code).toBe('cron_ok');
    expect(seen!.method).toBe('POST');
    expect(seen!.url).toBe('https://app.ejemplo.test/api/notificaciones/procesar');
    expect(seen!.headers.get('authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('sin APP_URL, sin secreto o con un secreto corto no hace nada', async () => {
    const never = async () => { throw new Error('no debería llamarse'); };
    expect(await runScheduled({ NOTIFICATIONS_CRON_SECRET: SECRET }, never)).toBe('cron_sin_configurar');
    expect(await runScheduled({ APP_URL: 'https://app.ejemplo.test' }, never)).toBe('cron_sin_configurar');
    expect(await runScheduled({ APP_URL: 'https://app.ejemplo.test', NOTIFICATIONS_CRON_SECRET: 'corto' }, never)).toBe('cron_sin_configurar');
  });

  it('nunca envía el secreto por http sin cifrar (salvo en local)', () => {
    expect(cronRequest({ APP_URL: 'http://app.ejemplo.test', NOTIFICATIONS_CRON_SECRET: SECRET })).toBeNull();
    expect(cronRequest({ APP_URL: 'http://localhost:4321', NOTIFICATIONS_CRON_SECRET: SECRET })).not.toBeNull();
    expect(cronRequest({ APP_URL: 'no es una url', NOTIFICATIONS_CRON_SECRET: SECRET })).toBeNull();
  });

  it('los fallos quedan como código, sin romper la tarea', async () => {
    const env = { APP_URL: 'https://app.ejemplo.test', NOTIFICATIONS_CRON_SECRET: SECRET };
    expect(await runScheduled(env, async () => new Response('', { status: 401 }))).toBe('cron_error_401');
    expect(await runScheduled(env, async () => { throw new Error('caída'); })).toBe('cron_excepcion');
  });
});
