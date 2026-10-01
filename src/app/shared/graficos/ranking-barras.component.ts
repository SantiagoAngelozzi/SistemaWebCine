import { Component, Input } from '@angular/core';

import { ItemRanking } from '../../core/models/reporte.model';
import { formatearEntero, formatearMoneda } from '../../core/utils/formato';

/**
 * Ranking con barras horizontales (películas más vistas, productos más vendidos).
 * La barra es proporcional al primero; los números van en color tinta, al final.
 */
@Component({
  selector: 'app-ranking-barras',
  standalone: true,
  template: `
    @if (!items.length) {
      <p class="vacio">{{ textoVacio }}</p>
    } @else {
      <ol class="ranking">
        @for (item of items; track item.nombre; let i = $index) {
          <li [title]="item.nombre + ': ' + cantidadTexto(item) + ' · ' + recaudacionTexto(item)">
            <span class="pos">{{ i + 1 }}</span>
            <div class="cuerpo">
              <div class="fila">
                <span class="nombre">{{ item.nombre }}</span>
                <span class="valor">{{ cantidadTexto(item) }}</span>
              </div>
              <div class="pista">
                <div class="barra" [style.width.%]="porcentaje(item)" [style.background]="color"></div>
              </div>
              @if (mostrarRecaudacion && item.recaudacion > 0) {
                <span class="secundario">{{ recaudacionTexto(item) }}</span>
              }
            </div>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    :host { display: block; }
    .ranking { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
    li { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; align-items: start; }
    .pos {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px;
      border: 2px solid var(--color-tinta); border-radius: 50%;
      font-size: 12px; font-weight: 700; background: var(--color-papel-2);
    }
    li:first-child .pos { background: var(--color-lima); }
    .fila { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
    .nombre { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .valor { font-weight: 700; white-space: nowrap; }
    .pista { height: 14px; margin-top: 3px; }
    .barra { height: 100%; min-width: 3px; border-radius: 0 4px 4px 0; }
    .secundario { font-size: 12px; opacity: 0.7; }
    .vacio { margin: 0; padding: 16px 0; text-align: center; opacity: 0.7; font-size: 14px; }
  `
})
export class RankingBarrasComponent {
  @Input({ required: true }) items: ItemRanking[] = [];
  @Input() color = '#A6339B';
  /** "entradas", "unidades"... */
  @Input() unidad = 'unidades';
  @Input() mostrarRecaudacion = true;
  @Input() textoVacio = 'Sin ventas en el período.';

  porcentaje(item: ItemRanking): number {
    const maximo = Math.max(...this.items.map((i) => i.cantidad), 0);
    return maximo ? (item.cantidad / maximo) * 100 : 0;
  }

  cantidadTexto(item: ItemRanking): string {
    return `${formatearEntero(item.cantidad)} ${this.unidad}`;
  }

  recaudacionTexto(item: ItemRanking): string {
    return formatearMoneda(item.recaudacion);
  }
}
