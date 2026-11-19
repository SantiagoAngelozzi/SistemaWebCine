import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PropuestaPelicula } from '../../../../core/models/propuesta.model';
import { TiempoRelativoPipe } from '../../../../shared/pipes/tiempo-relativo.pipe';

@Component({
  selector: 'app-propuesta-card',
  standalone: true,
  imports: [CommonModule, RouterLink, TiempoRelativoPipe],
  templateUrl: './propuesta-card.component.html',
  styleUrl: './propuesta-card.component.scss'
})
export class PropuestaCardComponent {
  @Input({ required: true }) propuesta!: PropuestaPelicula;
  @Input() procesando = false;

  @Output() aceptar = new EventEmitter<PropuestaPelicula>();
  @Output() rechazar = new EventEmitter<PropuestaPelicula>();
}
