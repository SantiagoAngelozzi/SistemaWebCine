import { Injectable, inject } from '@angular/core';

import { RolUsuario } from './auth.service';
import { SupabaseService } from './supabase.service';

export interface UsuarioResumen {
  id: string;
  email: string;
  nombre: string | null;
  apellido: string | null;
  rol: RolUsuario;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<UsuarioResumen[]> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, email, nombre, apellido, rol, created_at')
      .order('email');

    if (error) throw error;
    return (data ?? []) as UsuarioResumen[];
  }

  async cambiarRol(usuarioId: string, rol: RolUsuario): Promise<void> {
    const { error } = await this.supabase.client.rpc('cambiar_rol_usuario', {
      p_usuario_id: usuarioId,
      p_rol: rol
    });
    if (error) throw new Error(error.message);
  }
}
