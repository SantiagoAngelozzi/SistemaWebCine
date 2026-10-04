import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Genero, PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { AlertasService } from '../../../core/services/alertas.service';
import { PeliculasService } from '../../../core/services/peliculas.service';
import { ToastService } from '../../../core/services/toast.service';
import { estadoVenta } from '../../../core/utils/pelicula-fechas';
import { normalizarTexto } from '../../../core/utils/texto';
import { PeliculaCardComponent } from '../../../shared/pelicula-card/pelicula-card.component';

@Component({
  selector: 'app-cartelera',
  standalone: true,
  imports: [CommonModule, RouterLink, PeliculaCardComponent],
  templateUrl: './cartelera.component.html',
  styleUrl: './cartelera.component.scss'
})
export class CarteleraComponent implements OnInit {
  private peliculasService = inject(PeliculasService);
  private alertasService = inject(AlertasService);
  private toastService = inject(ToastService);

  cargando = signal(true);
  errorMessage = signal<string | null>(null);

  peliculas = signal<PeliculaConRelaciones[]>([]);
  generos = signal<Genero[]>([]);
  alertas = signal<Set<string>>(new Set());

  busqueda = signal('');
  generosSeleccionados = signal<string[]>([]);

  enCartelera = computed(() =>
    this.peliculas()
      .filter((p) => estadoVenta(p) !== 'proximamente')
      .sort((a, b) => b.fecha_estreno.localeCompare(a.fecha_estreno))
  );

  filtradas = computed(() => {
    const texto = normalizarTexto(this.busqueda());
    const seleccionados = this.generosSeleccionados();

    return this.enCartelera().filter((p) => {
      const coincideTexto = !texto || normalizarTexto(p.nombre).includes(texto);
      const coincideGenero =
        !seleccionados.length || p.generoIds.some((id) => seleccionados.includes(id));
      return coincideTexto && coincideGenero;
    });
  });

  hayFiltros = computed(() => !!this.busqueda().trim() || this.generosSeleccionados().length > 0);

  avisos = computed(() => this.enCartelera().filter((p) => this.alertas().has(p.id)));

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [peliculas, generos, alertas] = await Promise.all([
        this.peliculasService.listarActivas(),
        this.peliculasService.listarGeneros(),
        this.alertasService.listarMias().catch(() => new Set<string>())
      ]);
      this.peliculas.set(peliculas);
      this.generos.set(generos);
      this.alertas.set(alertas);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar la cartelera.');
    } finally {
      this.cargando.set(false);
    }
  }

  onBusqueda(valor: string): void {
    this.busqueda.set(valor);
  }

  toggleGenero(id: string): void {
    this.generosSeleccionados.update((actuales) =>
      actuales.includes(id) ? actuales.filter((g) => g !== id) : [...actuales, id]
    );
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.generosSeleccionados.set([]);
  }

  async descartarAvisos(): Promise<void> {
    try {
      for (const pelicula of this.avisos()) {
        await this.alertasService.desactivar(pelicula.id);
      }
      this.alertas.set(new Set());
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudieron descartar los avisos.');
    }
  }
}
