import { ClasificacionEdad } from './pelicula.model';
import { TipoButaca } from './sala.model';

export interface PerfilUsuario {
  id: string;
  email: string;
  nombre: string | null;
  apellido: string | null;
  fecha_nacimiento: string | null;
  credito: number;
  puntos: number;
}

export type EstadoMiCompra = 'confirmada' | 'cancelada' | 'utilizada' | 'finalizada';

export interface EntradaMiCompra {
  ubicacion: string;
  tipo: TipoButaca;
  precio: number;
  incluidaEnCombo: boolean;
}

export interface CandyMiCompra {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  esCombo: boolean;
  /** Para combos: "1x Pochoclo grande, 1x Gaseosa". */
  contenido: string;
  incluyeEntrada: boolean;
}

/** Una compra del usuario, lista para mostrar en "Mis compras". */
export interface MiCompra {
  id: string;
  codigoQr: string;
  codigoCorto: string;
  total: number;
  creditoUsado: number;
  estadoBase: 'confirmada' | 'cancelada';
  estado: EstadoMiCompra;
  creadaEl: string;
  canceladaEl: string | null;
  entradaValidada: boolean;
  candyEntregado: boolean;
  pelicula: string;
  clasificacion: ClasificacionEdad;
  imagenUrl: string | null;
  sala: string;
  fecha: string;
  horaInicio: string;
  formato: string;
  idioma: string;
  /** Inicio de la función en hora local del navegador. */
  inicio: Date;
  entradas: EntradaMiCompra[];
  candy: CandyMiCompra[];
  /** Si se puede cancelar ahora (la base vuelve a validarlo). */
  cancelable: boolean;
  /** Por qué no se puede cancelar, si no se puede. */
  motivoNoCancelable: string | null;
}

export interface MovimientoCredito {
  id: string;
  monto: number;
  motivo: 'cancelacion' | 'uso_en_compra';
  created_at: string;
  compraCodigoCorto: string | null;
}

export interface ResultadoCancelacion {
  compra_id: string;
  credito_otorgado: number;
  credito_total: number;
}
