import { Component, EventEmitter, Input, Output, forwardRef, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Estrellas de 1 a 5, reutilizable en tres modos:
 *
 *  - Sólo lectura (promedios, admite decimales: 3.5 pinta media estrella):
 *      <app-estrellas [valor]="4.3" [soloLectura]="true" />
 *  - Two-way binding con @Input + @Output "valorChange":
 *      <app-estrellas [(valor)]="nota" />
 *  - Dentro de un formulario reactivo, porque implementa ControlValueAccessor:
 *      <app-estrellas formControlName="calificacion" />
 */
@Component({
  selector: 'app-estrellas',
  standalone: true,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => EstrellasComponent), multi: true }
  ],
  template: `
    <div
      class="estrellas"
      [class.editable]="!soloLectura"
      [class.chica]="tamanio === 'chica'"
      [class.grande]="tamanio === 'grande'"
      [attr.role]="soloLectura ? 'img' : 'radiogroup'"
      [attr.aria-label]="soloLectura ? valor + ' de 5 estrellas' : 'Calificación'"
      (mouseleave)="hover.set(0)"
    >
      @for (n of posiciones; track n) {
        @if (soloLectura) {
          <span class="estrella">
            <span class="vacia">★</span>
            <span class="llena" [style.width.%]="relleno(n)">★</span>
          </span>
        } @else {
          <button
            type="button"
            class="estrella"
            role="radio"
            [attr.aria-checked]="valor === n"
            [attr.aria-label]="n + (n === 1 ? ' estrella' : ' estrellas')"
            [title]="etiquetas[n - 1]"
            [disabled]="deshabilitado"
            (mouseenter)="hover.set(n)"
            (click)="elegir(n)"
            (blur)="onTouched()"
          >
            <span class="vacia">★</span>
            <span class="llena" [style.width.%]="relleno(n)">★</span>
          </button>
        }
      }
      @if (!soloLectura && mostrarEtiqueta) {
        <span class="etiqueta">{{ etiquetaActual() }}</span>
      }
    </div>
  `,
  styles: `
    :host { display: inline-block; }
    .estrellas { display: inline-flex; align-items: center; gap: 2px; font-size: 22px; line-height: 1; }
    .estrellas.chica { font-size: 16px; }
    .estrellas.grande { font-size: 34px; }
    .estrella {
      position: relative;
      display: inline-block;
      padding: 0;
      border: none;
      background: none;
      font: inherit;
      line-height: 1;
    }
    button.estrella { cursor: pointer; transition: transform 0.1s; }
    button.estrella:hover:not(:disabled) { transform: scale(1.15); }
    button.estrella:disabled { cursor: not-allowed; opacity: 0.6; }
    .vacia { color: rgba(27, 26, 46, 0.2); }
    .llena {
      position: absolute;
      inset: 0 auto 0 0;
      overflow: hidden;
      white-space: nowrap;
      color: #f5b301;
      -webkit-text-stroke: 1px var(--color-tinta, #1b1a2e);
    }
    .etiqueta { margin-left: 8px; font-size: 13px; font-weight: 700; }
  `
})
export class EstrellasComponent implements ControlValueAccessor {
  @Input() valor = 0;
  @Input() soloLectura = false;
  @Input() tamanio: 'chica' | 'normal' | 'grande' = 'normal';
  /** Muestra al lado el texto de la estrella elegida ("Muy buena"). */
  @Input() mostrarEtiqueta = false;
  @Output() valorChange = new EventEmitter<number>();

  readonly posiciones = [1, 2, 3, 4, 5];
  readonly etiquetas = ['Mala', 'Regular', 'Buena', 'Muy buena', 'Excelente'];

  /** Estrella bajo el mouse: previsualiza la calificación antes de hacer clic. */
  hover = signal(0);
  deshabilitado = false;

  private onChange: (valor: number) => void = () => {};
  onTouched: () => void = () => {};

  /** Porcentaje pintado de la estrella n (0-100), así se ven los promedios con decimales. */
  relleno(n: number): number {
    const valor = this.hover() || this.valor || 0;
    return Math.max(0, Math.min(1, valor - (n - 1))) * 100;
  }

  etiquetaActual(): string {
    const valor = this.hover() || this.valor;
    return valor ? this.etiquetas[Math.round(valor) - 1] : 'Elegí de 1 a 5 estrellas';
  }

  elegir(n: number): void {
    if (this.soloLectura || this.deshabilitado) return;
    this.valor = n;
    this.onChange(n);
    this.onTouched();
    this.valorChange.emit(n);
  }

  // ----- ControlValueAccessor: así funciona con formControlName / ngModel -----

  writeValue(valor: number | null): void {
    this.valor = Number(valor) || 0;
  }

  registerOnChange(fn: (valor: number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(deshabilitado: boolean): void {
    this.deshabilitado = deshabilitado;
  }
}
