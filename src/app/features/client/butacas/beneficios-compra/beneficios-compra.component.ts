import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { DescuentoAplicable, Recompensa } from '../../../../core/models/fidelizacion.model';

export const MAX_CANJES_POR_RECOMPENSA = 20;

export interface CambioCanje {
  id: string;
  cantidad: number;
}

@Component({
  selector: 'app-beneficios-compra',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './beneficios-compra.component.html',
  styleUrl: './beneficios-compra.component.scss'
})
export class BeneficiosCompraComponent {
  @Input({ required: true }) logueado = false;
  @Input() descuento: DescuentoAplicable | null = null;
  @Input() cuponAplicado: string | null = null;
  @Input() errorCupon: string | null = null;
  @Input() validandoCupon = false;

  @Input() puntosDisponibles = 0;
  @Input() puntosComprometidos = 0;
  @Input() recompensas: Recompensa[] = [];
  @Input() canjes: Map<string, number> = new Map();
  @Input() butacasLibresParaCanje = 0;

  @Output() aplicarCupon = new EventEmitter<string>();
  @Output() quitarCupon = new EventEmitter<void>();
  @Output() cambiarCanje = new EventEmitter<CambioCanje>();

  codigo = '';

  get esBienvenida(): boolean {
    return this.descuento?.origen === 'bienvenida';
  }

  get puntosRestantes(): number {
    return this.puntosDisponibles - this.puntosComprometidos;
  }

  cantidad(recompensa: Recompensa): number {
    return this.canjes.get(recompensa.id) ?? 0;
  }

  puedeSumar(recompensa: Recompensa): boolean {
    if (this.cantidad(recompensa) >= MAX_CANJES_POR_RECOMPENSA) return false;
    if (recompensa.costo_puntos > this.puntosRestantes) return false;
    if (recompensa.otorga_entrada && this.butacasLibresParaCanje <= 0) return false;
    return true;
  }

  motivoNoSuma(recompensa: Recompensa): string | null {
    if (recompensa.costo_puntos > this.puntosRestantes) return 'Puntos insuficientes';
    if (recompensa.otorga_entrada && this.butacasLibresParaCanje <= 0) return 'Sumá otra butaca';
    return null;
  }

  sumar(recompensa: Recompensa): void {
    if (!this.puedeSumar(recompensa)) return;
    this.cambiarCanje.emit({ id: recompensa.id, cantidad: this.cantidad(recompensa) + 1 });
  }

  restar(recompensa: Recompensa): void {
    const actual = this.cantidad(recompensa);
    if (actual <= 0) return;
    this.cambiarCanje.emit({ id: recompensa.id, cantidad: actual - 1 });
  }

  enviarCupon(): void {
    const codigo = this.codigo.trim();
    if (!codigo || this.validandoCupon) return;
    this.aplicarCupon.emit(codigo);
  }

  sacarCupon(): void {
    this.codigo = '';
    this.quitarCupon.emit();
  }
}
