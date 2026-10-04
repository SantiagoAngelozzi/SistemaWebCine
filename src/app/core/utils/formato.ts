const FORMATO_MONEDA = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const FORMATO_ENTERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export function formatearMoneda(valor: number): string {
  return FORMATO_MONEDA.format(valor).replace(/ /g, ' ');
}

export function formatearMonedaCorta(valor: number): string {
  return '$ ' + FORMATO_ENTERO.format(Math.round(valor));
}

export function formatearEntero(valor: number): string {
  return FORMATO_ENTERO.format(valor);
}

export function hoyIso(): string {
  return fechaIso(new Date());
}

export function fechaIso(fecha: Date): string {
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mm}-${dd}`;
}

export function sumarDias(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return fechaIso(new Date(anio, mes - 1, dia + dias));
}

export function parsearIso(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

export function diaMes(iso: string): string {
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

export function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso);
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mi = String(fecha.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${fecha.getFullYear()} ${hh}:${mi}`;
}
