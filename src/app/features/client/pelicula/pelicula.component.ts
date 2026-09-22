import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { FuncionConDetalle } from '../../../core/models/funcion.model';
import { PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { PeliculasService } from '../../../core/services/peliculas.service';
import { SupabaseService } from '../../../core/services/supabase.service';

@Component({
  selector: 'app-pelicula-detalle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pelicula.component.html',
  styleUrl: './pelicula.component.scss'
})
export class PeliculaComponent implements OnInit {
  // Lee el parametro :id de la ruta /pelicula/:id.
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private peliculasService = inject(PeliculasService);
  private supabase = inject(SupabaseService);

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  pelicula = signal<PeliculaConRelaciones | null>(null);
  funciones = signal<FuncionConDetalle[]>([]);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigateByUrl('/cartelera');
      return;
    }
    await this.cargar(id);
  }

  async cargar(id: string): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [pelicula, { data: funciones, error: errorFunciones }] = await Promise.all([
        this.peliculasService.obtenerActivaPorId(id),
        this.supabase.client
          .from('funciones')
          .select('*, peliculas(nombre), salas(nombre)')
          .eq('pelicula_id', id)
          .order('fecha')
          .order('hora_inicio')
      ]);

      if (errorFunciones) throw errorFunciones;

      this.pelicula.set(pelicula);
      this.funciones.set(
        (funciones ?? []).map((fila: any) => ({
          ...fila,
          peliculaNombre: fila.peliculas?.nombre ?? '',
          salaNombre: fila.salas?.nombre ?? ''
        }))
      );
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar la película.');
    } finally {
      this.cargando.set(false);
    }
  }

  irAButacas(funcionId: string): void {
    this.router.navigateByUrl(`/funcion/${funcionId}/butacas`);
  }
}