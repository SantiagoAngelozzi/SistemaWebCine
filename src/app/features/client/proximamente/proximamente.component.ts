import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { AlertasService } from '../../../core/services/alertas.service';
import { PeliculasService } from '../../../core/services/peliculas.service';
import { ToastService } from '../../../core/services/toast.service';
import { estadoVenta } from '../../../core/utils/pelicula-fechas';
import { PeliculaCardComponent } from '../../../shared/pelicula-card/pelicula-card.component';

@Component({
  selector: 'app-proximamente',
  standalone: true,
  imports: [CommonModule, RouterLink, PeliculaCardComponent],
  templateUrl: './proximamente.component.html',
  styleUrl: './proximamente.component.scss'
})
export class ProximamenteComponent implements OnInit {
  private peliculasService = inject(PeliculasService);
  private alertasService = inject(AlertasService);
  private toastService = inject(ToastService);

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  logueado = signal(false);

  peliculas = signal<PeliculaConRelaciones[]>([]);
  alertas = signal<Set<string>>(new Set());

  proximas = computed(() =>
    this.peliculas()
      .filter((p) => estadoVenta(p) === 'proximamente')
      .sort((a, b) => a.fecha_estreno.localeCompare(b.fecha_estreno))
  );

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [peliculas, logueado] = await Promise.all([
        this.peliculasService.listarActivas(),
        this.alertasService.estaLogueado()
      ]);
      this.peliculas.set(peliculas);
      this.logueado.set(logueado);

      if (logueado) {
        this.alertas.set(await this.alertasService.listarMias());
      }
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar los próximos estrenos.');
    } finally {
      this.cargando.set(false);
    }
  }

  tieneAlerta(peliculaId: string): boolean {
    return this.alertas().has(peliculaId);
  }

  async toggleAlerta(pelicula: PeliculaConRelaciones): Promise<void> {
    if (!this.logueado()) {
      this.toastService.mostrar('Ingresá o registrate para activar alertas de estreno.', 'info');
      return;
    }

    try {
      if (this.tieneAlerta(pelicula.id)) {
        await this.alertasService.desactivar(pelicula.id);
        this.alertas.update((set) => {
          const copia = new Set(set);
          copia.delete(pelicula.id);
          return copia;
        });
        this.toastService.exito('Alerta desactivada');
      } else {
        await this.alertasService.activar(pelicula.id);
        this.alertas.update((set) => new Set(set).add(pelicula.id));
        this.toastService.exito(`Te avisamos cuando abra la venta de "${pelicula.nombre}" 🔔`);
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo actualizar la alerta. Intentá de nuevo.');
    }
  }
}