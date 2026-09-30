export type TipoCupon = 'bienvenida' | 'segmentado_edad' | 'general';

export interface Cupon {
  id: string;
  codigo: string;
  tipo: TipoCupon;
  porcentaje_descuento: number;
  edad_minima: number | null;
  edad_maxima: number | null;
  activo: boolean;
  fecha_desde: string;
  fecha_hasta: string | null;
  usos_maximos: number | null;
}

export interface CuponConUsos extends Cupon {
  /** Usos en compras confirmadas (las canceladas no cuentan). */
  usos: number;
}

export interface CuponFormValue {
  codigo: string;
  tipo: Exclude<TipoCupon, 'bienvenida'>;
  porcentaje: number;
  edadMinima: number | null;
  edadMaxima: number | null;
  fechaDesde: string;
  fechaHasta: string;
  usosMaximos: number | null;
  activo: boolean;
}

export interface Recompensa {
  id: string;
  nombre: string;
  costo_puntos: number;
  otorga_entrada: boolean;
  candy_producto_id: string | null;
  activo: boolean;
  productoNombre: string | null;
}

export interface RecompensaFormValue {
  nombre: string;
  costoPuntos: number;
  tipo: 'entrada' | 'producto';
  candyProductoId: string;
  activo: boolean;
}

/** Respuesta de la RPC consultar_descuento (vista previa del descuento). */
export interface DescuentoAplicable {
  origen: 'bienvenida' | 'cupon' | null;
  codigo: string | null;
  porcentaje: number;
  porcentaje_bienvenida: number;
  error_cupon: string | null;
}

export type MotivoPuntos = 'compra' | 'canje' | 'anulacion_compra' | 'devolucion_canje';

export interface MovimientoPuntos {
  id: string;
  puntos: number;
  motivo: MotivoPuntos;
  detalle: string | null;
  created_at: string;
  compraCodigoCorto: string | null;
}
