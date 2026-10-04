export interface FilaReporteDia {
  dia: string;
  compras: number;
  entradas: number;
  subtotal: number;
  descuentos: number;
  facturacion: number;
  credito: number;
  cobrado: number;
  candy: number;
  canceladas: number;
}

export interface ResumenReporte {
  compras: number;
  entradas: number;
  subtotal: number;
  descuentos: number;
  facturacion: number;
  credito: number;
  cobrado: number;
  candy: number;
  canceladas: number;
  ticketPromedio: number;
}

export interface ItemRanking {
  nombre: string;
  cantidad: number;
  recaudacion: number;
}

export interface ReporteFacturacion {
  desde: string;
  hasta: string;
  generado: string;
  resumen: ResumenReporte;
  porDia: FilaReporteDia[];
  peliculasSemana: ItemRanking[];
  peliculasMes: ItemRanking[];
  productos: ItemRanking[];
  combos: ItemRanking[];
}
