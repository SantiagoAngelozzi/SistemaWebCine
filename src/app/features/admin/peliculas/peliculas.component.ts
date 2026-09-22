import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  ClasificacionEdad,
  FormatoProyeccion,
  Genero,
  IdiomaPelicula,
  PeliculaConRelaciones
} from '../../../core/models/pelicula.model';
import { PeliculasService } from '../../../core/services/peliculas.service';

const FORMATOS_DISPONIBLES: FormatoProyeccion[] = ['2D', '3D', '4D', '5D'];

@Component({
  selector: 'app-admin-peliculas',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './peliculas.component.html',
  styleUrl: './peliculas.component.scss'
})
export class PeliculasComponent implements OnInit {
  private fb = inject(FormBuilder);
  private peliculasService = inject(PeliculasService);

  formatosDisponibles = FORMATOS_DISPONIBLES;

  cargando = signal(true);
  guardando = signal(false);
  errorMessage = signal<string | null>(null);

  peliculas = signal<PeliculaConRelaciones[]>([]);
  generosDisponibles = signal<Genero[]>([]);

  mostrandoForm = signal(false);
  editandoId = signal<string | null>(null);

  generosSeleccionados = signal<string[]>([]);
  formatosSeleccionados = signal<FormatoProyeccion[]>([]);

  form = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    sinopsis: [''],
    imagenUrl: [''],
    duracionMinutos: [90, [Validators.required, Validators.min(1)]],
    idioma: ['castellano' as IdiomaPelicula, Validators.required],
    clasificacion: ['ATP' as ClasificacionEdad, Validators.required],
    fechaEstreno: ['', Validators.required],
    precioNormal: [0, [Validators.required, Validators.min(0)]],
    precioPreventa: [null as number | null],
    diasPreventa: [7, [Validators.required, Validators.min(0)]],
    activa: [true]
  });

  async ngOnInit(): Promise<void> {
    await this.cargarDatos();
  }

  async cargarDatos(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [peliculas, generos] = await Promise.all([
        this.peliculasService.listar(),
        this.peliculasService.listarGeneros()
      ]);
      this.peliculas.set(peliculas);
      this.generosDisponibles.set(generos);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar las películas.');
    } finally {
      this.cargando.set(false);
    }
  }

  abrirNueva(): void {
    this.editandoId.set(null);
    this.form.reset({
      nombre: '',
      sinopsis: '',
      imagenUrl: '',
      duracionMinutos: 90,
      idioma: 'castellano',
      clasificacion: 'ATP',
      fechaEstreno: '',
      precioNormal: 0,
      precioPreventa: null,
      diasPreventa: 7,
      activa: true
    });
    this.generosSeleccionados.set([]);
    this.formatosSeleccionados.set([]);
    this.mostrandoForm.set(true);
  }

  abrirEdicion(pelicula: PeliculaConRelaciones): void {
    this.editandoId.set(pelicula.id);
    this.form.reset({
      nombre: pelicula.nombre,
      sinopsis: pelicula.sinopsis ?? '',
      imagenUrl: pelicula.imagen_url ?? '',
      duracionMinutos: pelicula.duracion_minutos,
      idioma: pelicula.idioma,
      clasificacion: pelicula.clasificacion,
      fechaEstreno: pelicula.fecha_estreno,
      precioNormal: pelicula.precio_normal,
      precioPreventa: pelicula.precio_preventa,
      diasPreventa: pelicula.dias_preventa,
      activa: pelicula.activa
    });
    this.generosSeleccionados.set([...pelicula.generoIds]);
    this.formatosSeleccionados.set([...pelicula.formatos]);
    this.mostrandoForm.set(true);
  }

  cancelar(): void {
    this.mostrandoForm.set(false);
  }

  toggleGenero(id: string, marcado: boolean): void {
    this.generosSeleccionados.update((actuales) =>
      marcado ? [...actuales, id] : actuales.filter((g) => g !== id)
    );
  }

  toggleFormato(formato: FormatoProyeccion, marcado: boolean): void {
    this.formatosSeleccionados.update((actuales) =>
      marcado ? [...actuales, formato] : actuales.filter((f) => f !== formato)
    );
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.errorMessage.set(null);

    try {
      const valores = this.form.getRawValue();
      const generoIds = this.generosSeleccionados();
      const formatos = this.formatosSeleccionados();
      const id = this.editandoId();

      if (id) {
        await this.peliculasService.actualizar(id, valores, generoIds, formatos);
      } else {
        await this.peliculasService.crear(valores, generoIds, formatos);
      }

      this.mostrandoForm.set(false);
      await this.cargarDatos();
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo guardar la película. Revisá los datos e intentá de nuevo.');
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminar(pelicula: PeliculaConRelaciones): Promise<void> {
    const confirmado = confirm(`¿Eliminar "${pelicula.nombre}"? Esta acción no se puede deshacer.`);
    if (!confirmado) return;

    try {
      await this.peliculasService.eliminar(pelicula.id);
      await this.cargarDatos();
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo eliminar la película.');
    }
  }
}