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
  canjeadaConPuntos: boolean;
}

export interface CandyMiCompra {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  esCombo: boolean;
  contenido: string;
  incluyeEntrada: boolean;
  canje: boolean;
}

export interface MiCompra {
  id: string;
  codigoQr: string;
  codigoCorto: string;
  total: number;
  descuentoPorcentaje: number;
  descuentoMonto: number;
  creditoUsado: number;
  puntosGanados: number;
  puntosCanjeados: number;
  estadoBase: 'confirmada' | 'cancelada';
  estado: EstadoMiCompra;
  creadaEl: string;
  canceladaEl: string | null;
  entradaValidada: boolean;
  candyEntregado: boolean;
  soloCandy: boolean;
  pelicula: string;
  clasificacion: ClasificacionEdad;
  imagenUrl: string | null;
  sala: string;
  fecha: string;
  horaInicio: string;
  formato: string;
  idioma: string;
  inicio: Date;
  entradas: EntradaMiCompra[];
  candy: CandyMiCompra[];
  cancelable: boolean;
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
  puntos_revertidos: number;
  puntos_devueltos: number;
}
