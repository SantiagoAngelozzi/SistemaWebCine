import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function alMenosUnoMarcado(): ValidatorFn {
  return (grupo: AbstractControl): ValidationErrors | null => {
    const valores = Object.values(grupo.value ?? {});
    return valores.some((v) => v === true) ? null : { ningunoMarcado: true };
  };
}
