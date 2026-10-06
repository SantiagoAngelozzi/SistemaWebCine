import { AbstractControl } from '@angular/forms';

const MENSAJES: Record<string, (control: AbstractControl) => string> = {
  required: () => 'Este campo es obligatorio.',
  email: () => 'Ingresá un email válido.',
  minlength: (c) => `Mínimo ${c.errors?.['minlength']?.requiredLength} caracteres.`,
  maxlength: (c) => `Máximo ${c.errors?.['maxlength']?.requiredLength} caracteres.`,
  min: (c) => `El valor mínimo es ${c.errors?.['min']?.min}.`,
  max: (c) => `El valor máximo es ${c.errors?.['max']?.max}.`,
  pattern: () => 'El formato no es válido.',
  fechaInvalida: (c) => c.errors?.['fechaInvalida'] ?? 'La fecha no es válida.'
};

export function obtenerMensajeError(control: AbstractControl | null | undefined): string | null {
  if (!control || !control.errors || !(control.dirty || control.touched)) {
    return null;
  }
  const primeraClave = Object.keys(control.errors)[0];
  const generador = MENSAJES[primeraClave];
  return generador ? generador(control) : 'Este campo no es válido.';
}
