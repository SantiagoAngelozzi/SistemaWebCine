import { Injectable, inject } from '@angular/core';

import { EstadoEsperaFuncion, MiListaEspera, ReservasListaEspera } from '../models/lista-espera.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ListaEsperaService {
  private supabase = inject(SupabaseService);

  async estadoDeFunciones(funcionIds: string[]): Promise<Map<string, EstadoEsperaFuncion>> {
    if (!funcionIds.length) return new Map();
    const { data, error } = await this.supabase.client.rpc('estado_lista_espera', { p_funcion_ids: funcionIds });
    if (error) throw new Error(error.message);

    return new Map(
      ((data ?? []) as any[]).map((fila) => [
        fila.funcion_id as string,
        {
          funcionId: fila.funcion_id,
          agotada: !!fila.agotada,
          enEspera: Number(fila.en_espera ?? 0),
          miEstado: fila.mi_estado ?? null,
          miPosicion: fila.mi_posicion != null ? Number(fila.mi_posicion) : null,
          miExpiraAt: fila.mi_expira_at ?? null
        }
      ])
    );
  }

  async anotarse(funcionId: string): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('anotarse_lista_espera', { p_funcion_id: funcionId });
    if (error) throw new Error(error.message);
    return Number(data?.posicion ?? 0);
  }

  async salir(funcionId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('salir_lista_espera', { p_funcion_id: funcionId });
    if (error) throw new Error(error.message);
  }

  async misListas(): Promise<MiListaEspera[]> {
    const { data, error } = await this.supabase.client.rpc('mis_listas_espera');
    if (error) throw new Error(error.message);

    return ((data ?? []) as any[]).map((fila) => ({
      id: fila.id,
      funcionId: fila.funcion_id,
      peliculaId: fila.pelicula_id,
      pelicula: fila.pelicula,
      imagenUrl: fila.imagen_url ?? null,
      sala: fila.sala,
      fecha: fila.fecha,
      horaInicio: fila.hora_inicio,
      formato: fila.formato,
      estado: fila.estado,
      posicion: fila.posicion != null ? Number(fila.posicion) : null,
      expiraAt: fila.expira_at ?? null,
      butaca: fila.butaca ?? null,
      anotadoEl: fila.anotado_at
    }));
  }

  async reservas(funcionId: string): Promise<ReservasListaEspera> {
    const { data, error } = await this.supabase.client.rpc('reservas_lista_espera', { p_funcion_id: funcionId });
    if (error) throw new Error(error.message);
    const mia = data?.mia;
    return {
      reservadas: (data?.reservadas ?? []) as string[],
      mia: mia ? { butacaId: mia.butaca_id, ubicacion: mia.ubicacion, expiraAt: mia.expira_at } : null
    };
  }

  async procesarVencidos(funcionId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('procesar_lista_espera', { p_funcion_id: funcionId });
    if (error) console.error(error);
  }
}
