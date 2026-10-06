import { Injectable, inject } from '@angular/core';

import { FuncionConDetalle, FuncionFormValue } from '../models/funcion.model';
import { precioVigente } from '../utils/pelicula-fechas';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FuncionesService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<FuncionConDetalle[]> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select(
        '*, peliculas(nombre, precio_normal, precio_preventa, dias_preventa, fecha_estreno), salas(nombre), compra_entradas(activa)'
      )
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) throw error;

    return (data ?? []).map((fila: any) => ({
      ...fila,
      peliculaNombre: fila.peliculas?.nombre ?? '(película eliminada)',
      salaNombre: fila.salas?.nombre ?? '(sala eliminada)',
      precioVigente: fila.peliculas ? precioVigente(fila.peliculas) : 0,
      entradasVendidas: (fila.compra_entradas ?? []).filter((e: any) => e.activa).length,
      tieneCompras: (fila.compra_entradas ?? []).length > 0
    }));
  }

  async crear(valores: FuncionFormValue): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_funcion_automatica', {
      p_pelicula_id: valores.peliculaId,
      p_fecha: valores.fecha,
      p_hora_inicio: valores.horaInicio,
      p_formato: valores.formato,
      p_idioma: valores.idioma
    });

    if (error) throw new Error(error.message);
    return data as string;
  }

  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('eliminar_funcion', { p_funcion_id: id });
    if (error) throw new Error(error.message);
  }
}
