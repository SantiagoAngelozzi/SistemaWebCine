import { Injectable, inject } from '@angular/core';

import {
  FuncionConDetalle,
  FuncionDePelicula,
  FuncionFormValue,
  ResultadoCancelacionFuncion,
  ResumenCancelacion
} from '../models/funcion.model';
import { hoyIso } from '../utils/formato';
import { funcionYaComenzo, precioVigente } from '../utils/pelicula-fechas';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FuncionesService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<FuncionConDetalle[]> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select(
        '*, peliculas(nombre, precio_normal, precio_preventa, dias_preventa, fecha_estreno), salas(nombre), compra_entradas(activa), lista_espera(estado)'
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
      tieneCompras: (fila.compra_entradas ?? []).length > 0,
      enEspera: (fila.lista_espera ?? []).filter((l: any) => l.estado === 'esperando' || l.estado === 'notificado').length
    }));
  }

  async listarProximasDePelicula(peliculaId: string): Promise<FuncionDePelicula[]> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select('*, salas(nombre)')
      .eq('pelicula_id', peliculaId)
      .eq('estado', 'activa')
      .gte('fecha', hoyIso())
      .order('fecha')
      .order('hora_inicio');

    if (error) throw error;
    return (data ?? [])
      .filter((fila: any) => !funcionYaComenzo(fila.fecha, fila.hora_inicio))
      .map((fila: any) => ({ ...fila, salaNombre: fila.salas?.nombre ?? '' }));
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

  async resumenCancelacion(id: string): Promise<ResumenCancelacion> {
    const { data, error } = await this.supabase.client.rpc('resumen_cancelacion_funcion', { p_funcion_id: id });
    if (error) throw new Error(error.message);
    return {
      compras: Number(data?.compras ?? 0),
      entradas: Number(data?.entradas ?? 0),
      creditoADevolver: Number(data?.credito_a_devolver ?? 0),
      comprasSinCuenta: Number(data?.compras_sin_cuenta ?? 0)
    };
  }

  async cancelar(id: string, motivo: string): Promise<ResultadoCancelacionFuncion> {
    const { data, error } = await this.supabase.client.rpc('cancelar_funcion', {
      p_funcion_id: id,
      p_motivo: motivo.trim() || null
    });
    if (error) throw new Error(error.message);
    return {
      compras: Number(data?.compras ?? 0),
      entradas: Number(data?.entradas ?? 0),
      creditoDevuelto: Number(data?.credito_devuelto ?? 0),
      comprasSinCuenta: Number(data?.compras_sin_cuenta ?? 0)
    };
  }
}
