import { ClasificacionEdad } from './pelicula.model';

export interface ResenaPublica {
  id: string;
  calificacion: number;
  comentario: string | null;
  creadaEl: string;
  editada: boolean;
  autor: string;
  esMia: boolean;
}

export interface ResumenResenas {
  promedio: number;
  cantidad: number;
  distribucion: number[];
  resenas: ResenaPublica[];
  puedeResenar: boolean;
}

export interface FuncionVista {
  fecha: string;
  horaInicio: string;
  sala: string;
  formato: string;
}

export interface MiPelicula {
  peliculaId: string;
  nombre: string;
  imagenUrl: string | null;
  clasificacion: ClasificacionEdad;
  duracionMinutos: number;
  veces: number;
  funciones: FuncionVista[];
  calificacion: number | null;
  comentario: string | null;
}
