/** Una fila del reporte por día (compras no canceladas, fecha de compra en hora argentina). */
export interface FilaReporteDia {
  /** yyyy-mm-dd */
  dia: string;
  compras: number;
  entradas: number;
  subtotal: number;
  descuentos: number;
  /** Total de las compras (con descuento, incluye lo pagado con crédito). */
  facturacion: number;
  credito: number;
  /** Facturación menos crédito usado: dinero nuevo del día. */
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

/** Película, producto o combo dentro de un ranking. */
export interface ItemRanking {
  nombre: string;
  /** Entradas (películas) o unidades (productos y combos). */
  cantidad: number;
  recaudacion: number;
}

export interface ReporteFacturacion {
  desde: string;
  hasta: string;
  generado: string;
  resumen: ResumenReporte;
  porDia: FilaReporteDia[];
  /** Últimos 7 días hasta la fecha "hasta". */
  peliculasSemana: ItemRanking[];
  /** Últimos 30 días hasta la fecha "hasta". */
  peliculasMes: ItemRanking[];
  productos: ItemRanking[];
  combos: ItemRanking[];
}
