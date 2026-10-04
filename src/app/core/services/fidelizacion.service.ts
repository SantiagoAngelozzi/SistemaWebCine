import { Injectable, inject } from '@angular/core';

import {
  Cupon,
  CuponConUsos,
  CuponFormValue,
  DescuentoAplicable,
  MovimientoPuntos,
  Recompensa,
  RecompensaFormValue
} from '../models/fidelizacion.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class FidelizacionService {
  private supabase = inject(SupabaseService);


  async obtenerBienvenida(): Promise<Cupon | null> {
    const { data, error } = await this.supabase.client
      .from('cupones')
      .select('*')
      .eq('tipo', 'bienvenida')
      .maybeSingle();

    if (error) throw error;
    return data ? this.mapearCupon(data) : null;
  }

  async guardarBienvenida(porcentaje: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('cupones')
      .update({ porcentaje_descuento: porcentaje, activo })
      .eq('tipo', 'bienvenida');
    if (error) throw error;
  }


  async listarCupones(): Promise<CuponConUsos[]> {
    const { data, error } = await this.supabase.client
      .from('cupones')
      .select('*, cupon_usos(compras(estado))')
      .neq('tipo', 'bienvenida')
      .order('codigo');

    if (error) throw error;
    return (data ?? []).map((fila: any) => ({
      ...this.mapearCupon(fila),
      usos: (fila.cupon_usos ?? []).filter((u: any) => u.compras?.estado === 'confirmada').length
    }));
  }

  async crearCupon(valores: CuponFormValue): Promise<void> {
    const { error } = await this.supabase.client.from('cupones').insert(this.mapearCuponATabla(valores));
    if (error) throw error;
  }

  async actualizarCupon(id: string, valores: CuponFormValue): Promise<void> {
    const { error } = await this.supabase.client
      .from('cupones')
      .update(this.mapearCuponATabla(valores))
      .eq('id', id);
    if (error) throw error;
  }

  async eliminarCupon(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('cupones').delete().eq('id', id);
    if (error) throw error;
  }

  private mapearCupon(fila: any): Cupon {
    return {
      id: fila.id,
      codigo: fila.codigo,
      tipo: fila.tipo,
      porcentaje_descuento: Number(fila.porcentaje_descuento),
      edad_minima: fila.edad_minima,
      edad_maxima: fila.edad_maxima,
      activo: fila.activo,
      fecha_desde: fila.fecha_desde,
      fecha_hasta: fila.fecha_hasta,
      usos_maximos: fila.usos_maximos
    };
  }

  private mapearCuponATabla(valores: CuponFormValue) {
    const segmentado = valores.tipo === 'segmentado_edad';
    return {
      codigo: valores.codigo.trim().toUpperCase(),
      tipo: valores.tipo,
      porcentaje_descuento: valores.porcentaje,
      edad_minima: segmentado ? valores.edadMinima : null,
      edad_maxima: segmentado ? valores.edadMaxima : null,
      fecha_desde: valores.fechaDesde || new Date().toISOString().slice(0, 10),
      fecha_hasta: valores.fechaHasta || null,
      usos_maximos: valores.usosMaximos || null,
      activo: valores.activo
    };
  }


  async listarRecompensas(soloActivas = false): Promise<Recompensa[]> {
    let query = this.supabase.client
      .from('recompensas_puntos')
      .select('*, candy_productos(nombre, activo)')
      .order('costo_puntos');

    if (soloActivas) query = query.eq('activo', true);

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? [])
      .filter((fila: any) => !soloActivas || fila.otorga_entrada || fila.candy_productos?.activo)
      .map((fila: any) => ({
        id: fila.id,
        nombre: fila.nombre,
        costo_puntos: fila.costo_puntos,
        otorga_entrada: fila.otorga_entrada,
        candy_producto_id: fila.candy_producto_id,
        activo: fila.activo,
        productoNombre: fila.candy_productos?.nombre ?? null
      }));
  }

  async crearRecompensa(valores: RecompensaFormValue): Promise<void> {
    const { error } = await this.supabase.client
      .from('recompensas_puntos')
      .insert(this.mapearRecompensaATabla(valores));
    if (error) throw error;
  }

  async actualizarRecompensa(id: string, valores: RecompensaFormValue): Promise<void> {
    const { error } = await this.supabase.client
      .from('recompensas_puntos')
      .update(this.mapearRecompensaATabla(valores))
      .eq('id', id);
    if (error) throw error;
  }

  async eliminarRecompensa(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('recompensas_puntos').delete().eq('id', id);
    if (error) throw error;
  }

  private mapearRecompensaATabla(valores: RecompensaFormValue) {
    const esEntrada = valores.tipo === 'entrada';
    return {
      nombre: valores.nombre.trim(),
      costo_puntos: valores.costoPuntos,
      otorga_entrada: esEntrada,
      candy_producto_id: esEntrada ? null : valores.candyProductoId,
      activo: valores.activo
    };
  }


  async consultarDescuento(codigo: string | null = null): Promise<DescuentoAplicable> {
    const { data, error } = await this.supabase.client.rpc('consultar_descuento', {
      p_codigo: codigo?.trim() || null
    });
    if (error || !data) throw new Error(error?.message ?? 'No se pudo consultar el descuento.');
    return {
      origen: data.origen,
      codigo: data.codigo,
      porcentaje: Number(data.porcentaje ?? 0),
      porcentaje_bienvenida: Number(data.porcentaje_bienvenida ?? 0),
      error_cupon: data.error_cupon
    };
  }

  async listarMovimientosPuntos(): Promise<MovimientoPuntos[]> {
    const { data, error } = await this.supabase.client
      .from('movimientos_puntos')
      .select('id, puntos, motivo, detalle, created_at, compras(codigo_corto)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((fila: any) => ({
      id: fila.id,
      puntos: fila.puntos,
      motivo: fila.motivo,
      detalle: fila.detalle,
      created_at: fila.created_at,
      compraCodigoCorto: fila.compras?.codigo_corto ?? null
    }));
  }
}

export function mensajeErrorFidelizacion(err: any, porDefecto: string): string {
  switch (err?.code) {
    case '23505':
      return 'Ya existe un cupón con ese código.';
    case '23503':
      return 'No se puede eliminar porque ya se usó en compras. Desactivalo para que no se pueda usar más.';
    case '23514':
      return 'Revisá los valores: el porcentaje va de 1 a 100 y la edad mínima no puede superar a la máxima.';
    default:
      return err?.message && err?.code === 'P0001' ? err.message : porDefecto;
  }
}
