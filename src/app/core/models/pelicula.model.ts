export type IdiomaPelicula = 'castellano' | 'subtitulada';
export type ClasificacionEdad = 'ATP' | '+13' | '+18';
export type FormatoProyeccion = '2D' | '3D' | '4D' | '5D';

export interface Genero {
  id: string;
  nombre: string;
}

export interface Pelicula {
  id: string;
  nombre: string;
  sinopsis: string | null;
  imagen_url: string | null;
  duracion_minutos: number;
  idioma: IdiomaPelicula;
  clasificacion: ClasificacionEdad;
  fecha_estreno: string;
  precio_normal: number;
  precio_preventa: number | null;
  dias_preventa: number;
  activa: boolean;
  created_at: string;
}

// Pelicula "aplanada" con sus relaciones ya resueltas, lista para mostrar
// en el listado sin tener que andar navegando las tablas intermedias.
export interface PeliculaConRelaciones extends Pelicula {
  generoIds: string[];
  generoNombres: string[];
  formatos: FormatoProyeccion[];
}

export interface PeliculaFormValue {
  nombre: string;
  sinopsis: string;
  imagenUrl: string;
  duracionMinutos: number;
  idioma: IdiomaPelicula;
  clasificacion: ClasificacionEdad;
  fechaEstreno: string;
  precioNormal: number;
  precioPreventa: number | null;
  diasPreventa: number;
  activa: boolean;
}