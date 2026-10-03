import { Pelicula } from '../models/pelicula.model';

export type EstadoVenta = 'en_cartelera' | 'preventa' | 'proximamente';

type DatosFechas = Pick<Pelicula, 'fecha_estreno' | 'dias_preventa'>;
type DatosPrecio = DatosFechas & Pick<Pelicula, 'precio_normal' | 'precio_preventa'>;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

function parsearFechaLocal(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

function hoy(): Date {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
}

function formatearDate(fecha: Date): string {
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${fecha.getFullYear()}`;
}

export function diasHastaEstreno(fechaEstreno: string): number {
  return Math.round((parsearFechaLocal(fechaEstreno).getTime() - hoy().getTime()) / MS_POR_DIA);
}

export function estadoVenta(pelicula: DatosFechas): EstadoVenta {
  const dias = diasHastaEstreno(pelicula.fecha_estreno);
  if (dias <= 0) return 'en_cartelera';
  if (dias <= pelicula.dias_preventa) return 'preventa';
  return 'proximamente';
}

export function precioVigente(pelicula: DatosPrecio): number {
  return estadoVenta(pelicula) === 'preventa' && pelicula.precio_preventa != null
    ? pelicula.precio_preventa
    : pelicula.precio_normal;
}

export function formatearFecha(iso: string): string {
  return formatearDate(parsearFechaLocal(iso));
}

export function fechaAperturaVenta(pelicula: DatosFechas): string {
  const fecha = parsearFechaLocal(pelicula.fecha_estreno);
  fecha.setDate(fecha.getDate() - pelicula.dias_preventa);
  return formatearDate(fecha);
}

/** Fecha y hora de inicio de una función ("2026-10-03" + "18:30:00") en hora local. */
export function inicioFuncion(fecha: string, horaInicio: string): Date {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const [hora, minuto] = horaInicio.split(':').map(Number);
  return new Date(anio, mes - 1, dia, hora, minuto);
}

/** true si la función ya empezó: no se le pueden vender entradas (la base también lo controla). */
export function funcionYaComenzo(fecha: string, horaInicio: string): boolean {
  return inicioFuncion(fecha, horaInicio).getTime() <= Date.now();
}
