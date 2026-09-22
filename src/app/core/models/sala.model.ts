export type TipoButaca = 'estandar' | 'accesible' | 'vip';

export interface Sala {
  id: string;
  nombre: string;
}

export interface SalaConCantidadButacas extends Sala {
  cantidadButacas: number;
}

export interface Butaca {
  id: string;
  sala_id: string;
  fila: string;
  columna: number;
  tipo: TipoButaca;
}