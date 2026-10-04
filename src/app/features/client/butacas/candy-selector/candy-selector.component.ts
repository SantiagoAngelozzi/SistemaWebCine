import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';

import { CatalogoCandy, CategoriaConProductos, ComboConItems } from '../../../../core/models/candy.model';
import { TipoItemCandy } from '../../../../core/models/compra.model';

export const MAX_UNIDADES_POR_ITEM = 20;

export interface CambioCantidadCandy {
  tipo: TipoItemCandy;
  id: string;
  cantidad: number;
}

export function claveCarrito(tipo: TipoItemCandy, id: string): string {
  return `${tipo}:${id}`;
}

@Component({
  selector: 'app-candy-selector',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './candy-selector.component.html',
  styleUrl: './candy-selector.component.scss'
})
export class CandySelectorComponent {
  @Input({ required: true }) catalogo!: CatalogoCandy;
  @Input({ required: true }) carrito!: Map<string, number>;
  @Input({ required: true }) precioEntrada = 0;
  @Input({ required: true }) cantidadButacas = 0;
  @Input({ required: true }) combosConEntradaEnCarrito = 0;

  @Output() cambiarCantidad = new EventEmitter<CambioCantidadCandy>();

  readonly maxUnidades = MAX_UNIDADES_POR_ITEM;
  categoriaActiva = signal<string>('todas');

  cantidad(tipo: TipoItemCandy, id: string): number {
    return this.carrito.get(claveCarrito(tipo, id)) ?? 0;
  }

  categoriasVisibles(): CategoriaConProductos[] {
    const activa = this.categoriaActiva();
    return activa === 'todas'
      ? this.catalogo.categorias
      : this.catalogo.categorias.filter((c) => c.id === activa);
  }

  precioPorSeparado(combo: ComboConItems): number {
    const productos = combo.items.reduce((acc, item) => acc + item.precio * item.cantidad, 0);
    const entrada = combo.incluye_entrada ? this.precioEntrada : 0;
    return Math.round((productos + entrada) * 100) / 100;
  }

  ahorro(combo: ComboConItems): number {
    return Math.max(0, Math.round((this.precioPorSeparado(combo) - combo.precio) * 100) / 100);
  }

  puedeSumar(tipo: TipoItemCandy, id: string, incluyeEntrada = false): boolean {
    if (this.cantidad(tipo, id) >= this.maxUnidades) return false;
    if (incluyeEntrada && this.combosConEntradaEnCarrito >= this.cantidadButacas) return false;
    return true;
  }

  sumar(tipo: TipoItemCandy, id: string, incluyeEntrada = false): void {
    if (!this.puedeSumar(tipo, id, incluyeEntrada)) return;
    this.cambiarCantidad.emit({ tipo, id, cantidad: this.cantidad(tipo, id) + 1 });
  }

  restar(tipo: TipoItemCandy, id: string): void {
    const actual = this.cantidad(tipo, id);
    if (actual <= 0) return;
    this.cambiarCantidad.emit({ tipo, id, cantidad: actual - 1 });
  }
}
