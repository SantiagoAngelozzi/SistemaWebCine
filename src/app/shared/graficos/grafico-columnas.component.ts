import { Component, Input, computed, signal } from '@angular/core';

import { formatearEntero, formatearMoneda, formatearMonedaCorta } from '../../core/utils/formato';

export interface PuntoColumna {
  etiqueta: string;
  titulo: string;
  valor: number;
}

interface Columna {
  x: number;
  ancho: number;
  ranuraX: number;
  path: string;
  punto: PuntoColumna;
}

const ANCHO = 560;
const ALTO = 230;
const MARGEN = { izquierda: 74, derecha: 12, arriba: 24, abajo: 26 };

@Component({
  selector: 'app-grafico-columnas',
  standalone: true,
  template: `
    <div class="grafico">
      <svg
        [attr.viewBox]="'0 0 ' + ancho + ' ' + alto"
        role="img"
        [attr.aria-label]="descripcion"
        (mouseleave)="activo.set(null)"
      >
        @for (tick of ticks(); track tick.valor) {
          <line class="grilla" [attr.x1]="margen.izquierda" [attr.x2]="ancho - margen.derecha" [attr.y1]="tick.y" [attr.y2]="tick.y" />
          <text class="eje" [attr.x]="margen.izquierda - 8" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.texto }}</text>
        }

        @for (columna of columnas(); track $index; let i = $index) {
          <path [attr.d]="columna.path" [attr.fill]="color" [class.atenuada]="activo() !== null && activo() !== i" />
          <rect
            class="zona"
            [attr.x]="columna.ranuraX"
            [attr.y]="margen.arriba"
            [attr.width]="ranura()"
            [attr.height]="altoGrafico"
            (mouseenter)="activo.set(i)"
          />
          @if (i % cadaCuanto() === 0) {
            <text class="eje" [attr.x]="columna.x + columna.ancho / 2" [attr.y]="alto - 8" text-anchor="middle">
              {{ columna.punto.etiqueta }}
            </text>
          }
        }

        @if (maximo(); as m) {
          <text class="rotulo" [attr.x]="m.x" [attr.y]="m.y" [attr.text-anchor]="m.anclaje">{{ m.texto }}</text>
        }

        <line class="base" [attr.x1]="margen.izquierda" [attr.x2]="ancho - margen.derecha" [attr.y1]="base" [attr.y2]="base" />
      </svg>

      @if (tooltip(); as t) {
        <div class="tooltip" [style.left.%]="t.izquierda" [class.a-la-izquierda]="t.izquierda > 70">
          <span class="titulo">{{ t.titulo }}</span>
          <strong>{{ t.valor }}</strong>
        </div>
      }

      @if (vacio()) {
        <p class="vacio">Sin ventas en el período.</p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .grafico { position: relative; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }
    .grilla { stroke: #e6e3da; stroke-width: 1; }
    .base { stroke: #8a8794; stroke-width: 1; }
    .eje { font-size: 11px; fill: #6b6878; font-family: var(--font-body); }
    .rotulo { font-size: 12px; font-weight: 700; fill: var(--color-tinta); font-family: var(--font-body); }
    path { transition: opacity 0.12s; }
    path.atenuada { opacity: 0.45; }
    .zona { fill: transparent; cursor: default; }
    .tooltip {
      position: absolute;
      top: 0;
      transform: translate(-50%, -100%);
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      border: 2px solid var(--color-tinta);
      border-radius: 8px;
      background: var(--color-papel-2);
      box-shadow: var(--shadow-comic-sm);
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
    }
    .tooltip.a-la-izquierda { transform: translate(-100%, -100%); }
    .tooltip .titulo { opacity: 0.75; }
    .vacio {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      font-size: 14px;
      opacity: 0.7;
    }
  `
})
export class GraficoColumnasComponent {
  @Input({ required: true }) set datos(valor: PuntoColumna[]) {
    this.puntos.set(valor ?? []);
  }
  @Input() color = '#A6339B';
  @Input() formato: 'moneda' | 'entero' = 'entero';
  @Input() descripcion = '';

  readonly ancho = ANCHO;
  readonly alto = ALTO;
  readonly margen = MARGEN;
  readonly altoGrafico = ALTO - MARGEN.arriba - MARGEN.abajo;
  readonly base = ALTO - MARGEN.abajo;

  puntos = signal<PuntoColumna[]>([]);
  activo = signal<number | null>(null);

  vacio = computed(() => this.puntos().every((p) => p.valor <= 0));

  private escala = computed(() => {
    const maximo = Math.max(0, ...this.puntos().map((p) => p.valor));
    if (maximo <= 0) return { tope: 1, paso: 1 };
    const pasoCrudo = maximo / 4;
    const potencia = Math.pow(10, Math.floor(Math.log10(pasoCrudo)));
    const paso = [1, 2, 2.5, 5, 10].map((f) => f * potencia).find((p) => p >= pasoCrudo) ?? 10 * potencia;
    const pasoFinal = this.formato === 'entero' ? Math.max(1, Math.ceil(paso)) : paso;
    return { tope: Math.ceil(maximo / pasoFinal) * pasoFinal, paso: pasoFinal };
  });

  ticks = computed(() => {
    const { tope, paso } = this.escala();
    if (this.vacio()) return [{ valor: 0, y: this.base, texto: this.texto(0, true) }];
    const ticks: { valor: number; y: number; texto: string }[] = [];
    for (let v = 0; v <= tope + paso / 1000; v += paso) {
      ticks.push({ valor: v, y: this.yDe(v), texto: this.texto(v, true) });
    }
    return ticks;
  });

  ranura = computed(() => (ANCHO - MARGEN.izquierda - MARGEN.derecha) / Math.max(1, this.puntos().length));

  cadaCuanto = computed(() => Math.max(1, Math.ceil(this.puntos().length / 12)));

  columnas = computed<Columna[]>(() => {
    const ranura = this.ranura();
    const ancho = Math.max(1, Math.min(24, ranura * 0.7));
    return this.puntos().map((punto, i) => {
      const ranuraX = MARGEN.izquierda + i * ranura;
      const x = ranuraX + (ranura - ancho) / 2;
      return { x, ancho, ranuraX, punto, path: this.pathColumna(x, ancho, this.yDe(punto.valor)) };
    });
  });

  maximo = computed(() => {
    const columnas = this.columnas();
    if (this.vacio() || !columnas.length) return null;
    const mejor = columnas.reduce((a, b) => (b.punto.valor > a.punto.valor ? b : a));
    const centro = mejor.x + mejor.ancho / 2;
    const anclaje = centro > ANCHO - 50 ? 'end' : centro < MARGEN.izquierda + 40 ? 'start' : 'middle';
    return {
      x: anclaje === 'end' ? mejor.x + mejor.ancho : anclaje === 'start' ? mejor.x : centro,
      y: this.yDe(mejor.punto.valor) - 6,
      texto: this.texto(mejor.punto.valor, false),
      anclaje
    };
  });

  tooltip = computed(() => {
    const i = this.activo();
    if (i === null) return null;
    const columna = this.columnas()[i];
    if (!columna) return null;
    return {
      izquierda: ((columna.x + columna.ancho / 2) / ANCHO) * 100,
      titulo: columna.punto.titulo,
      valor: this.texto(columna.punto.valor, false)
    };
  });

  private yDe(valor: number): number {
    return this.base - (valor / this.escala().tope) * this.altoGrafico;
  }

  private pathColumna(x: number, ancho: number, y: number): string {
    const alto = this.base - y;
    if (alto <= 0) return '';
    const r = Math.min(4, ancho / 2, alto);
    return (
      `M${x},${this.base} V${y + r} Q${x},${y} ${x + r},${y} ` +
      `H${x + ancho - r} Q${x + ancho},${y} ${x + ancho},${y + r} V${this.base} Z`
    );
  }

  private texto(valor: number, corto: boolean): string {
    if (this.formato === 'entero') return formatearEntero(valor);
    return corto ? formatearMonedaCorta(valor) : formatearMoneda(valor);
  }
}
