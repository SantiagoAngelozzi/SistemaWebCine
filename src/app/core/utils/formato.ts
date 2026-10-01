/** Formatos de números y fechas compartidos por el dashboard, el PDF y el Excel. */

const FORMATO_MONEDA = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const FORMATO_ENTERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/** 12345.5 -> "$ 12.345,50" */
export function formatearMoneda(valor: number): string {
  return FORMATO_MONEDA.format(valor).replace(/ /g, ' ');
}

/** 12345.5 -> "$ 12.346" (para ejes y tarjetas donde no hacen falta centavos). */
export function formatearMonedaCorta(valor: number): string {
  return '$ ' + FORMATO_ENTERO.format(Math.round(valor));
}

/** 1234 -> "1.234" */
export function formatearEntero(valor: number): string {
  return FORMATO_ENTERO.format(valor);
}

/** Fecha de hoy en hora local como yyyy-mm-dd. */
export function hoyIso(): string {
  return fechaIso(new Date());
}

export function fechaIso(fecha: Date): string {
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mm}-${dd}`;
}

/** Suma días a una fecha yyyy-mm-dd (sin problemas de huso horario). */
export function sumarDias(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return fechaIso(new Date(anio, mes - 1, dia + dias));
}

/** "2026-10-01" -> Date local (sin corrimiento por UTC). */
export function parsearIso(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

/** "2026-10-01" -> "01/10" */
export function diaMes(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

/** ISO con hora -> "01/10/2026 16:35" (24 h, hora local). */
export function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${fecha.getFullYear()} ${hh}:${mi}`;
}
