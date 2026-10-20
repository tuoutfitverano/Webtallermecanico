/**
 * Lo que el software de gestión hace HOY, para enseñarlo en la web.
 *
 * Cada entrada corresponde a pantallas que existen y están probadas (ver
 * docs/INTEGRACION.md). Las capturas son reales, hechas con los datos de
 * demostración (public/plataforma/capturas, compartidas por todos los talleres).
 * Si una función depende de un proveedor externo, su estado sale de la
 * configuración REAL del servidor: nunca se presenta como activa si no lo está.
 */
import type { SoftwareFeature } from './content.ts';

const CAPTURAS = '/plataforma/capturas';

export interface Screen {
  id: string;
  /** Pestaña del recorrido. */
  label: string;
  title: string;
  text: string;
  img: string;
  width: number;
  height: number;
  alt: string;
  phone?: boolean;
  feature: SoftwareFeature;
}

/** Recorrido por las pantallas, en el orden en que se usan. */
export const SCREENS: readonly Screen[] = [
  {
    id: 'inicio', label: 'Inicio', feature: 'ordenes',
    title: 'El día del taller, de un vistazo',
    text: 'Órdenes activas, pendientes de diagnosis, esperando recambios y listas para recoger, con las últimas actualizadas.',
    img: `${CAPTURAS}/panel-inicio.webp`, width: 1600, height: 1000,
    alt: 'Inicio del panel del taller con los indicadores del día (datos de demostración)',
  },
  {
    id: 'ordenes', label: 'Órdenes', feature: 'ordenes',
    title: 'Todas las reparaciones, ordenadas',
    text: 'Filtros por estado y por mecánico, y búsqueda por número, matrícula o cliente.',
    img: `${CAPTURAS}/ordenes.webp`, width: 1600, height: 1000,
    alt: 'Lista de órdenes de reparación con su estado (datos de demostración)',
  },
  {
    id: 'orden', label: 'Orden', feature: 'ordenes',
    title: 'Cada coche, un expediente',
    text: 'Estado, mecánico, diagnosis y trabajo realizado. Lo que ve el cliente va separado de las notas internas, y el historial lo escribe el sistema.',
    img: `${CAPTURAS}/orden.webp`, width: 1600, height: 1222,
    alt: 'Detalle de una orden de reparación (datos de demostración)',
  },
  {
    id: 'clientes', label: 'Clientes', feature: 'clientes',
    title: 'Clientes y vehículos en un solo sitio',
    text: 'Ficha de cada cliente con sus vehículos, la matrícula normalizada y el historial de reparaciones de cada coche.',
    img: `${CAPTURAS}/clientes.webp`, width: 1600, height: 1000,
    alt: 'Ficha de un cliente con sus vehículos en el panel (datos de demostración)',
  },
  {
    id: 'solicitudes', label: 'Solicitudes', feature: 'solicitudes',
    title: 'Lo que llega desde la web',
    text: 'Las peticiones de cita, presupuesto o contacto llegan a una bandeja. Una cita solicitada no está confirmada hasta que el taller habla con la persona.',
    img: `${CAPTURAS}/solicitudes.webp`, width: 1600, height: 1000,
    alt: 'Bandeja de solicitudes de la web en el panel (datos de demostración)',
  },
  {
    id: 'avisos', label: 'Avisos', feature: 'avisos',
    title: 'Avisos automáticos al cliente',
    text: 'Cada cambio de estado genera un aviso en el portal del cliente. Hay un registro de lo enviado y se puede reintentar.',
    img: `${CAPTURAS}/avisos.webp`, width: 1600, height: 1000,
    alt: 'Registro de avisos a clientes en el panel (datos de demostración)',
  },
  {
    id: 'mecanico', label: 'Mecánico', feature: 'equipo',
    title: 'Cada persona ve lo suyo',
    text: 'Propietario, administración y mecánicos con permisos distintos. Un mecánico solo ve sus trabajos, y la base de datos lo impone.',
    img: `${CAPTURAS}/trabajador.webp`, width: 1600, height: 1000,
    alt: 'Inicio del panel visto por un mecánico: solo sus trabajos (datos de demostración)',
  },
  {
    id: 'portal', label: 'Portal del cliente', feature: 'portal', phone: true,
    title: 'Su reparación, en su móvil',
    text: 'El cliente ve el estado de su coche, los mensajes del taller y su historial. Solo lo suyo, y solo lo que el taller decide enseñarle.',
    img: `${CAPTURAS}/portal-reparacion.webp`, width: 780, height: 1688,
    alt: 'Detalle de una reparación en el portal del cliente, en el móvil (datos de demostración)',
  },
];

export interface FeatureStatus {
  /** Matrícula: hace falta contratar el proveedor de datos. */
  plateLookup: boolean;
  /** Email: hace falta configurar el proveedor de correo. */
  email: boolean;
}

/** Qué está operativo y qué falta por activar, según la configuración real. */
export function capabilityList(features: Record<SoftwareFeature, boolean>, status: FeatureStatus) {
  const list: { label: string; active: boolean; note?: string }[] = [];
  if (features.ordenes) list.push({ label: 'Órdenes de reparación con seis estados e historial', active: true });
  if (features.clientes) list.push({ label: 'Clientes y vehículos', active: true });
  if (features.solicitudes) list.push({ label: 'Solicitudes de cita, presupuesto y contacto desde la web', active: true, note: 'Sin agenda: el taller confirma cada cita' });
  if (features.portal) list.push({ label: 'Portal del cliente por invitación', active: true });
  if (features.avisos) {
    list.push({ label: 'Avisos en el portal en cada cambio de estado', active: true });
    list.push({ label: 'Avisos por email', active: status.email, note: status.email ? undefined : 'Falta configurar el proveedor de correo' });
  }
  if (features.equipo) list.push({ label: 'Equipo con roles y permisos', active: true });
  if (features.matriculas) list.push({ label: 'Datos del vehículo a partir de la matrícula', active: status.plateLookup, note: status.plateLookup ? undefined : 'Falta contratar el proveedor de datos' });
  return list;
}
