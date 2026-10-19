/**
 * Plantilla del email de cambio de estado ("reparacion_estado_v1"): HTML
 * sencillo (sin imágenes externas ni seguimiento) y versión de texto plano.
 *
 * Solo lleva lo que el cliente ya puede ver en su portal: vehículo, número de
 * orden, estado y el mensaje del taller. Nunca notas internas, diagnosis no
 * autorizada, contraseñas ni enlaces con códigos de acceso.
 */

export interface ClaimedNotification {
  id: string;
  workshop_id: string;
  workshop_name: string;
  reply_to: string | null;
  order_id: string | null;
  event: string | null;
  template: string;
  title: string;
  body: string;
  recipient: string;
  attempts: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Asunto de una línea, sin saltos y con longitud razonable. */
function oneLine(s: string, max: number): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * @param portalOrigin Dirección del área privada (APP_URL) o null: sin ella no se pone enlace.
 */
export function renderEmail(n: ClaimedNotification, portalOrigin: string | null): RenderedEmail {
  const subject = oneLine(`${n.workshop_name}: ${n.title}`, 150);
  const link = portalOrigin && n.order_id ? `${portalOrigin}/portal/reparaciones/${encodeURIComponent(n.order_id)}` : null;
  const footer = 'Recibes este aviso porque tu vehículo está en este taller. Puedes dejar de recibir avisos por email desde «Mis datos» en tu portal o pidiéndoselo al taller.';

  const text = [
    n.title,
    '',
    n.body,
    '',
    link ? `Consulta el estado en tu portal: ${link}` : 'Puedes consultar el estado en tu portal de cliente.',
    '',
    `— ${n.workshop_name}`,
    '',
    footer,
  ].join('\n');

  const paragraphs = n.body.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
      <tr><td style="padding:24px 24px 8px;font-size:14px;color:#52525b">${escapeHtml(n.workshop_name)}</td></tr>
      <tr><td style="padding:0 24px"><h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#09090b">${escapeHtml(n.title)}</h1></td></tr>
      <tr><td style="padding:0 24px;font-size:16px;line-height:1.5">${paragraphs}</td></tr>
      ${link ? `<tr><td style="padding:4px 24px 20px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#09090b;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:15px">Ver mi reparación</a></td></tr>` : ''}
      <tr><td style="padding:16px 24px 24px;border-top:1px solid #e4e4e7;font-size:12px;line-height:1.5;color:#71717a">${escapeHtml(footer)}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, html, text };
}
