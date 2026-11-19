import { Injectable, inject } from '@angular/core';

import { EstadoPropuesta, PropuestaFormValue, PropuestaPelicula } from '../models/propuesta.model';
import { SupabaseService } from './supabase.service';

const SELECT = 'id, titulo, descripcion, motivo, estado, pelicula_id, created_at, resuelta_at, usuarios!propuestas_peliculas_usuario_id_fkey(nombre, apellido, email)';

@Injectable({ providedIn: 'root' })
export class PropuestasService {
  private supabase = inject(SupabaseService);

  async crear(valores: PropuestaFormValue): Promise<void> {
    const { error } = await this.supabase.client.from('propuestas_peliculas').insert({
      titulo: valores.titulo.trim(),
      descripcion: valores.descripcion.trim(),
      motivo: valores.motivo.trim()
    });
    if (error) throw new Error(traducirError(error));
  }

  async listarMias(): Promise<PropuestaPelicula[]> {
    const {
      data: { session }
    } = await this.supabase.client.auth.getSession();
    if (!session) return [];

    const { data, error } = await this.supabase.client
      .from('propuestas_peliculas')
      .select(SELECT)
      .eq('usuario_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map(mapear);
  }

  async listarTodas(): Promise<PropuestaPelicula[]> {
    const { data, error } = await this.supabase.client
      .from('propuestas_peliculas')
      .select(SELECT)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map(mapear);
  }

  async obtener(id: string): Promise<PropuestaPelicula | null> {
    const { data, error } = await this.supabase.client
      .from('propuestas_peliculas')
      .select(SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data ? mapear(data) : null;
  }

  async resolver(id: string, estado: Exclude<EstadoPropuesta, 'pendiente'>, peliculaId: string | null = null): Promise<void> {
    const { error } = await this.supabase.client.rpc('resolver_propuesta', {
      p_propuesta_id: id,
      p_estado: estado,
      p_pelicula_id: peliculaId
    });
    if (error) throw new Error(error.message);
  }
}

function mapear(fila: any): PropuestaPelicula {
  const autor = fila.usuarios
    ? `${fila.usuarios.nombre ?? ''} ${fila.usuarios.apellido ?? ''}`.trim() || fila.usuarios.email
    : null;
  return {
    id: fila.id,
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    motivo: fila.motivo,
    estado: fila.estado,
    peliculaId: fila.pelicula_id ?? null,
    creadaEl: fila.created_at,
    resueltaEl: fila.resuelta_at ?? null,
    autor
  };
}

function traducirError(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'Ya tenés una propuesta pendiente. Esperá a que la revisen para mandar otra.';
  if (error.code === 'P0001') return error.message;
  return 'No se pudo enviar la propuesta. Revisá los datos e intentá de nuevo.';
}
