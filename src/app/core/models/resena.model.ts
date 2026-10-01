import { ClasificacionEdad } from './pelicula.model';

/** Reseña tal como se muestra en la ficha pública (autor reducido a "Nombre A."). */
export interface ResenaPublica {
  id: string;
  calificacion: number;
  comentario: string | null;
  creadaEl: string;
  editada: boolean;
  autor: string;
  esMia: boolean;
}

/** Todo lo que necesita la ficha de una película para la sección de reseñas. */
export interface ResumenResenas {
  promedio: number;
  cantidad: number;
  /** Cantidad de reseñas con 1, 2, 3, 4 y 5 estrellas (índice 0 = 1 estrella). */
  distribucion: number[];
  resenas: ResenaPublica[];
  /** true si el usuario logueado ya vio la película y puede calificarla. */
  puedeResenar: boolean;
}

export interface FuncionVista {
  fecha: string;
  horaInicio: string;
  sala: string;
  formato: string;
}

/** Una tarjeta de "Mis Películas". */
export interface MiPelicula {
  peliculaId: string;
  nombre: string;
  imagenUrl: string | null;
  clasificacion: ClasificacionEdad;
  duracionMinutos: number;
  /** Cuántas veces la vio (compras distintas). */
  veces: number;
  /** Funciones vistas, la más reciente primero. */
  funciones: FuncionVista[];
  calificacion: number | null;
  comentario: string | null;
}
