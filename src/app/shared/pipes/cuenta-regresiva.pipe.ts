import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'cuentaRegresiva', standalone: true })
export class CuentaRegresivaPipe implements PipeTransform {
  transform(milisegundos: number | null | undefined): string {
    if (milisegundos == null || milisegundos <= 0) return '00:00';
    const totalSegundos = Math.floor(milisegundos / 1000);
    const minutos = Math.floor(totalSegundos / 60);
    const segundos = totalSegundos % 60;
    return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
  }
}
