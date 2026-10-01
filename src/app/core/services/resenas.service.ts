import { Injectable, inject } from '@angular/core';

import { FuncionVista, MiPelicula, ResumenResenas } from '../models/resena.model';
import { SupabaseService } from './supabase.service';

/** Largo máximo del comentario (el mismo límite está en la base). */
export const MAX_COMENTARIO_RESENA = 500;

/**
 * Reseñas y "Mis Películas". Las reglas (sólo califica quien vio la
 * película, 1 a 5 estrellas, comentario breve) se validan en la base:
 * RPC guardar_resena + políticas RLS de la tabla resenas.
 */
@Injectable({ providedIn: 'root' })
export class ResenasService {
  private supabase = inject(SupabaseService);

  /** Promedio, distribución y reseñas de una película (también para visitantes). */
  async obtenerResumen(peliculaId: string): Promise<ResumenResenas> {
    const { data, error } = await this.supabase.client.rpc('resenas_de_pelicula', {
      p_pelicula_id: peliculaId
    });
    if (error) throw error;

    const r = (data ?? {}) as any;
    return {
      promedio: Number(r.promedio ?? 0),
      cantidad: Number(r.cantidad ?? 0),
      distribucion: ((r.distribucion ?? [0, 0, 0, 0, 0]) as unknown[]).map(Number),
      puedeResenar: !!r.puede_resenar,
      resenas: ((r.resenas ?? []) as any[]).map((fila) => ({
        id: fila.id,
        calificacion: Number(fila.calificacion),
        comentario: fila.comentario ?? null,
        creadaEl: fila.created_at,
        editada: !!fila.editada,
        autor: fila.autor ?? 'Espectador',
        esMia: !!fila.es_mia
      }))
    };
  }

  /** Crea la reseña propia o la reemplaza si ya existía (una por película). */
  async guardarResena(peliculaId: string, calificacion: number, comentario: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('guardar_resena', {
      p_pelicula_id: peliculaId,
      p_calificacion: calificacion,
      p_comentario: comentario
    });
    if (error) throw error;
  }

  /** Borra una reseña: la propia, o cualquiera si es administrador (RLS). */
  async eliminarResena(resenaId: string): Promise<void> {
    const { error } = await this.supabase.client.from('resenas').delete().eq('id', resenaId);
    if (error) throw error;
  }

  /** Películas que el usuario vio, con sus funciones y su calificación. */
  async listarMisPeliculas(): Promise<MiPelicula[]> {
    const { data, error } = await this.supabase.client.rpc('mis_peliculas');
    if (error) throw error;

    return ((data ?? []) as any[]).map((fila) => ({
      peliculaId: fila.pelicula_id,
      nombre: fila.nombre,
      imagenUrl: fila.imagen_url ?? null,
      clasificacion: fila.clasificacion,
      duracionMinutos: Number(fila.duracion_minutos ?? 0),
      veces: Number(fila.veces ?? 1),
      funciones: ((fila.funciones ?? []) as any[]).map(
        (f): FuncionVista => ({
          fecha: f.fecha,
          horaInicio: String(f.hora_inicio ?? '').slice(0, 5),
          sala: f.sala ?? '',
          formato: f.formato ?? ''
        })
      ),
      calificacion: fila.calificacion == null ? null : Number(fila.calificacion),
      comentario: fila.comentario ?? null
    }));
  }
}

/** Mensaje legible para errores de reseñas (los RAISE de la base vienen con code P0001). */
export function mensajeErrorResena(err: any, porDefecto: string): string {
  if (err?.code === 'P0001' && err?.message) return err.message;
  if (err?.code === '42501') return 'No tenés permiso para hacer eso.';
  return porDefecto;
}
