import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  titulo: string;
  mensaje: string;
  textoConfirmar: string;
  textoCancelar: string;
}

export interface ConfirmOpciones {
  titulo?: string;
  textoConfirmar?: string;
  textoCancelar?: string;
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  // La request actual (o null si no hay ningun modal abierto). El
  // ConfirmModalComponent, montado una sola vez en AppComponent, escucha
  // este signal y se muestra solo cuando hay algo que preguntar.
  request = signal<ConfirmRequest | null>(null);

  private resolver: ((valor: boolean) => void) | null = null;

  preguntar(mensaje: string, opciones: ConfirmOpciones = {}): Promise<boolean> {
    this.request.set({
      titulo: opciones.titulo ?? '¿Estás seguro?',
      mensaje,
      textoConfirmar: opciones.textoConfirmar ?? 'Confirmar',
      textoCancelar: opciones.textoCancelar ?? 'Cancelar'
    });

    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  responder(valor: boolean): void {
    this.resolver?.(valor);
    this.resolver = null;
    this.request.set(null);
  }
}