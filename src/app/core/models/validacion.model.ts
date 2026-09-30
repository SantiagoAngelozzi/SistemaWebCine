import { TipoButaca } from './sala.model';

/** Qué uso del QR se está validando. */
export type TipoValidacion = 'sala' | 'candy';

export type MotivoValidacion =
  | 'validado'
  | 'no_existe'
  | 'cancelada'
  | 'sin_funcion'
  | 'ya_utilizado'
  | 'sin_candy'
  | 'otra_fecha'
  | 'vencida';

export interface ProductoAEntregar {
  nombre: string;
  cantidad: number;
}

export interface CandyAEntregar {
  tipo: 'combo' | 'producto';
  nombre: string;
  cantidad: number;
  /** Para combos: productos que hay que entregar (ya multiplicados por la cantidad). */
  contenido: ProductoAEntregar[];
}

/** Respuesta de la RPC validar_qr. Los datos de la compra no vienen si el código no existe. */
export interface ResultadoValidacion {
  ok: boolean;
  motivo: MotivoValidacion;
  mensaje: string;
  tipo?: TipoValidacion;
  codigo_corto?: string;
  pelicula?: string;
  clasificacion?: 'ATP' | '+13' | '+18';
  sala?: string;
  fecha?: string;
  hora_inicio?: string;
  hora_fin?: string;
  formato?: string;
  idioma?: string;
  entradas?: { ubicacion: string; tipo: TipoButaca }[];
  candy?: CandyAEntregar[];
  candy_pendiente?: boolean;
}

/** Entrada del historial local de la pantalla del empleado. */
export interface RegistroValidacion {
  hora: Date;
  codigo: string;
  tipo: TipoValidacion;
  ok: boolean;
  mensaje: string;
}
