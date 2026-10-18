import { describe, expect, it } from 'vitest';
import { loginUrl, safeNext } from './redirect.ts';
import { authErrorMessage, dbErrorMessage, GENERIC_AUTH_ERROR, AUTH_UNAVAILABLE } from './messages.ts';
import { isEmail, normalizeEmail, passwordProblem } from './validate.ts';

const ORIGIN = 'https://app.talleres.test';

describe('safeNext: redirección después de iniciar sesión', () => {
  it('acepta rutas del propio sitio', () => {
    expect(safeNext('/cuenta', ORIGIN)).toBe('/cuenta');
    expect(safeNext('/invitacion?token=abc', ORIGIN)).toBe('/invitacion?token=abc');
    expect(safeNext(`${ORIGIN}/cuenta/contrasena`, ORIGIN)).toBe('/cuenta/contrasena');
  });

  it.each([
    'https://evil.test/robar',
    '//evil.test/robar',
    '/\\evil.test',
    '\\\\evil.test',
    'javascript:alert(1)',
    'data:text/html,hola',
    'https://app.talleres.test.evil.test/x',
    'http://app.talleres.test/cuenta', // otro protocolo = otro origen
    '/cuenta\n//evil.test',
    '  ',
  ])('rechaza destinos externos o raros: %s', raw => {
    expect(safeNext(raw, ORIGIN)).toBe('/mi-area');
  });

  it('rechaza valores que no son texto y usa el destino por defecto indicado', () => {
    expect(safeNext(undefined, ORIGIN)).toBe('/mi-area');
    expect(safeNext(['/x'], ORIGIN)).toBe('/mi-area');
    expect(safeNext('https://evil.test', ORIGIN, '/cuenta/contrasena')).toBe('/cuenta/contrasena');
  });

  it('no vuelve a las pantallas de acceso (evita bucles)', () => {
    expect(safeNext('/acceso?next=/cuenta', ORIGIN)).toBe('/mi-area');
    expect(safeNext('/auth/confirmar?code=x', ORIGIN)).toBe('/mi-area');
    expect(safeNext('/salir', ORIGIN)).toBe('/mi-area');
  });

  it('loginUrl codifica la ruta de vuelta', () => {
    expect(loginUrl('/invitacion?token=a&b=c')).toBe('/acceso?next=%2Finvitacion%3Ftoken%3Da%26b%3Dc');
  });
});

describe('mensajes de error', () => {
  it('traduce los códigos de Supabase Auth', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toMatch(/correo o la contraseña no son correctos/);
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toMatch(/confirmado tu correo/);
  });
  it('si el servicio no responde, lo dice; si no conoce el error, usa uno genérico', () => {
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toBe(AUTH_UNAVAILABLE);
    expect(authErrorMessage({ code: 'algo_raro', status: 400 })).toBe(GENERIC_AUTH_ERROR);
  });
  it('solo muestra mensajes de la base de datos escritos por nosotros', () => {
    expect(dbErrorMessage({ code: '42501', message: 'No tienes permiso.' })).toBe('No tienes permiso.');
    expect(dbErrorMessage({ code: '42P01', message: 'relation "x" does not exist' })).toBe(GENERIC_AUTH_ERROR);
    expect(dbErrorMessage(null)).toBe(GENERIC_AUTH_ERROR);
  });
});

describe('validación de formularios de acceso', () => {
  it('normaliza y valida correos', () => {
    expect(normalizeEmail('  Ana@Correo.ES ')).toBe('ana@correo.es');
    expect(isEmail('ana@correo.es')).toBe(true);
    expect(isEmail('ana@correo')).toBe(false);
  });
  it('exige contraseñas de 10 a 72 bytes con mayúsculas, minúsculas y números (como Supabase)', () => {
    expect(passwordProblem('')).toMatch(/Escribe/);
    expect(passwordProblem('Abc123456')).toMatch(/al menos 10/);
    expect(passwordProblem('abcdefghij1')).toMatch(/mayúsculas, minúsculas y números/);
    expect(passwordProblem('Abcdefghij1')).toBe(null);
    expect(passwordProblem('Ññ1'.repeat(30))).toMatch(/demasiado larga/);
  });
});
