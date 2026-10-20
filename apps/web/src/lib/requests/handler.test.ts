import { describe, expect, it, vi } from 'vitest';
import { DEMO_SITE } from '../site/demo.ts';
import type { PublicSite } from '../site/content.ts';
import type { CaptchaVerifier } from './antispam.ts';
import { clientFingerprint, createTurnstileVerifier } from './antispam.ts';
import { handleSubmission, type SubmissionDeps, type SubmissionInput } from './handler.ts';
import { StoreError, type RequestStore } from './store.ts';

const SITE: PublicSite = { ...DEMO_SITE, workshopId: '7a1c0c3e-0000-4000-8000-000000000001' };
const KEY = '11111111-1111-4111-8111-111111111111';

const validBody = {
  kind: 'cita',
  name: 'Ana Pérez',
  phone: '600 123 456',
  service: 'frenos',
  plate: '1950 bxf',
  preferredDate: '2026-10-20',
  message: 'Ruido al frenar',
  privacyAccepted: true,
  idempotencyKey: KEY,
  turnstileToken: 'token-ok',
  website: '',
};

function input(over: Partial<SubmissionInput> = {}, body: Record<string, unknown> = validBody): SubmissionInput {
  return { host: 'demo.localhost:4321', origin: 'http://demo.localhost:4321', ip: '203.0.113.7', body, ...over };
}

function deps(over: Partial<SubmissionDeps> = {}) {
  const store: RequestStore = { submit: vi.fn(async () => ({ id: '3f2a9c1e-1234-4abc-9def-0123456789ab', duplicate: false })) };
  const captcha: CaptchaVerifier = { verify: vi.fn(async (t: string): Promise<'ok' | 'invalid'> => (t === 'token-ok' ? 'ok' : 'invalid')) };
  const d: SubmissionDeps = {
    resolveSite: vi.fn(async () => SITE),
    store,
    captcha,
    requireCaptcha: true,
    fingerprint: vi.fn(async () => 'huella'),
    today: () => '2026-10-18',
    log: vi.fn(),
    ...over,
  };
  return d;
}

describe('handleSubmission', () => {
  it('guarda una solicitud válida y solo entonces responde ok', async () => {
    const d = deps();
    const r = await handleSubmission(input(), d);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true, id: '3f2a9c1e-1234-4abc-9def-0123456789ab', reference: '3F2A9C1E', duplicate: false });
    expect(d.store!.submit).toHaveBeenCalledWith(expect.objectContaining({
      workshopId: SITE.workshopId,
      idempotencyKey: KEY,
      clientHash: 'huella',
      data: expect.objectContaining({ kind: 'cita', plate: '1950BXF', service: 'frenos' }),
    }));
  });

  it('un reintento del mismo envío también es correcto (200) y no duplica', async () => {
    const d = deps({ store: { submit: vi.fn(async () => ({ id: '3f2a9c1e-1234-4abc-9def-0123456789ab', duplicate: true })) } });
    const r = await handleSubmission(input(), d);
    expect(r.status).toBe(200);
    expect(r.body.ok && r.body.duplicate).toBe(true);
  });

  it('NO responde ok si el almacenamiento falla', async () => {
    const d = deps({ store: { submit: vi.fn(async () => { throw new StoreError('unavailable'); }) } });
    const r = await handleSubmission(input(), d);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: 'storage_unavailable' });
    expect(!r.body.ok && r.body.message).toMatch(/No se ha guardado/);
  });

  it('NO responde ok si el almacenamiento lanza un error inesperado', async () => {
    const d = deps({ store: { submit: vi.fn(async () => { throw new Error('boom'); }) } });
    const r = await handleSubmission(input(), d);
    expect(r.body.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  it('NO responde ok si no hay almacenamiento configurado (la demo local)', async () => {
    const d = deps({ store: null, resolveSite: vi.fn(async () => DEMO_SITE) });
    const r = await handleSubmission(input(), d);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: 'not_configured' });
  });

  it('traduce el límite de envíos a 429', async () => {
    const d = deps({ store: { submit: vi.fn(async () => { throw new StoreError('rate_limited'); }) } });
    const r = await handleSubmission(input(), d);
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('valida en el servidor y devuelve los errores por campo', async () => {
    const d = deps();
    const r = await handleSubmission(input({}, { ...validBody, name: '', phone: '', service: 'inventado' }), d);
    expect(r.status).toBe(422);
    expect(!r.body.ok && r.body.fields).toMatchObject({ name: expect.any(String), contact: expect.any(String), service: expect.any(String) });
    expect(d.store!.submit).not.toHaveBeenCalled();
  });

  it('exige aceptar la privacidad aunque el navegador diga lo contrario', async () => {
    const r = await handleSubmission(input({}, { ...validBody, privacyAccepted: 'quizá' }), deps());
    expect(!r.body.ok && r.body.fields?.privacyAccepted).toBeDefined();
  });

  it('rechaza envíos desde otra web', async () => {
    const d = deps();
    const r = await handleSubmission(input({ origin: 'https://malicioso.example' }), d);
    expect(r.status).toBe(403);
    expect(d.store!.submit).not.toHaveBeenCalled();
  });

  it('rechaza bots que rellenan el campo trampa', async () => {
    const d = deps();
    const r = await handleSubmission(input({}, { ...validBody, website: 'http://spam.example' }), d);
    expect(r.status).toBe(400);
    expect(d.store!.submit).not.toHaveBeenCalled();
  });

  it('rechaza el envío si falla la comprobación anti-bots', async () => {
    const d = deps();
    const r = await handleSubmission(input({}, { ...validBody, turnstileToken: 'falso' }), d);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: 'captcha_failed' });
    expect(d.store!.submit).not.toHaveBeenCalled();
  });

  it('en producción sin anti-bots configurado no guarda nada', async () => {
    const d = deps({ captcha: null, requireCaptcha: true });
    const r = await handleSubmission(input(), d);
    expect(r.status).toBe(503);
    expect(d.store!.submit).not.toHaveBeenCalled();
  });

  it('en desarrollo puede guardar sin anti-bots', async () => {
    const d = deps({ captcha: null, requireCaptcha: false });
    expect((await handleSubmission(input(), d)).status).toBe(201);
  });

  it('exige una clave de idempotencia válida', async () => {
    const r = await handleSubmission(input({}, { ...validBody, idempotencyKey: 'abc' }), deps());
    expect(r.status).toBe(400);
  });

  it('el taller sale del dominio, no del formulario', async () => {
    const d = deps();
    await handleSubmission(input({}, { ...validBody, workshopId: 'otro-taller' }), d);
    expect(d.resolveSite).toHaveBeenCalledWith('demo.localhost:4321');
    expect(d.store!.submit).toHaveBeenCalledWith(expect.objectContaining({ workshopId: SITE.workshopId }));
  });

  it('guarda una solicitud de digitalización en la web de demostración con sección comercial', async () => {
    const d = deps();
    const body = { kind: 'digitalizacion', name: 'Lucía', businessName: 'Taller Lucía', email: 'lucia@correo.test', topic: 'web', privacyAccepted: true, idempotencyKey: KEY, turnstileToken: 'token-ok' };
    const r = await handleSubmission(input({}, body), d);
    expect(r.status).toBe(201);
    expect(d.store!.submit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'digitalizacion', businessName: 'Taller Lucía', topic: 'web' }) }));
  });

  it('la web de un taller sin sección comercial rechaza las solicitudes de digitalización', async () => {
    const d = deps({ resolveSite: vi.fn(async () => ({ ...SITE, salesEnabled: false })) });
    const body = { kind: 'digitalizacion', name: 'Lucía', businessName: 'Taller Lucía', email: 'lucia@correo.test', topic: 'web', privacyAccepted: true, idempotencyKey: KEY, turnstileToken: 'token-ok' };
    const r = await handleSubmission(input({}, body), d);
    expect(r.status).toBe(422);
    expect(d.store!.submit).not.toHaveBeenCalled();
  });

  it('dominio desconocido → 404', async () => {
    const r = await handleSubmission(input(), deps({ resolveSite: vi.fn(async () => null) }));
    expect(r.status).toBe(404);
  });

  it('los registros técnicos no contienen datos personales', async () => {
    const d = deps();
    await handleSubmission(input(), d);
    const logged = JSON.stringify((d.log as ReturnType<typeof vi.fn>).mock.calls);
    for (const personal of ['Ana', '600 123 456', '1950', '203.0.113.7']) expect(logged).not.toContain(personal);
  });
});

describe('antispam', () => {
  it('la huella no contiene el IP y cambia cada día', async () => {
    const a = await clientFingerprint('203.0.113.7', 'secreto', '2026-10-18');
    const b = await clientFingerprint('203.0.113.7', 'secreto', '2026-10-19');
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toContain('203');
    expect(a).not.toBe(b);
    expect(await clientFingerprint(null, 'secreto', '2026-10-18')).toBe(null);
  });

  it('Turnstile: acepta, rechaza y detecta errores de red', async () => {
    const ok = createTurnstileVerifier('s', vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'demo.localhost', action: 'solicitud' }))));
    expect(await ok.verify('t', null, 'demo.localhost')).toBe('ok');
    const otroHost = createTurnstileVerifier('s', vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'otra.web' }))));
    expect(await otroHost.verify('t', null, 'demo.localhost')).toBe('invalid');
    const no = createTurnstileVerifier('s', vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    expect(await no.verify('t', null, 'demo.localhost')).toBe('invalid');
    const caido = createTurnstileVerifier('s', vi.fn(async () => { throw new Error('red'); }));
    expect(await caido.verify('t', null, 'demo.localhost')).toBe('error');
    expect(await ok.verify('', null, 'demo.localhost')).toBe('invalid');
  });
});
