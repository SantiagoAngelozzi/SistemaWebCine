import { Component, Input, forwardRef, signal } from '@angular/core';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator
} from '@angular/forms';

import { formatearFecha } from '../../core/utils/pelicula-fechas';
import { hoyIso, sumarDias } from '../../core/utils/formato';

export interface AtajoFecha {
  etiqueta: string;
  dias: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function esFechaIso(valor: unknown): valor is string {
  return typeof valor === 'string' && ISO.test(valor);
}

function textoAIso(texto: string): string | null {
  const digitos = texto.replace(/\D/g, '');
  if (digitos.length !== 8) return null;
  const dia = Number(digitos.slice(0, 2));
  const mes = Number(digitos.slice(2, 4));
  const anio = Number(digitos.slice(4, 8));
  const fecha = new Date(anio, mes - 1, dia);
  if (anio < 1900 || fecha.getFullYear() !== anio || fecha.getMonth() !== mes - 1 || fecha.getDate() !== dia) {
    return null;
  }
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function enmascarar(texto: string): string {
  const digitos = texto.replace(/\D/g, '').slice(0, 8);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

@Component({
  selector: 'app-fecha-input',
  standalone: true,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => FechaInputComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => FechaInputComponent), multi: true }
  ],
  template: `
    <div class="fecha-input" [class.compacto]="compacto">
      <input
        type="text"
        inputmode="numeric"
        autocomplete="off"
        maxlength="10"
        [attr.id]="inputId"
        [placeholder]="placeholder"
        [value]="texto()"
        [disabled]="deshabilitado()"
        [class.input-invalido]="invalido || !!error()"
        (input)="alEscribir($any($event.target))"
        (blur)="alSalir()"
      />
      @if (atajos.length) {
        <div class="atajos">
          @for (atajo of atajos; track atajo.etiqueta) {
            <button type="button" [disabled]="deshabilitado()" (click)="usarAtajo(atajo)">{{ atajo.etiqueta }}</button>
          }
        </div>
      }
    </div>
    @if (mostrarError && error()) {
      <p class="error-fecha">{{ error() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .fecha-input {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    input {
      width: 100%;
      max-width: 150px;
      font-family: var(--font-body);
      font-size: 14px;
      letter-spacing: 1px;
      padding: 10px 12px;
      border: var(--border-comic);
      border-radius: 10px;
      background: var(--color-papel);
      color: var(--color-tinta);
      outline: none;

      &:focus {
        box-shadow: 3px 3px 0 var(--color-coral);
      }

      &.input-invalido {
        border-color: #b3123f;
        background: #fff5f8;
        box-shadow: 0 0 0 2px rgba(179, 18, 63, 0.12);
      }
    }

    .compacto input {
      max-width: 130px;
      padding: 7px 10px;
      font-size: 13px;
      border-width: 2px;
    }

    .error-fecha {
      margin: 4px 0 0;
      color: #b3123f;
      font-size: 12px;
      font-weight: 700;
    }

    .atajos {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .atajos button {
      padding: 5px 10px;
      border: 2px solid var(--color-tinta);
      border-radius: 999px;
      background: var(--color-papel-2);
      font-family: var(--font-body);
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;

      &:hover:not(:disabled) {
        background: var(--color-lima);
      }
    }
  `
})
export class FechaInputComponent implements ControlValueAccessor, Validator {
  @Input() min: string | null = null;
  @Input() max: string | null = null;
  @Input() atajos: AtajoFecha[] = [];
  @Input() invalido = false;
  @Input() compacto = false;
  @Input() mostrarError = false;
  @Input() inputId: string | null = null;
  @Input() placeholder = 'dd/mm/aaaa';

  texto = signal('');
  deshabilitado = signal(false);
  error = signal<string | null>(null);

  private salioAlgunaVez = false;
  private ultimoEmitido: string | null = null;
  private onChange: (valor: string) => void = () => {};
  private onTouched: () => void = () => {};
  private onValidatorChange: () => void = () => {};

  writeValue(valor: unknown): void {
    const iso = esFechaIso(valor) ? valor : '';
    this.ultimoEmitido = iso;
    this.texto.set(iso ? formatearFecha(iso) : '');
    this.salioAlgunaVez = false;
    this.error.set(null);
  }

  registerOnChange(fn: (valor: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado.set(deshabilitado);
  }

  validate(_control: AbstractControl): ValidationErrors | null {
    const mensaje = this.mensajeError(true);
    return mensaje ? { fechaInvalida: mensaje } : null;
  }

  alEscribir(input: HTMLInputElement): void {
    const texto = enmascarar(input.value);
    input.value = texto;
    this.texto.set(texto);
    this.actualizar();
  }

  alSalir(): void {
    this.salioAlgunaVez = true;
    this.error.set(this.mensajeError(false));
    this.onTouched();
  }

  usarAtajo(atajo: AtajoFecha): void {
    this.texto.set(formatearFecha(sumarDias(hoyIso(), atajo.dias)));
    this.salioAlgunaVez = true;
    this.actualizar();
    this.onTouched();
  }

  private actualizar(): void {
    const iso = textoAIso(this.texto());
    const valor = iso && !this.fueraDeRango(iso) ? iso : this.texto();
    this.error.set(this.texto().replace(/\D/g, '').length === 8 || this.salioAlgunaVez ? this.mensajeError(false) : null);
    if (valor !== this.ultimoEmitido) {
      this.ultimoEmitido = valor;
      this.onChange(valor);
    }
    this.onValidatorChange();
  }

  private fueraDeRango(iso: string): string | null {
    if (this.min && iso < this.min) return `La fecha tiene que ser desde el ${formatearFecha(this.min)}.`;
    if (this.max && iso > this.max) return `La fecha tiene que ser hasta el ${formatearFecha(this.max)}.`;
    return null;
  }

  private mensajeError(paraValidador: boolean): string | null {
    const texto = this.texto();
    if (!texto) return null;
    const digitos = texto.replace(/\D/g, '').length;
    if (digitos < 8) {
      return paraValidador || this.salioAlgunaVez ? 'Completá la fecha como dd/mm/aaaa.' : null;
    }
    const iso = textoAIso(texto);
    if (!iso) return 'Esa fecha no existe.';
    return this.fueraDeRango(iso);
  }
}
