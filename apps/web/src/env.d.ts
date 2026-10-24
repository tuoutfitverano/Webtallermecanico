/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** «1» solo al generar la copia de la web de un taller (npm run web:exportar). Se fija al compilar. */
  readonly WEB_EXPORT?: string;
  /** Datos del taller (JSON) de esa copia. Vacío fuera de la exportación. */
  readonly WEB_EXPORT_SITE?: string;
}
