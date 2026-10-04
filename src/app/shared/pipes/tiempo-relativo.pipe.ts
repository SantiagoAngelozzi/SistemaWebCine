import { Pipe, PipeTransform } from '@angular/core';

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

@Pipe({ name: 'tiempoRelativo', standalone: true })
export class TiempoRelativoPipe implements PipeTransform {
  transform(valor: string | Date | null | undefined, ahora: Date = new Date()): string {
    if (!valor) return '';
    const fecha = valor instanceof Date ? valor : new Date(valor);
    if (isNaN(fecha.getTime())) return '';

    const diferencia = ahora.getTime() - fecha.getTime();
    if (diferencia < MINUTO) return 'hace un momento';
    if (diferencia < HORA) return plural(Math.floor(diferencia / MINUTO), 'minuto');
    if (diferencia < DIA) return plural(Math.floor(diferencia / HORA), 'hora');

    const dias = Math.floor(diferencia / DIA);
    if (dias === 1) return 'ayer';
    if (dias < 30) return plural(dias, 'día');

    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${fecha.getFullYear()}`;
  }
}

function plural(cantidad: number, unidad: string): string {
  return `hace ${cantidad} ${unidad}${cantidad === 1 ? '' : 's'}`;
}
