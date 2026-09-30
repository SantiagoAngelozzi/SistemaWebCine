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

/** Ítem del carrito de Candy Bar que se envía a la RPC (sin precios). */
export interface ItemCandySeleccionado {
  tipo: TipoItemCandy;
  id: string;
  cantidad: number;
}

/** Entrada tal como quedó registrada en la base. */
export interface EntradaConfirmada {
  butaca_id: string;
  ubicacion: string;
  tipo: TipoButaca;
  precio: number;
  incluida_en_combo: boolean;
}

/** Ítem de Candy Bar tal como quedó registrado en la base. */
export interface CandyConfirmado {
  tipo: TipoItemCandy;
  id: string;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  incluye_entrada: boolean;
}

export interface CompraConfirmada {
  compra_id: string;
  codigo_qr: string;
  /** Código de 8 caracteres para carga manual si falla el lector. */
  codigo_corto: string;
  total: number;
  /** Parte del total pagada con crédito en cuenta. */
  credito_usado: number;
  /** Lo que se abona con otros medios: total - credito_usado. */
  a_pagar: number;
  entradas: EntradaConfirmada[];
  candy: CandyConfirmado[];
}
