/**
 * POST /api/solicitudes — recibe los formularios de contacto, cita y presupuesto.
 *
 * Acepta JSON (formularios con JavaScript) y, como reserva, envíos clásicos de
 * formulario sin JavaScript, a los que responde redirigiendo a la página.
 */
import type { APIRoute } from 'astro';
import { handleSubmission } from '../../lib/requests/handler.ts';
import { submissionDeps } from '../../lib/server/config.ts';

export const prerender = false;

const MAX_BODY_BYTES = 16 * 1024;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const POST: APIRoute = async ({ request }) => {
  const contentType = request.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const isForm = contentType.includes('application/x-www-form-urlencoded');

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ ok: false, error: 'bad_request', message: 'El formulario es demasiado grande.' }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ ok: false, error: 'bad_request', message: 'El formulario es demasiado grande.' }, 413);

  let body: unknown = null;
  if (isJson) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  } else if (isForm) {
    body = Object.fromEntries(new URLSearchParams(text));
  }

  const result = await handleSubmission(
    {
      host: request.headers.get('host') ?? new URL(request.url).host,
      origin: request.headers.get('origin'),
      // Cloudflare pone aquí la IP real del visitante.
      ip: request.headers.get('cf-connecting-ip'),
      body,
    },
    submissionDeps(),
  );

  if (isForm) {
    // Sin JavaScript: volver a la página con el resultado.
    const params = new URLSearchParams(
      result.body.ok ? { solicitud: 'ok', ref: result.body.reference } : { solicitud: 'error', motivo: result.body.error },
    );
    return new Response(null, { status: 303, headers: { location: `/?${params}#solicitar`, 'cache-control': 'no-store' } });
  }
  return json(result.body, result.status);
};

export const ALL: APIRoute = () => json({ ok: false, error: 'bad_request', message: 'Método no permitido.' }, 405);
