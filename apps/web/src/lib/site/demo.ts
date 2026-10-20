/**
 * Web de demostración para desarrollo local SIN base de datos.
 *
 * Solo se usa con `npm run dev` cuando Supabase no está configurado, para
 * poder ver la web. Como no tiene taller real (workshopId = null), sus
 * formularios responden "no disponible": nunca simulan un envío correcto.
 *
 * Sale del archivo del taller demo, talleres/autovalue.json (el mismo que
 * carga supabase/seed.sql; una prueba comprueba que coinciden). El nombre y
 * la dirección son los que ha dado el propietario; el resto son datos de
 * ejemplo y la web lo indica.
 */
import autovalue from '../../../../../talleres/autovalue.json';
import { siteFromConfig, workshopConfigSchema } from './workshop-config.ts';

export const DEMO_CONFIG = workshopConfigSchema.parse(autovalue);
export const DEMO_SITE = siteFromConfig(DEMO_CONFIG);
