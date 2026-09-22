import { Injectable, inject } from '@angular/core';

import { SalaConCantidadButacas, TipoButaca } from '../models/sala.model';
import { SupabaseService } from './supabase.service';

// Geometria fija de las salas, tal como la definio la catedra:
// - Filas estandar (A-I, L-Q): 3 columnas de 4, 20 y 4 = 28 butacas/fila.
// - Filas accesibles (J, K): se recorta cada bloque a 2, 10 y 2 = 14/fila.
// - Filas VIP (R, S, T): mismo ancho que las estandar (28/fila).
// La numeracion de columna deja los pasillos en las posiciones 5 y 26
// (por eso los arrays saltean esos numeros), para que coincida con como
// se ve/numera una sala de cine real.
const FILAS_ESTANDAR = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'L', 'M', 'N', 'O', 'P', 'Q'];
const FILAS_ACCESIBLES = ['J', 'K'];
const FILAS_VIP = ['R', 'S', 'T'];

const COLUMNAS_COMPLETAS = [
  1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29, 30
];
const COLUMNAS_ACCESIBLES = [2, 3, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 28, 29];

@Injectable({ providedIn: 'root' })
export class SalasService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<SalaConCantidadButacas[]> {
    const { data, error } = await this.supabase.client
      .from('salas')
      .select('*, butacas(count)')
      .order('nombre');

    if (error) throw error;

    return (data ?? []).map((fila: any) => ({
      id: fila.id,
      nombre: fila.nombre,
      cantidadButacas: fila.butacas?.[0]?.count ?? 0
    }));
  }

  async crear(nombre: string): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('salas')
      .insert({ nombre })
      .select('id')
      .single();

    if (error) throw error;

    const butacas = this.generarButacas(data.id);
    const { error: errorButacas } = await this.supabase.client.from('butacas').insert(butacas);
    if (errorButacas) throw errorButacas;

    return data.id;
  }

  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('salas').delete().eq('id', id);
    if (error) throw error;
  }

  private generarButacas(
    salaId: string
  ): { sala_id: string; fila: string; columna: number; tipo: TipoButaca }[] {
    const butacas: { sala_id: string; fila: string; columna: number; tipo: TipoButaca }[] = [];

    for (const fila of FILAS_ESTANDAR) {
      for (const columna of COLUMNAS_COMPLETAS) {
        butacas.push({ sala_id: salaId, fila, columna, tipo: 'estandar' });
      }
    }
    for (const fila of FILAS_ACCESIBLES) {
      for (const columna of COLUMNAS_ACCESIBLES) {
        butacas.push({ sala_id: salaId, fila, columna, tipo: 'accesible' });
      }
    }
    for (const fila of FILAS_VIP) {
      for (const columna of COLUMNAS_COMPLETAS) {
        butacas.push({ sala_id: salaId, fila, columna, tipo: 'vip' });
      }
    }

    return butacas;
  }
}