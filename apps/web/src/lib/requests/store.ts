/**
 * Dónde se guardan las solicitudes.
 *
 * El manejador solo conoce esta interfaz, así que se puede probar sin base de
 * datos y, en el futuro, cambiar el almacenamiento sin tocar los formularios.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebRequestData } from '@talleres/core';

export type StoreErrorCode = 'rate_limited' | 'invalid' | 'site_unavailable' | 'unavailable';

export class StoreError extends Error {
  constructor(public readonly code: StoreErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'StoreError';
  }
}

export interface SavedRequest {
  id: string;
  /** true si ese mismo envío ya se había guardado (doble clic, reintento). */
  duplicate: boolean;
}

export interface RequestStore {
  submit(args: {
    workshopId: string;
    data: WebRequestData;
    idempotencyKey: string;
    clientHash: string | null;
    sourcePath: string | null;
  }): Promise<SavedRequest>;
}

/** Guarda en Supabase llamando a public.submit_web_request con la clave secreta. */
export function createSupabaseStore(supabase: SupabaseClient): RequestStore {
  return {
    async submit({ workshopId, data, idempotencyKey, clientHash, sourcePath }) {
      const { data: result, error } = await supabase.rpc('submit_web_request', {
        p_workshop_id: workshopId,
        p_request: { ...data, privacyAccepted: true, sourcePath },
        p_idempotency_key: idempotencyKey,
        p_client_hash: clientHash,
      });

      if (error) {
        const code = error.code ?? '';
        if (code === 'PT429') throw new StoreError('rate_limited');
        if (code === 'PT404') throw new StoreError('site_unavailable');
        if (code.startsWith('22') || code.startsWith('23')) throw new StoreError('invalid');
        throw new StoreError('unavailable', `submit_web_request: ${code || 'sin código'}`);
      }

      const id = (result as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !id) throw new StoreError('unavailable', 'respuesta sin id');
      return { id, duplicate: Boolean((result as { duplicate?: unknown }).duplicate) };
    },
  };
}
