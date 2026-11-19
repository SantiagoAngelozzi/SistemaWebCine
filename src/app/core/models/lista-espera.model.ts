export type EstadoListaEspera = 'esperando' | 'notificado' | 'compro' | 'expirado' | 'salio' | 'cancelada';

export interface EstadoEsperaFuncion {
  funcionId: string;
  agotada: boolean;
  enEspera: number;
  miEstado: 'esperando' | 'notificado' | null;
  miPosicion: number | null;
  miExpiraAt: string | null;
}

export interface MiListaEspera {
  id: string;
  funcionId: string;
  peliculaId: string;
  pelicula: string;
  imagenUrl: string | null;
  sala: string;
  fecha: string;
  horaInicio: string;
  formato: string;
  estado: EstadoListaEspera;
  posicion: number | null;
  expiraAt: string | null;
  butaca: string | null;
  anotadoEl: string;
}

export interface ReservasListaEspera {
  reservadas: string[];
  mia: { butacaId: string; ubicacion: string; expiraAt: string } | null;
}
