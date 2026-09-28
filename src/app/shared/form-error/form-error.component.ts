import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { AbstractControl } from '@angular/forms';

import { obtenerMensajeError } from '../../core/utils/form-errors';

@Component({
  selector: 'app-form-error',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (mensaje(); as m) {
      <p class="form-error"> {{ m }}</p>
    }
  `,
  styleUrl: './form-error.component.scss'
})
export class FormErrorComponent {
  @Input({ required: true }) control: AbstractControl | null = null;

  mensaje(): string | null {
    return obtenerMensajeError(this.control);
  }
}