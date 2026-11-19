export type SeccionAsignable =
  | 'peliculas'
  | 'salas_funciones'
  | 'candy'
  | 'cupones'
  | 'reportes'
  | 'auditoria'
  | 'propuestas';

export type SeccionAdmin = SeccionAsignable | 'empleados' | 'roles';

export interface InfoSeccion {
  seccion: SeccionAdmin;
  etiqueta: string;
  ruta: string;
}

export const SECCIONES_ADMIN: InfoSeccion[] = [
  { seccion: 'peliculas', etiqueta: 'Películas', ruta: 'peliculas' },
  { seccion: 'salas_funciones', etiqueta: 'Salas y Funciones', ruta: 'salas-funciones' },
  { seccion: 'candy', etiqueta: 'Candy Bar', ruta: 'candy-bar' },
  { seccion: 'propuestas', etiqueta: 'Propuestas', ruta: 'propuestas' },
  { seccion: 'empleados', etiqueta: 'Empleados', ruta: 'empleados' },
  { seccion: 'roles', etiqueta: 'Roles', ruta: 'roles' },
  { seccion: 'cupones', etiqueta: 'Cupones y Puntos', ruta: 'cupones-puntos' },
  { seccion: 'reportes', etiqueta: 'Dashboard y Reportes', ruta: 'reportes' },
  { seccion: 'auditoria', etiqueta: 'Auditoría', ruta: 'auditoria' }
];

export const SECCIONES_ASIGNABLES: SeccionAsignable[] = [
  'peliculas',
  'salas_funciones',
  'candy',
  'cupones',
  'reportes',
  'auditoria',
  'propuestas'
];

export function etiquetaSeccion(seccion: string): string {
  return SECCIONES_ADMIN.find((s) => s.seccion === seccion)?.etiqueta ?? seccion;
}

export interface RolPersonalizado {
  id: string;
  nombre: string;
  descripcion: string | null;
  secciones: SeccionAsignable[];
  cantidadUsuarios: number;
}

export interface MisPermisos {
  esAdmin: boolean;
  rol: string | null;
  secciones: SeccionAdmin[];
}
