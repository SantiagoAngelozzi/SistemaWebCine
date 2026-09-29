export interface FuncionParaCompra {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  formato: string;
  idioma: string;
  precio: number;
  sala_id: string;
  salaNombre: string;
  peliculaId: string;
  peliculaNombre: string;
  peliculaClasificacion: string;
  peliculaDuracion: number;
  peliculaFechaEstreno: string;
  peliculaDiasPreventa: number;
}

export interface CompraConfirmada {
  compra_id: string;
  codigo_qr: string;
  total: number;
}
