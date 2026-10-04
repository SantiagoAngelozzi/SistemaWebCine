import { Injectable, inject } from '@angular/core';

import { ResultadoValidacion, TipoValidacion } from '../models/validacion.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ValidacionService {
  private supabase = inject(SupabaseService);

  async validar(codigo: string, tipo: TipoValidacion): Promise<ResultadoValidacion> {
    const { data, error } = await this.supabase.client.rpc('validar_qr', {
      p_codigo: codigo,
      p_tipo: tipo
    });

    if (error || !data) throw new Error(error?.message ?? 'No se pudo validar el código.');
    return data as ResultadoValidacion;
  }
}

export function formatearCodigoCorto(codigo: string | null | undefined): string {
  if (!codigo) return '';
  const limpio = codigo.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return limpio.length === 8 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio;
}
