/**
 * Datos legales de la PLATAFORMA (quien presta el servicio a los talleres).
 * Los rellena el titular: lo que esté en null sale en las páginas legales como
 * «[Falta: …]» bien visible. Nunca se inventan. No son secretos (son públicos por ley).
 */
export const LEGAL_VERSION = '1.1';
export const LEGAL_DATE = 'octubre de 2026';

export interface PlatformLegal {
  /** Nombre comercial de la plataforma. */
  brand: string;
  /** Nombre y apellidos o razón social del titular. */
  holder: string | null;
  taxId: string | null;
  address: string | null;
  /** Correo de contacto legal y de protección de datos. */
  email: string | null;
  /** Inscripción registral (solo si el titular está inscrito). */
  registry: string | null;
  /** Días que se guardan los datos de un taller tras darse de baja, para que descargue su copia. */
  deletionDays: number;
}

export const PLATFORM_LEGAL: PlatformLegal = {
  brand: 'AutoValue',
  holder: null,
  taxId: null,
  address: null,
  email: null,
  registry: null,
  deletionDays: 30,
};

/** Datos obligatorios que faltan (para avisar en la página). */
export function platformMissing(p: PlatformLegal = PLATFORM_LEGAL): string[] {
  return [
    !p.holder && 'nombre o razón social del titular',
    !p.taxId && 'NIF',
    !p.address && 'domicilio',
    !p.email && 'correo de contacto',
  ].filter((x): x is string => Boolean(x));
}

/** Datos obligatorios del titular de la web de un taller que faltan (aviso legal y privacidad). */
export function workshopMissing(legal: { legalName: string | null; taxId: string | null; address: string | null; email: string | null }, contactEmail = ''): string[] {
  return [
    !legal.legalName && 'nombre o razón social',
    !legal.taxId && 'NIF',
    !legal.address && 'domicilio',
    !(legal.email || contactEmail.trim()) && 'correo de contacto',
  ].filter((x): x is string => Boolean(x));
}

export interface Subprocessor { name: string; what: string; where: string; when: 'siempre' | 'email' | 'whatsapp' | 'matricula' }
/**
 * Proveedores que tratan datos por cuenta de la plataforma (subencargados). Si se
 * añade o cambia uno, se actualiza aquí: lo usan la privacidad y el contrato de encargo.
 */
export const SUBPROCESSORS: Subprocessor[] = [
  { name: 'Supabase', what: 'Base de datos, inicio de sesión y copias', where: 'Servidores en la Unión Europea (región elegida al crear el proyecto)', when: 'siempre' },
  { name: 'Cloudflare', what: 'Alojamiento y entrega de la web, protección frente a ataques y antispam (Turnstile)', where: 'Red mundial; puede tratar datos fuera de la UE', when: 'siempre' },
  { name: 'Resend', what: 'Envío de correos (cuenta y avisos)', where: 'Estados Unidos', when: 'email' },
  { name: 'Meta (WhatsApp Business)', what: 'Avisos por WhatsApp, solo a quien lo pide', where: 'Unión Europea y Estados Unidos', when: 'whatsapp' },
  { name: 'Openapi', what: 'Datos técnicos del vehículo a partir de la matrícula', where: 'Unión Europea (Italia)', when: 'matricula' },
];
