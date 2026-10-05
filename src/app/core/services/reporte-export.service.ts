import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';

import { ItemRanking, ReporteFacturacion } from '../models/reporte.model';
import { formatearFecha } from '../utils/pelicula-fechas';
import { diaMes, formatearEntero, formatearFechaHora, formatearMoneda, parsearIso } from '../utils/formato';
import { Celda, HojaXlsx, crearXlsx } from '../utils/xlsx';

const TINTA: [number, number, number] = [27, 26, 46];
const GRIS: [number, number, number] = [110, 110, 120];
const LINEA: [number, number, number] = [220, 218, 210];
const MAGENTA: [number, number, number] = [166, 51, 155];
const AMARILLO: [number, number, number] = [244, 208, 63];

interface ColumnaTabla {
  titulo: string;
  ancho: number;
  alinear?: 'left' | 'right';
}

@Injectable({ providedIn: 'root' })
export class ReporteExportService {

  exportarPdf(reporte: ReporteFacturacion): void {
    const pdf = new jsPDF({ format: 'a4', unit: 'mm' });
    const margen = 15;
    const anchoUtil = 210 - margen * 2;
    let y = 0;

    pdf.setFillColor(...TINTA);
    pdf.rect(0, 0, 210, 30, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.text('CineQuilmes', margen, 15);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.text('Reporte consolidado de facturación', margen, 23);
    pdf.setFontSize(9);
    pdf.text(`Período: ${formatearFecha(reporte.desde)} al ${formatearFecha(reporte.hasta)}`, 195, 15, {
      align: 'right'
    });
    pdf.text(`Generado: ${formatearFechaHora(reporte.generado)}`, 195, 23, { align: 'right' });
    y = 40;

    const r = reporte.resumen;
    const tarjetas: [string, string][] = [
      ['Facturación', formatearMoneda(r.facturacion)],
      ['Cobrado (sin crédito)', formatearMoneda(r.cobrado)],
      ['Entradas vendidas', formatearEntero(r.entradas)],
      ['Compras', formatearEntero(r.compras)],
      ['Ticket promedio', formatearMoneda(r.ticketPromedio)],
      ['Candy Bar', formatearMoneda(r.candy)],
      ['Descuentos', formatearMoneda(r.descuentos)],
      ['Compras canceladas', formatearEntero(r.canceladas)]
    ];
    const anchoTarjeta = (anchoUtil - 6) / 4;
    tarjetas.forEach(([etiqueta, valor], i) => {
      const x = margen + (i % 4) * (anchoTarjeta + 2);
      const yt = y + Math.floor(i / 4) * 20;
      pdf.setDrawColor(...TINTA);
      pdf.setFillColor(255, 255, 255);
      pdf.roundedRect(x, yt, anchoTarjeta, 17, 2, 2, 'FD');
      pdf.setTextColor(...GRIS);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.text(etiqueta, x + 3, yt + 6);
      pdf.setTextColor(...TINTA);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text(valor, x + 3, yt + 13);
    });
    y += 46;

    y = this.graficoFacturacionPdf(pdf, reporte, margen, y, anchoUtil);

    y = this.tituloSeccionPdf(pdf, 'Detalle por día', margen, y);
    const columnasDia: ColumnaTabla[] = [
      { titulo: 'Fecha', ancho: 22 },
      { titulo: 'Compras', ancho: 17, alinear: 'right' },
      { titulo: 'Entradas', ancho: 18, alinear: 'right' },
      { titulo: 'Candy Bar', ancho: 25, alinear: 'right' },
      { titulo: 'Descuentos', ancho: 25, alinear: 'right' },
      { titulo: 'Facturación', ancho: 27, alinear: 'right' },
      { titulo: 'Crédito', ancho: 21, alinear: 'right' },
      { titulo: 'Cobrado', ancho: 25, alinear: 'right' }
    ];
    const filasDia = reporte.porDia.map((d) => [
      formatearFecha(d.dia),
      formatearEntero(d.compras),
      formatearEntero(d.entradas),
      formatearMoneda(d.candy),
      formatearMoneda(d.descuentos),
      formatearMoneda(d.facturacion),
      formatearMoneda(d.credito),
      formatearMoneda(d.cobrado)
    ]);
    const totales = [
      'Total',
      formatearEntero(r.compras),
      formatearEntero(r.entradas),
      formatearMoneda(r.candy),
      formatearMoneda(r.descuentos),
      formatearMoneda(r.facturacion),
      formatearMoneda(r.credito),
      formatearMoneda(r.cobrado)
    ];
    y = this.tablaPdf(pdf, columnasDia, filasDia, margen, y, totales);

    y = this.rankingPdf(pdf, 'Películas más vistas - últimos 7 días', 'Entradas', reporte.peliculasSemana, margen, y);
    y = this.rankingPdf(pdf, 'Películas más vistas - últimos 30 días', 'Entradas', reporte.peliculasMes, margen, y);
    y = this.rankingPdf(pdf, 'Productos del Candy Bar más vendidos', 'Unidades', reporte.productos, margen, y);
    this.rankingPdf(pdf, 'Combos más vendidos', 'Unidades', reporte.combos, margen, y);

    const paginas = pdf.getNumberOfPages();
    for (let i = 1; i <= paginas; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(...GRIS);
      pdf.text('Compras no canceladas, por fecha de compra. Cobrado = Facturación - Crédito usado.', margen, 289);
      pdf.text(`Página ${i} de ${paginas}`, 195, 289, { align: 'right' });
    }

    pdf.save(`reporte-facturacion-${reporte.desde}-al-${reporte.hasta}.pdf`);
  }

  private tituloSeccionPdf(pdf: jsPDF, titulo: string, x: number, y: number): number {
    y = this.saltoSiHaceFalta(pdf, y, 22);
    pdf.setTextColor(...TINTA);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(titulo, x, y);
    return y + 5;
  }

  private saltoSiHaceFalta(pdf: jsPDF, y: number, alto: number): number {
    if (y + alto > 280) {
      pdf.addPage();
      return 18;
    }
    return y;
  }

  private graficoFacturacionPdf(
    pdf: jsPDF,
    reporte: ReporteFacturacion,
    x: number,
    y: number,
    ancho: number
  ): number {
    y = this.tituloSeccionPdf(pdf, 'Facturación diaria', x, y);
    const alto = 45;
    const dias = reporte.porDia;
    const maximo = Math.max(...dias.map((d) => d.facturacion), 0);

    pdf.setDrawColor(...LINEA);
    pdf.setLineWidth(0.2);
    pdf.line(x, y + alto, x + ancho, y + alto);

    if (!dias.length || maximo === 0) {
      pdf.setTextColor(...GRIS);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text('Sin ventas en el período.', x + ancho / 2, y + alto / 2, { align: 'center' });
      return y + alto + 12;
    }

    const espacio = ancho / dias.length;
    const anchoColumna = Math.min(8, espacio * 0.7);
    const cadaCuanto = Math.ceil(dias.length / 15);
    pdf.setFillColor(...MAGENTA);
    dias.forEach((d, i) => {
      const altoColumna = (d.facturacion / maximo) * (alto - 6);
      const cx = x + i * espacio + (espacio - anchoColumna) / 2;
      if (altoColumna > 0) pdf.rect(cx, y + alto - altoColumna, anchoColumna, altoColumna, 'F');
      if (i % cadaCuanto === 0) {
        pdf.setTextColor(...GRIS);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.5);
        pdf.text(diaMes(d.dia), cx + anchoColumna / 2, y + alto + 4, { align: 'center' });
      }
    });

    const mejor = dias.reduce((a, b) => (b.facturacion > a.facturacion ? b : a));
    const iMejor = dias.indexOf(mejor);
    pdf.setTextColor(...TINTA);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.text(formatearMoneda(mejor.facturacion), x + iMejor * espacio + espacio / 2, y + 4, {
      align: iMejor > dias.length * 0.8 ? 'right' : 'center'
    });
    return y + alto + 12;
  }

  private tablaPdf(
    pdf: jsPDF,
    columnas: ColumnaTabla[],
    filas: string[][],
    x: number,
    y: number,
    totales?: string[]
  ): number {
    const altoFila = 6;
    const anchoTotal = columnas.reduce((suma, c) => suma + c.ancho, 0);

    const encabezado = (yy: number) => {
      pdf.setFillColor(...AMARILLO);
      pdf.rect(x, yy - 4.2, anchoTotal, altoFila, 'F');
      pdf.setTextColor(...TINTA);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      this.filaPdf(pdf, columnas, columnas.map((c) => c.titulo), x, yy);
      return yy + altoFila;
    };

    y = encabezado(y + 2);
    pdf.setFont('helvetica', 'normal');
    for (const fila of filas) {
      if (y > 278) {
        pdf.addPage();
        y = encabezado(22);
        pdf.setFont('helvetica', 'normal');
      }
      pdf.setTextColor(...TINTA);
      pdf.setFontSize(8);
      this.filaPdf(pdf, columnas, fila, x, y);
      pdf.setDrawColor(...LINEA);
      pdf.setLineWidth(0.1);
      pdf.line(x, y + 1.8, x + anchoTotal, y + 1.8);
      y += altoFila;
    }

    if (totales) {
      y = this.saltoSiHaceFalta(pdf, y, altoFila);
      pdf.setDrawColor(...TINTA);
      pdf.setLineWidth(0.4);
      pdf.line(x, y - 4.2, x + anchoTotal, y - 4.2);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      this.filaPdf(pdf, columnas, totales, x, y);
      y += altoFila;
    }
    return y + 8;
  }

  private filaPdf(pdf: jsPDF, columnas: ColumnaTabla[], valores: string[], x: number, y: number): void {
    let cx = x;
    columnas.forEach((columna, i) => {
      const texto = valores[i] ?? '';
      if (columna.alinear === 'right') {
        pdf.text(texto, cx + columna.ancho - 1.5, y, { align: 'right' });
      } else {
        pdf.text(pdf.splitTextToSize(texto, columna.ancho - 2)[0] ?? '', cx + 1.5, y);
      }
      cx += columna.ancho;
    });
  }

  private rankingPdf(
    pdf: jsPDF,
    titulo: string,
    etiquetaCantidad: string,
    items: ItemRanking[],
    x: number,
    y: number
  ): number {
    y = this.tituloSeccionPdf(pdf, titulo, x, y);
    if (!items.length) {
      pdf.setTextColor(...GRIS);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text('Sin ventas en el período.', x, y + 2);
      return y + 10;
    }
    return this.tablaPdf(
      pdf,
      [
        { titulo: '#', ancho: 10 },
        { titulo: 'Nombre', ancho: 100 },
        { titulo: etiquetaCantidad, ancho: 30, alinear: 'right' },
        { titulo: 'Recaudación', ancho: 40, alinear: 'right' }
      ],
      items.map((item, i) => [
        String(i + 1),
        item.nombre,
        formatearEntero(item.cantidad),
        formatearMoneda(item.recaudacion)
      ]),
      x,
      y
    );
  }

  exportarXlsx(reporte: ReporteFacturacion): void {
    const r = reporte.resumen;
    const periodo = `Período: ${formatearFecha(reporte.desde)} al ${formatearFecha(reporte.hasta)} · generado ${formatearFechaHora(
      reporte.generado
    )}`;

    const resumen: HojaXlsx = {
      nombre: 'Resumen',
      anchos: [32, 20],
      filas: [
        [{ valor: 'Reporte consolidado de facturación', estilo: 'titulo' }],
        [{ valor: periodo, estilo: 'subtitulo' }],
        [],
        [
          { valor: 'Indicador', estilo: 'encabezado' },
          { valor: 'Valor', estilo: 'encabezado' }
        ],
        ['Facturación', { valor: r.facturacion, estilo: 'moneda' }],
        ['Crédito en cuenta usado', { valor: r.credito, estilo: 'moneda' }],
        ['Cobrado (facturación - crédito)', { valor: r.cobrado, estilo: 'moneda' }],
        ['Descuentos otorgados', { valor: r.descuentos, estilo: 'moneda' }],
        ['Candy Bar', { valor: r.candy, estilo: 'moneda' }],
        ['Compras', { valor: r.compras, estilo: 'entero' }],
        ['Entradas vendidas', { valor: r.entradas, estilo: 'entero' }],
        ['Ticket promedio', { valor: r.ticketPromedio, estilo: 'moneda' }],
        ['Compras canceladas', { valor: r.canceladas, estilo: 'entero' }],
        [],
        [
          {
            valor: 'Se cuentan las compras no canceladas por fecha de compra (hora argentina).',
            estilo: 'subtitulo'
          }
        ]
      ]
    };

    const porDia: HojaXlsx = {
      nombre: 'Por día',
      anchos: [12, 10, 10, 14, 14, 14, 14, 14, 14, 12],
      filas: [
        [
          'Fecha',
          'Compras',
          'Entradas',
          'Subtotal',
          'Descuentos',
          'Facturación',
          'Crédito usado',
          'Cobrado',
          'Candy Bar',
          'Canceladas'
        ].map((titulo): Celda => ({ valor: titulo, estilo: 'encabezado' })),
        ...reporte.porDia.map((d): Celda[] => [
          parsearIso(d.dia),
          { valor: d.compras, estilo: 'entero' },
          { valor: d.entradas, estilo: 'entero' },
          { valor: d.subtotal, estilo: 'moneda' },
          { valor: d.descuentos, estilo: 'moneda' },
          { valor: d.facturacion, estilo: 'moneda' },
          { valor: d.credito, estilo: 'moneda' },
          { valor: d.cobrado, estilo: 'moneda' },
          { valor: d.candy, estilo: 'moneda' },
          { valor: d.canceladas, estilo: 'entero' }
        ]),
        [
          { valor: 'Total', estilo: 'total' },
          { valor: r.compras, estilo: 'total-entero' },
          { valor: r.entradas, estilo: 'total-entero' },
          { valor: r.subtotal, estilo: 'total-moneda' },
          { valor: r.descuentos, estilo: 'total-moneda' },
          { valor: r.facturacion, estilo: 'total-moneda' },
          { valor: r.credito, estilo: 'total-moneda' },
          { valor: r.cobrado, estilo: 'total-moneda' },
          { valor: r.candy, estilo: 'total-moneda' },
          { valor: r.canceladas, estilo: 'total-entero' }
        ]
      ]
    };

    const hojaRanking = (nombre: string, etiqueta: string, secciones: [string, ItemRanking[]][]): HojaXlsx => {
      const filas: Celda[][] = [];
      for (const [titulo, items] of secciones) {
        filas.push([{ valor: titulo, estilo: 'titulo' }]);
        filas.push(
          ['#', 'Nombre', etiqueta, 'Recaudación'].map((t): Celda => ({ valor: t, estilo: 'encabezado' }))
        );
        if (!items.length) filas.push(['', 'Sin ventas en el período']);
        items.forEach((item, i) =>
          filas.push([
            i + 1,
            item.nombre,
            { valor: item.cantidad, estilo: 'entero' },
            { valor: item.recaudacion, estilo: 'moneda' }
          ])
        );
        filas.push([]);
      }
      return { nombre, anchos: [5, 40, 12, 16], filas };
    };

    const blob = crearXlsx([
      resumen,
      porDia,
      hojaRanking('Películas', 'Entradas', [
        [`Más vistas: últimos 7 días al ${formatearFecha(reporte.hasta)}`, reporte.peliculasSemana],
        [`Más vistas: últimos 30 días al ${formatearFecha(reporte.hasta)}`, reporte.peliculasMes]
      ]),
      hojaRanking('Candy Bar', 'Unidades', [
        ['Productos más vendidos (incluye los de combos)', reporte.productos],
        ['Combos más vendidos', reporte.combos]
      ])
    ]);
    this.descargarBlob(blob, `reporte-facturacion-${reporte.desde}-al-${reporte.hasta}.xlsx`);
  }

  private descargarBlob(blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
