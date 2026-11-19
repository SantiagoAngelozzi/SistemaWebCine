import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';

import { Notificacion } from '../../core/models/notificacion.model';
import { TiempoRelativoPipe } from '../pipes/tiempo-relativo.pipe';

@Component({
  selector: 'app-campana-notificaciones',
  standalone: true,
  imports: [CommonModule, TiempoRelativoPipe],
  templateUrl: './campana-notificaciones.component.html',
  styleUrl: './campana-notificaciones.component.scss'
})
export class CampanaNotificacionesComponent {
  private elemento: ElementRef<HTMLElement> = inject(ElementRef);

  @Input({ required: true }) notificaciones: Notificacion[] = [];
  @Input() noLeidas = 0;
  @Input() puedeActivarAvisos = false;

  @Output() abrirNotificacion = new EventEmitter<Notificacion>();
  @Output() marcarTodas = new EventEmitter<void>();
  @Output() activarAvisos = new EventEmitter<void>();

  abierta = signal(false);

  alternar(): void {
    this.abierta.update((valor) => !valor);
  }

  elegir(notificacion: Notificacion): void {
    this.abierta.set(false);
    this.abrirNotificacion.emit(notificacion);
  }

  @HostListener('document:click', ['$event'])
  alHacerClickAfuera(evento: MouseEvent): void {
    if (this.abierta() && !this.elemento.nativeElement.contains(evento.target as Node)) {
      this.abierta.set(false);
    }
  }
}
