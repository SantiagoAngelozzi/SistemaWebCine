export type TipoNotificacion = 'lista_espera' | 'funcion_cancelada' | 'propuesta';

export interface Notificacion {
  id: string;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  link: string | null;
  leida: boolean;
  creadaEl: string;
}
