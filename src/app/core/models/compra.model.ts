import { TipoButaca } from './sala.model';

export interface FuncionParaCompra {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  formato: string;
  idioma: string;
  precio: number;
  sala_id: string;
  salaNombre: string;
  peliculaId: string;
  peliculaNombre: string;
  peliculaClasificacion: string;
  peliculaDuracion: number;
  peliculaFechaEstreno: string;
  peliculaDiasPreventa: number;
}

export type TipoItemCandy = 'producto' | 'combo';

export interface CanjeSeleccionado {
  id: string;
  cantidad: number;
}

export interface ItemCandySeleccionado {
  tipo: TipoItemCandy;
  id: string;
  cantidad: number;
}

export interface EntradaConfirmada {
  butaca_id: string;
  ubicacion: string;
  tipo: TipoButaca;
  precio: number;
  incluida_en_combo: boolean;
  canjeada_con_puntos: boolean;
}

export interface CandyConfirmado {
  tipo: TipoItemCandy;
  id: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  incluye_entrada: boolean;
  canje: boolean;
}

export interface CompraConfirmada {
  compra_id: string;
  codigo_qr: string;
  codigo_corto: string;
  subtotal: number;
  descuento_origen: 'bienvenida' | 'cupon' | null;
  descuento_codigo: string | null;
  descuento_porcentaje: number;
  descuento_monto: number;
  total: number;
  credito_usado: number;
  a_pagar: number;
  puntos_ganados: number;
  puntos_canjeados: number;
  entradas: EntradaConfirmada[];
  candy: CandyConfirmado[];
}
