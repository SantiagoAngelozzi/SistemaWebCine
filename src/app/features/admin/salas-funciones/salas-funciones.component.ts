import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { FuncionConDetalle } from '../../../core/models/funcion.model';
import { FormatoProyeccion, IdiomaPelicula, PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { SalaConCantidadButacas } from '../../../core/models/sala.model';
import { FuncionesService } from '../../../core/services/funciones.service';
import { PeliculasService } from '../../../core/services/peliculas.service';
import { SalasService } from '../../../core/services/salas.service';
import { SupabaseService } from '../../../core/services/supabase.service';

type Tab = 'salas' | 'funciones';

@Component({
  selector: 'app-admin-salas-funciones',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './salas-funciones.component.html',
  styleUrl: './salas-funciones.component.scss'
})
export class SalasFuncionesComponent implements OnInit {
  private fb = inject(FormBuilder);
  private salasService = inject(SalasService);
  private funcionesService = inject(FuncionesService);
  private peliculasService = inject(PeliculasService);
  private supabase = inject(SupabaseService);

  tabActiva = signal<Tab>('salas');

  cargando = signal(true);
  guardandoSala = signal(false);
  guardandoFuncion = signal(false);
  errorMessage = signal<string | null>(null);

  salas = signal<SalaConCantidadButacas[]>([]);
  funciones = signal<FuncionConDetalle[]>([]);
  peliculas = signal<PeliculaConRelaciones[]>([]);

  formatosDisponibles: FormatoProyeccion[] = ['2D', '3D', '4D', '5D'];

  formFuncion = this.fb.nonNullable.group({
    peliculaId: ['', Validators.required],
    fecha: ['', Validators.required],
    horaInicio: ['', Validators.required],
    formato: ['2D' as FormatoProyeccion, Validators.required],
    idioma: ['castellano' as IdiomaPelicula, Validators.required],
    precio: [0, [Validators.required, Validators.min(0)]]
  });

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
  }

  cambiarTab(tab: Tab): void {
    this.tabActiva.set(tab);
    this.errorMessage.set(null);
  }

  async cargarTodo(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [salas, funciones, peliculas] = await Promise.all([
        this.salasService.listar(),
        this.funcionesService.listar(),
        this.peliculasService.listar()
      ]);
      this.salas.set(salas);
      this.funciones.set(funciones);
      this.peliculas.set(peliculas);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar los datos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async crearSala(nombre: string): Promise<void> {
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) return;

    this.guardandoSala.set(true);
    this.errorMessage.set(null);
    try {
      await this.salasService.crear(nombreLimpio);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo crear la sala.');
    } finally {
      this.guardandoSala.set(false);
    }
  }

  async eliminarSala(sala: SalaConCantidadButacas): Promise<void> {
    const confirmado = confirm(
      `¿Eliminar la sala "${sala.nombre}" y sus ${sala.cantidadButacas} butacas? Esta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    try {
      await this.salasService.eliminar(sala.id);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.errorMessage.set(
        'No se pudo eliminar la sala (probablemente tenga funciones programadas todavía).'
      );
    }
  }

  async crearFuncion(): Promise<void> {
    if (this.formFuncion.invalid) {
      this.formFuncion.markAllAsTouched();
      return;
    }
    this.guardandoFuncion.set(true);
    this.errorMessage.set(null);

    try {
      const {
        data: { session }
      } = await this.supabase.client.auth.getSession();

      await this.funcionesService.crear(this.formFuncion.getRawValue(), session?.user.id);
      this.formFuncion.reset({
        peliculaId: '',
        fecha: '',
        horaInicio: '',
        formato: '2D',
        idioma: 'castellano',
        precio: 0
      });
      await this.cargarTodo();
    } catch (err: any) {
      console.error(err);
      this.errorMessage.set(err?.message ?? 'No se pudo crear la función.');
    } finally {
      this.guardandoFuncion.set(false);
    }
  }

  async eliminarFuncion(funcion: FuncionConDetalle): Promise<void> {
    const confirmado = confirm(`¿Eliminar la función de "${funcion.peliculaNombre}"?`);
    if (!confirmado) return;

    try {
      await this.funcionesService.eliminar(funcion.id);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo eliminar la función.');
    }
  }
}