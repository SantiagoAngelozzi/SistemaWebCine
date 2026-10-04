import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  MAX_COMENTARIO_RESENA,
  ResenasService,
  mensajeErrorResena
} from '../../core/services/resenas.service';
import { ToastService } from '../../core/services/toast.service';
import { EstrellasComponent } from '../estrellas/estrellas.component';

@Component({
  selector: 'app-resena-form',
  standalone: true,
  imports: [ReactiveFormsModule, EstrellasComponent],
  template: `
    <form class="resena-form" [formGroup]="form" (ngSubmit)="guardar()">
      <label class="titulo">{{ resena ? 'Editá tu calificación' : '¿Qué te pareció?' }}</label>
      <app-estrellas formControlName="calificacion" tamanio="grande" [mostrarEtiqueta]="true" />
      @if (form.controls.calificacion.touched && form.controls.calificacion.invalid) {
        <p class="form-error">Elegí de 1 a 5 estrellas.</p>
      }

      <textarea
        formControlName="comentario"
        rows="3"
        [attr.maxlength]="maxComentario"
        placeholder="Contá en pocas palabras qué te pareció (opcional)"
      ></textarea>
      <div class="pie">
        <span class="contador" [class.limite]="largoComentario() >= maxComentario">
          {{ largoComentario() }}/{{ maxComentario }}
        </span>
        <div class="acciones">
          @if (mostrarCancelar) {
            <button type="button" class="btn-secundario" (click)="cancelar.emit()">Cancelar</button>
          }
          <button type="submit" class="btn-primary" [disabled]="guardando()">
            {{ guardando() ? 'Guardando…' : resena ? 'Guardar cambios' : 'Publicar reseña' }}
          </button>
        </div>
      </div>
    </form>
  `,
  styles: `
    .resena-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      border: var(--border-comic);
      border-radius: 14px;
      background: var(--color-papel-2);
      box-shadow: var(--shadow-comic-sm);
    }
    .titulo { font-family: var(--font-display); font-size: 18px; }
    textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 10px;
      border: 2px solid var(--color-tinta);
      border-radius: 10px;
      font: inherit;
      resize: vertical;
      background: var(--color-papel);
    }
    .pie { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .contador { font-size: 12px; opacity: 0.7; }
    .contador.limite { color: #b0133a; opacity: 1; font-weight: 700; }
    .acciones { display: flex; gap: 8px; }
    .form-error { margin: 0; color: #b0133a; font-size: 13px; font-weight: 700; }
    .btn-primary, .btn-secundario {
      padding: 8px 14px;
      border: var(--border-comic);
      border-radius: 10px;
      font-weight: 700;
      font-size: 13px;
      color: var(--color-tinta);
      cursor: pointer;
      box-shadow: var(--shadow-comic-sm);
    }
    .btn-primary { background: var(--color-naranja); }
    .btn-secundario { background: var(--color-papel); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
  `
})
export class ResenaFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private resenasService = inject(ResenasService);
  private toastService = inject(ToastService);

  @Input({ required: true }) peliculaId = '';
  @Input() resena: { calificacion: number; comentario: string | null } | null = null;
  @Input() mostrarCancelar = false;
  @Output() guardada = new EventEmitter<void>();
  @Output() cancelar = new EventEmitter<void>();

  readonly maxComentario = MAX_COMENTARIO_RESENA;
  guardando = signal(false);

  form = this.fb.nonNullable.group({
    calificacion: [0, [Validators.required, Validators.min(1), Validators.max(5)]],
    comentario: ['', Validators.maxLength(MAX_COMENTARIO_RESENA)]
  });

  ngOnInit(): void {
    if (this.resena) {
      this.form.reset({
        calificacion: this.resena.calificacion,
        comentario: this.resena.comentario ?? ''
      });
    }
  }

  largoComentario(): number {
    return this.form.controls.comentario.value.length;
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { calificacion, comentario } = this.form.getRawValue();
    this.guardando.set(true);
    try {
      await this.resenasService.guardarResena(this.peliculaId, calificacion, comentario.trim() || null);
      this.toastService.exito(this.resena ? 'Reseña actualizada' : '¡Gracias por tu reseña!');
      this.guardada.emit();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorResena(err, 'No se pudo guardar la reseña.'));
    } finally {
      this.guardando.set(false);
    }
  }
}
