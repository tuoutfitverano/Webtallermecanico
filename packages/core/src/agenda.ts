/**
 * Agenda de cada persona del taller: apuntes con día y hora. Las mismas reglas
 * que la base de datos (staff_agenda); el servidor decide con ellas y la base
 * de datos vuelve a comprobarlas.
 */
import { z } from 'zod';

export const AGENDA_KINDS = ['tarea', 'cita', 'reunion', 'ausencia', 'otro'] as const;
export type AgendaKind = (typeof AGENDA_KINDS)[number];
export const AGENDA_KIND_LABELS: Record<AgendaKind, string> = {
  tarea: 'Tarea', cita: 'Cita', reunion: 'Reunión', ausencia: 'Ausencia', otro: 'Otro',
};
export const isAgendaKind = (v: unknown): v is AgendaKind => typeof v === 'string' && (AGENDA_KINDS as readonly string[]).includes(v);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Apunte escrito en el formulario: día, hora de inicio y de fin (hora de Madrid). Termina el mismo día. */
export const agendaItemSchema = z
  .object({
    title: z.string({ error: 'Escribe qué hay que hacer.' }).transform(v => v.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(1, 'Escribe qué hay que hacer.').max(120, 'Máximo 120 caracteres.')),
    kind: z.enum(AGENDA_KINDS, { error: 'Elige el tipo.' }),
    day: z.string().regex(DAY, 'Elige el día.'),
    start: z.string().regex(TIME, 'Hora de inicio no válida (hh:mm).'),
    end: z.string().regex(TIME, 'Hora de fin no válida (hh:mm).'),
    notes: z.string().transform(v => v.trim()).pipe(z.string().max(1000, 'Máximo 1000 caracteres.')).transform(v => v || null),
  })
  .refine(v => v.end > v.start, { path: ['end'], message: 'La hora de fin tiene que ser después de la de inicio.' });

export type AgendaItemInput = z.infer<typeof agendaItemSchema>;
