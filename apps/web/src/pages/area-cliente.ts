/**
 * «Área de clientes» desde la web pública de un taller.
 *
 * El taller sale del DOMINIO de la visita (configuración del servidor), nunca
 * de un parámetro: se manda a la persona al área privada de AutoValue, que
 * pide iniciar sesión y comprueba si su cuenta está vinculada a ESTE taller
 * (/portal/entrar/<identificador>). Visitar esta página no crea ningún vínculo.
 */
import type { APIRoute } from 'astro';
import { appOrigin, siteForHost } from '../lib/server/config.ts';

export const prerender = false;

export const GET: APIRoute = async ({ request, url, redirect }) => {
  const app = appOrigin() ?? '';
  let slug: string | null;
  try {
    const site = await siteForHost(request.headers.get('host') ?? url.host);
    slug = site?.slug ?? null;
  } catch {
    slug = null;
  }
  // Sin web de taller (dominio de la plataforma): el acceso general.
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return redirect(`${app}/acceso`, 303);
  return redirect(`${app}/portal/entrar/${slug}`, 303);
};
