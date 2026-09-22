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
  precio: number;
  created_by: string | null;
  created_at: string;
}

export interface FuncionConDetalle extends Funcion {
  peliculaNombre: string;
  salaNombre: string;
}

export interface FuncionFormValue {
  peliculaId: string;
  fecha: string;
  horaInicio: string;
  formato: FormatoProyeccion;
  idioma: IdiomaPelicula;
  precio: number;
}