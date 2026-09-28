import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PeliculaConRelaciones } from '../../core/models/pelicula.model';
import {
  EstadoVenta,
  estadoVenta,
  fechaAperturaVenta,
  formatearFecha,
  precioVigente
} from '../../core/utils/pelicula-fechas';

@Component({
  selector: 'app-pelicula-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pelicula-card.component.html',
  styleUrl: './pelicula-card.component.scss'
})
export class PeliculaCardComponent {
  @Input({ required: true }) pelicula!: PeliculaConRelaciones;
  @Input() modo: 'cartelera' | 'proximamente' = 'cartelera';
  @Input() alertaActiva = false;

  @Output() alertaCambiada = new EventEmitter<PeliculaConRelaciones>();

  get estado(): EstadoVenta {
    return estadoVenta(this.pelicula);
  }

  get precio(): number {
    return precioVigente(this.pelicula);
  }

  get fechaEstreno(): string {
    return formatearFecha(this.pelicula.fecha_estreno);
  }

  get ventaDesde(): string {
    return fechaAperturaVenta(this.pelicula);
  }

  emitirAlerta(): void {
    this.alertaCambiada.emit(this.pelicula);
  }
}