/**
 * Clientes de Supabase para el SERVIDOR.
 *
 *  · createPublicClient: clave publicable. Solo puede hacer lo que RLS permite
 *    a un visitante (por ejemplo, leer la web publicada de un taller).
 *  · createServiceClient: clave secreta. Se salta RLS: úsala solo para
 *    operaciones concretas y controladas (registrar una solicitud ya validada).
 *    Nunca la importes desde código que llegue al navegador.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { 'x-client-info': 'talleres-web' } },
} as const;

export function createPublicClient(url: string, publishableKey: string): SupabaseClient {
  return createClient(url, publishableKey, options);
}

export function createServiceClient(url: string, secretKey: string): SupabaseClient {
  return createClient(url, secretKey, options);
}
