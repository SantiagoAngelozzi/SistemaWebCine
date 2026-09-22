import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { PeliculasService } from '../../../core/services/peliculas.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  private peliculasService = inject(PeliculasService);

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  destacadas = signal<PeliculaConRelaciones[]>([]);

  async ngOnInit(): Promise<void> {
    await this.cargarDestacadas();
  }

  async cargarDestacadas(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      // TODO: una vez que exista el modulo de ventas (compras/entradas),
      // reemplazar este orden por "las 3 mas vendidas" real (PDF, seccion
      // 2). Por ahora se muestran las 3 activas mas recientes.
      const peliculas = await this.peliculasService.listarActivas(3);
      this.destacadas.set(peliculas);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar las películas destacadas.');
    } finally {
      this.cargando.set(false);
    }
  }
}