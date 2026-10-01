import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MiPelicula } from '../../../core/models/resena.model';
import { ResenasService } from '../../../core/services/resenas.service';
import { formatearFecha } from '../../../core/utils/pelicula-fechas';
import { EstrellasComponent } from '../../../shared/estrellas/estrellas.component';
import { ResenaFormComponent } from '../../../shared/resena-form/resena-form.component';

type Filtro = 'todas' | 'sin_calificar';

/**
 * "Mis Películas": galería de las películas que el usuario vio
 * (entrada validada en sala o función ya terminada), con afiche,
 * fecha de la función y la calificación que le dio. Desde acá
 * también puede calificarlas o editar su reseña.
 */
@Component({
  selector: 'app-mis-peliculas',
  standalone: true,
  imports: [CommonModule, RouterLink, EstrellasComponent, ResenaFormComponent],
  templateUrl: './mis-peliculas.component.html',
  styleUrl: './mis-peliculas.component.scss'
})
export class MisPeliculasComponent implements OnInit {
  private resenasService = inject(ResenasService);

  readonly formatearFecha = formatearFecha;

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  peliculas = signal<MiPelicula[]>([]);
  filtro = signal<Filtro>('todas');
  /** Película que se está calificando (abre el modal). */
  calificando = signal<MiPelicula | null>(null);

  sinCalificar = computed(() => this.peliculas().filter((p) => p.calificacion == null));

  visibles = computed(() => (this.filtro() === 'todas' ? this.peliculas() : this.sinCalificar()));

  /** Promedio de las estrellas que dio el usuario (null si no calificó ninguna). */
  promedioPropio = computed(() => {
    const notas = this.peliculas()
      .map((p) => p.calificacion)
      .filter((n): n is number => n != null);
    return notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null;
  });

  totalFunciones = computed(() => this.peliculas().reduce((total, p) => total + p.veces, 0));

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      this.peliculas.set(await this.resenasService.listarMisPeliculas());
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar tus películas. Intentá de nuevo en unos minutos.');
    } finally {
      this.cargando.set(false);
    }
  }

  abrirCalificacion(pelicula: MiPelicula): void {
    this.calificando.set(pelicula);
  }

  cerrarCalificacion(): void {
    this.calificando.set(null);
  }

  async alGuardar(): Promise<void> {
    this.calificando.set(null);
    await this.cargar();
  }
}
