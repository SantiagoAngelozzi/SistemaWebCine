export type EstadoPropuesta = 'pendiente' | 'aceptada' | 'rechazada';

export interface PropuestaPelicula {
  id: string;
  titulo: string;
  descripcion: string;
  motivo: string;
  estado: EstadoPropuesta;
  peliculaId: string | null;
  creadaEl: string;
  resueltaEl: string | null;
  autor: string | null;
}

export interface PropuestaFormValue {
  titulo: string;
  descripcion: string;
  motivo: string;
}
