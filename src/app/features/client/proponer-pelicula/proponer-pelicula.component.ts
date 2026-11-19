import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { EstadoPropuesta, PropuestaPelicula } from '../../../core/models/propuesta.model';
import { PropuestasService } from '../../../core/services/propuestas.service';
import { ToastService } from '../../../core/services/toast.service';
import { FormErrorComponent } from '../../../shared/form-error/form-error.component';
import { TiempoRelativoPipe } from '../../../shared/pipes/tiempo-relativo.pipe';

const ETIQUETA_ESTADO: Record<EstadoPropuesta, string> = {
  pendiente: 'En revisión',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada'
};

@Component({
  selector: 'app-proponer-pelicula',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, FormErrorComponent, TiempoRelativoPipe],
  templateUrl: './proponer-pelicula.component.html',
  styleUrl: './proponer-pelicula.component.scss'
})
export class ProponerPeliculaComponent implements OnInit {
  private fb = inject(FormBuilder);
  private propuestasService = inject(PropuestasService);
  private toastService = inject(ToastService);

  cargando = signal(true);
  enviando = signal(false);
  errorMessage = signal<string | null>(null);
  propuestas = signal<PropuestaPelicula[]>([]);

  pendiente = computed(() => this.propuestas().find((p) => p.estado === 'pendiente') ?? null);
  historial = computed(() => this.propuestas().filter((p) => p.estado !== 'pendiente'));

  form = this.fb.nonNullable.group({
    titulo: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    descripcion: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(1000)]],
    motivo: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(500)]]
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.propuestas.set(await this.propuestasService.listarMias());
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar tus propuestas.');
    } finally {
      this.cargando.set(false);
    }
  }

  etiquetaEstado(estado: EstadoPropuesta): string {
    return ETIQUETA_ESTADO[estado];
  }

  async enviar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.error('Revisá los campos marcados en rojo.');
      return;
    }

    this.enviando.set(true);
    this.errorMessage.set(null);
    try {
      await this.propuestasService.crear(this.form.getRawValue());
      this.toastService.exito('¡Gracias! Recibimos tu propuesta.');
      this.form.reset();
      await this.cargar();
    } catch (err: any) {
      console.error(err);
      this.errorMessage.set(err?.message ?? 'No se pudo enviar la propuesta.');
    } finally {
      this.enviando.set(false);
    }
  }
}
