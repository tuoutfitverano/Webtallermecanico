# Talleres

Un archivo `.json` por taller con todo lo que es **suyo**:

- nombre y dominios;
- textos, servicios y contacto;
- colores, tipografía y logotipo;
- secciones visibles y funciones del software que se enseñan.

El diseño y los componentes son compartidos. Guía completa: `docs/PLANTILLA_TALLERES.md`.

| Archivo | Para qué |
| --- | --- |
| `autovalue.json` | Taller ficticio de demostración comercial (diseño premium y sección «Tu taller también puede trabajar así»). Es la configuración por defecto en local y la copia `supabase/seed.sql` |
| `plantilla.json` | Punto de partida para un taller nuevo. Los datos marcados `[PENDIENTE]` hay que sustituirlos por datos reales confirmados por el taller |

```bash
npm test                                               # comprueba todos los archivos
npm run taller:sql -- talleres/mi-taller.json > x.sql  # SQL para el SQL Editor de Supabase (revisar antes de ejecutar)
```

No inventes datos del taller (reseñas, años de experiencia, certificaciones, precios).
