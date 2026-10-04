import { Injectable, inject } from '@angular/core';

import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class AlertasService {
  private supabase = inject(SupabaseService);

  private async obtenerUsuarioId(): Promise<string | null> {
    const {
      data: { session }
    } = await this.supabase.client.auth.getSession();
    return session?.user.id ?? null;
  }

  async estaLogueado(): Promise<boolean> {
    return (await this.obtenerUsuarioId()) !== null;
  }

  async listarMias(): Promise<Set<string>> {
    const usuarioId = await this.obtenerUsuarioId();
    if (!usuarioId) return new Set();

    const { data, error } = await this.supabase.client
      .from('alertas_estreno')
      .select('pelicula_id')
      .eq('usuario_id', usuarioId);

    if (error) throw error;
    return new Set((data ?? []).map((fila: any) => fila.pelicula_id as string));
  }

  async activar(peliculaId: string): Promise<void> {
    const usuarioId = await this.obtenerUsuarioId();
    if (!usuarioId) throw new Error('Necesitás iniciar sesión para activar alertas.');

    const { error } = await this.supabase.client
      .from('alertas_estreno')
      .insert({ usuario_id: usuarioId, pelicula_id: peliculaId });

    if (error) throw error;
  }

  async desactivar(peliculaId: string): Promise<void> {
    const usuarioId = await this.obtenerUsuarioId();
    if (!usuarioId) return;

    const { error } = await this.supabase.client
      .from('alertas_estreno')
      .delete()
      .eq('usuario_id', usuarioId)
      .eq('pelicula_id', peliculaId);

    if (error) throw error;
  }
}
