import { Injectable } from '@angular/core';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

export interface EntradaComprobante {
  ubicacion: string;
  tipo: 'estandar' | 'accesible' | 'vip';
  precio: number;
  /** La entrada está cubierta por un combo "entrada + candy". */
  incluidaEnCombo?: boolean;
}

export interface ProductoComprobante {
  nombre: string;
  cantidad: number;
  precio: number;
}

export interface DatosComprobante {
  codigoQr: string;
  /** Código corto (ya formateado, ej. K7F3-9QXM) para carga manual. */
  codigoCorto?: string;
  pelicula: string;
  sala: string;
  fecha: string;
  hora: string;
  formato: string;
  idioma: string;
  entradas: EntradaComprobante[];
  productos?: ProductoComprobante[];
  total: number;
  /** Crédito en cuenta aplicado al pago (si hubo). */
  creditoUsado?: number;
  advertenciaEdad?: string;
}

@Injectable({ providedIn: 'root' })
export class ComprobantePdfService {
  async descargar(datos: DatosComprobante): Promise<void> {
    const pdf = new jsPDF({ format: 'a4', unit: 'mm' });
    const qr = await QRCode.toDataURL(datos.codigoQr, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 360,
      color: { dark: '#10131b', light: '#ffffff' }
    });

    const margen = 18;
    let y = 22;

    pdf.setFillColor(16, 19, 27);
    pdf.rect(0, 0, 210, 32, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(22);
    pdf.text('CINE', margen, 20);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Comprobante digital de compra', margen, 27);

    pdf.addImage(qr, 'PNG', 147, 40, 45, 45);
    pdf.setTextColor(16, 19, 27);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.text(datos.pelicula, margen, y + 22, { maxWidth: 120 });
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`Sala: ${datos.sala}`, margen, y + 32);
    pdf.text(`Funcion: ${datos.fecha} - ${datos.hora}`, margen, y + 39);
    pdf.text(`${datos.formato} - ${datos.idioma}`, margen, y + 46);
    if (datos.codigoCorto) {
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(15);
      pdf.text(datos.codigoCorto, 169.5, 91, { align: 'center' });
      pdf.setFont('helvetica', 'normal');
    }
    pdf.setFontSize(8);
    pdf.text('Presenta este QR para ingresar a la sala y retirar productos de Candy Bar.', 169.5, datos.codigoCorto ? 97 : 89, {
      maxWidth: 45,
      align: 'center'
    });
    y = datos.codigoCorto ? 91 : 83;

    if (datos.advertenciaEdad) {
      pdf.setFillColor(255, 244, 214);
      pdf.roundedRect(margen, y, 156, 15, 2, 2, 'F');
      pdf.setTextColor(117, 76, 0);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.text(datos.advertenciaEdad, margen + 4, y + 6, { maxWidth: 148 });
      y += 22;
    } else {
      y += 10;
    }

    y = this.dibujarSeccion(pdf, 'ENTRADAS', y);
    for (const entrada of datos.entradas) {
      const etiquetaTipo = entrada.tipo === 'vip' ? 'VIP' : entrada.tipo === 'accesible' ? 'Accesible' : 'Estandar';
      const detalle = entrada.incluidaEnCombo
        ? entrada.tipo === 'vip'
          ? ' - incluida en combo (recargo VIP)'
          : ' - incluida en combo'
        : '';
      y = this.dibujarFila(pdf, `${entrada.ubicacion} (${etiquetaTipo})${detalle}`, entrada.precio, y);
    }

    if (datos.productos?.length) {
      y += 4;
      y = this.saltoDePaginaSiHaceFalta(pdf, y, 20);
      y = this.dibujarSeccion(pdf, 'CANDY BAR', y);
      for (const producto of datos.productos) {
        y = this.dibujarFila(pdf, `${producto.cantidad} x ${producto.nombre}`, producto.precio * producto.cantidad, y);
      }
    }

    y += 8;
    y = this.saltoDePaginaSiHaceFalta(pdf, y, 20);
    pdf.setDrawColor(210, 215, 225);
    pdf.line(margen, y, 192, y);
    y += 9;
    pdf.setTextColor(16, 19, 27);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('TOTAL', margen, y);
    pdf.text(this.formatearImporte(datos.total), 192, y, { align: 'right' });

    if (datos.creditoUsado && datos.creditoUsado > 0) {
      y += 8;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text('Credito en cuenta aplicado', margen, y);
      pdf.text(`-${this.formatearImporte(datos.creditoUsado)}`, 192, y, { align: 'right' });
      y += 6;
      pdf.text('Abonado con otros medios', margen, y);
      pdf.text(this.formatearImporte(Math.max(0, datos.total - datos.creditoUsado)), 192, y, { align: 'right' });
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(92, 99, 112);
    pdf.text(`Codigo unico: ${datos.codigoQr}`, margen, 278);
    pdf.text('Conserva este comprobante hasta finalizar la funcion.', 192, 278, { align: 'right' });

    pdf.save(`comprobante-${this.nombreSeguro(datos.codigoQr)}.pdf`);
  }

  private dibujarSeccion(pdf: jsPDF, titulo: string, y: number): number {
    pdf.setFillColor(25, 118, 210);
    pdf.roundedRect(18, y, 174, 8, 2, 2, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text(titulo, 22, y + 5.3);
    return y + 14;
  }

  private dibujarFila(pdf: jsPDF, descripcion: string, importe: number, y: number): number {
    pdf.setTextColor(16, 19, 27);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    // Los combos pueden tener descripciones largas: se parten en varias líneas.
    const lineas: string[] = pdf.splitTextToSize(descripcion, 135);
    y = this.saltoDePaginaSiHaceFalta(pdf, y, lineas.length * 5 + 2);
    pdf.text(lineas, 22, y);
    pdf.text(this.formatearImporte(importe), 188, y, { align: 'right' });
    return y + 2 + lineas.length * 5;
  }

  /** Agrega una página si lo que sigue no entra antes del pie (y = 270 mm). */
  private saltoDePaginaSiHaceFalta(pdf: jsPDF, y: number, alto: number): number {
    if (y + alto <= 270) return y;
    pdf.addPage();
    return 22;
  }

  private formatearImporte(valor: number): string {
    return `$${valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private nombreSeguro(valor: string): string {
    return valor.replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 36);
  }
}
