import { Injectable, inject } from '@angular/core';

import { RolPersonalizado, SeccionAsignable } from '../models/rol.model';
import { SupabaseService } from './supabase.service';

export interface RolFormValue {
  nombre: string;
  descripcion: string;
  secciones: SeccionAsignable[];
}

@Injectable({ providedIn: 'root' })
export class RolesService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<RolPersonalizado[]> {
    const [{ data, error }, { data: usuarios, error: errorUsuarios }] = await Promise.all([
      this.supabase.client.from('roles').select('id, nombre, descripcion, rol_permisos(seccion)').order('nombre'),
      this.supabase.client.from('usuarios').select('rol_personalizado_id').not('rol_personalizado_id', 'is', null)
    ]);

    if (error) throw error;
    if (errorUsuarios) throw errorUsuarios;

    const conteo = new Map<string, number>();
    for (const u of (usuarios ?? []) as { rol_personalizado_id: string }[]) {
      conteo.set(u.rol_personalizado_id, (conteo.get(u.rol_personalizado_id) ?? 0) + 1);
    }

    return (data ?? []).map((fila: any) => ({
      id: fila.id,
      nombre: fila.nombre,
      descripcion: fila.descripcion ?? null,
      secciones: (fila.rol_permisos ?? []).map((p: any) => p.seccion as SeccionAsignable),
      cantidadUsuarios: conteo.get(fila.id) ?? 0
    }));
  }

  async guardar(id: string | null, valores: RolFormValue): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('guardar_rol', {
      p_rol_id: id,
      p_nombre: valores.nombre,
      p_descripcion: valores.descripcion,
      p_secciones: valores.secciones
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('roles').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async asignar(usuarioId: string, rolId: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('asignar_rol_personalizado', {
      p_usuario_id: usuarioId,
      p_rol_id: rolId
    });
    if (error) throw new Error(error.message);
  }
}
