import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';

import { SupabaseService } from './supabase.service';

export interface RegistroAuditoria {
  id: string;
  accion: string;
  entidad: string | null;
  entidadId: string | null;
  detalle: Record<string, any> | null;
  creadoEl: string;
  responsable: { nombre: string; email: string; rol: string } | null;
}

export type TipoAccion = 'todas' | 'altas' | 'modificaciones' | 'bajas' | 'qr' | 'cancelaciones' | 'roles';

export const ACCIONES_POR_TIPO: Record<Exclude<TipoAccion, 'todas'>, string[]> = {
  altas: ['INSERT'],
  modificaciones: ['UPDATE'],
  bajas: ['DELETE'],
  qr: ['QR_VALIDADO_SALA', 'QR_ENTREGA_CANDY', 'QR_RECHAZADO'],
  cancelaciones: ['COMPRA_CANCELADA'],
  roles: ['CAMBIO_ROL']
};

export interface FiltrosAuditoria {
  desde: string | null;
  hasta: string | null;
  entidad: string | null;
  tipo: TipoAccion;
}

const SELECT = 'id, accion, entidad, entidad_id, detalle, created_at, usuarios(nombre, apellido, email, rol)';

@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private supabase = inject(SupabaseService);

  async listar(
    filtros: FiltrosAuditoria,
    pagina: number,
    tamanio: number
  ): Promise<{ registros: RegistroAuditoria[]; total: number }> {
    let consulta = this.supabase.client
      .from('log_auditoria')
      .select(SELECT, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (filtros.desde) consulta = consulta.gte('created_at', inicioDelDia(filtros.desde));
    if (filtros.hasta) consulta = consulta.lt('created_at', inicioDelDia(filtros.hasta, 1));
    if (filtros.entidad) consulta = consulta.eq('entidad', filtros.entidad);
    if (filtros.tipo !== 'todas') consulta = consulta.in('accion', ACCIONES_POR_TIPO[filtros.tipo]);

    const desde = pagina * tamanio;
    const { data, error, count } = await consulta.range(desde, desde + tamanio - 1);
    if (error) throw error;

    return { registros: (data ?? []).map(mapearRegistro), total: count ?? 0 };
  }

  async obtener(id: string): Promise<RegistroAuditoria | null> {
    const { data, error } = await this.supabase.client.from('log_auditoria').select(SELECT).eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? mapearRegistro(data) : null;
  }

  suscribirse(alInsertar: (id: string) => void): RealtimeChannel {
    return this.supabase.client
      .channel('auditoria-en-vivo')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'log_auditoria' }, (payload: any) => {
        const id = payload?.new?.id;
        if (id) alInsertar(id);
      })
      .subscribe();
  }

  desuscribirse(canal: RealtimeChannel): void {
    this.supabase.client.removeChannel(canal);
  }
}

function mapearRegistro(fila: any): RegistroAuditoria {
  const usuario = Array.isArray(fila.usuarios) ? fila.usuarios[0] : fila.usuarios;
  return {
    id: fila.id,
    accion: fila.accion,
    entidad: fila.entidad ?? null,
    entidadId: fila.entidad_id ?? null,
    detalle: fila.detalle ?? null,
    creadoEl: fila.created_at,
    responsable: usuario
      ? {
          nombre: `${usuario.nombre ?? ''} ${usuario.apellido ?? ''}`.trim() || usuario.email,
          email: usuario.email ?? '',
          rol: usuario.rol ?? ''
        }
      : null
  };
}

function inicioDelDia(iso: string, masDias = 0): string {
  const [anio, mes, dia] = iso.split('-').map(Number);
  return new Date(anio, mes - 1, dia + masDias).toISOString();
}
