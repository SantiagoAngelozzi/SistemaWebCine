import { FormatoProyeccion, IdiomaPelicula } from './pelicula.model';

export interface Funcion {
  id: string;
  pelicula_id: string;
  sala_id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  formato: FormatoProyeccion;
  idioma: IdiomaPelicula;
  created_by: string | null;
  created_at: string;
  estado: EstadoFuncion;
  motivo_cancelacion: string | null;
}

export type EstadoFuncion = 'activa' | 'cancelada';

export interface FuncionDePelicula extends Funcion {
  salaNombre: string;
}

export interface FuncionConDetalle extends Funcion {
  peliculaNombre: string;
  salaNombre: string;
  precioVigente: number;
  entradasVendidas: number;
  tieneCompras: boolean;
  enEspera: number;
}

export interface ResumenCancelacion {
  compras: number;
  entradas: number;
  creditoADevolver: number;
  comprasSinCuenta: number;
}

export interface ResultadoCancelacionFuncion {
  compras: number;
  entradas: number;
  creditoDevuelto: number;
  comprasSinCuenta: number;
}

export interface FuncionFormValue {
  peliculaId: string;
  fecha: string;
  horaInicio: string;
  formato: FormatoProyeccion;
  idioma: IdiomaPelicula;
}
