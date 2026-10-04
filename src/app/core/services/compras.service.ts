import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';

import {
  CanjeSeleccionado,
  CompraConfirmada,
  FuncionParaCompra,
  ItemCandySeleccionado
} from '../models/compra.model';
import { Butaca, TipoButaca } from '../models/sala.model';
import { SupabaseService } from './supabase.service';
import { precioVigente } from '../utils/pelicula-fechas';

const RECARGO_VIP = 1.5;

@Injectable({ providedIn: 'root' })
export class ComprasService {
  private supabase = inject(SupabaseService);

    async obtenerFuncion(id: string): Promise<FuncionParaCompra> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select(
        '*, peliculas(nombre, clasificacion, duracion_minutos, precio_normal, precio_preventa, dias_preventa, fecha_estreno), salas(nombre)'
      )
      .eq('id', id)
      .single();

    if (error || !data) throw error ?? new Error('Función no encontrada.');

    return {
      id: data.id,
      fecha: data.fecha,
      hora_inicio: data.hora_inicio,
      hora_fin: data.hora_fin,
      formato: data.formato,
      idioma: data.idioma,
      precio: precioVigente(data.peliculas),
      sala_id: data.sala_id,
      salaNombre: data.salas?.nombre ?? '',
      peliculaId: data.pelicula_id,
      peliculaNombre: data.peliculas?.nombre ?? '',
      peliculaClasificacion: data.peliculas?.clasificacion ?? 'ATP',
      peliculaDuracion: data.peliculas?.duracion_minutos ?? 0,
      peliculaFechaEstreno: data.peliculas?.fecha_estreno ?? '',
      peliculaDiasPreventa: data.peliculas?.dias_preventa ?? 0
    };
  }

  async listarButacasDeSala(salaId: string): Promise<Butaca[]> {
    const { data, error } = await this.supabase.client
      .from('butacas')
      .select('*')
      .eq('sala_id', salaId)
      .order('fila')
      .order('columna');

    if (error) throw error;
    return data ?? [];
  }

  async listarButacasOcupadas(funcionId: string): Promise<Set<string>> {
    const { data, error } = await this.supabase.client
      .from('compra_entradas')
      .select('butaca_id')
      .eq('funcion_id', funcionId)
      .eq('activa', true);

    if (error) throw error;
    return new Set((data ?? []).map((fila: any) => fila.butaca_id));
  }

  calcularPrecioButaca(precioBase: number, tipo: TipoButaca): number {
    return tipo === 'vip' ? Math.round(precioBase * RECARGO_VIP * 100) / 100 : precioBase;
  }

  async confirmarCompra(
    funcionId: string,
    butacas: { id: string; tipo: TipoButaca }[],
    candy: ItemCandySeleccionado[] = [],
    usarCredito = false,
    codigoCupon: string | null = null,
    canjes: CanjeSeleccionado[] = []
  ): Promise<CompraConfirmada> {
    const { data, error } = await this.supabase.client.rpc('crear_compra_entradas', {
      p_funcion_id: funcionId,
      p_butaca_ids: butacas.map((butaca) => butaca.id),
      p_items: candy
        .filter((item) => item.cantidad > 0)
        .map((item) => ({ tipo: item.tipo, id: item.id, cantidad: item.cantidad })),
      p_usar_credito: usarCredito,
      p_codigo_cupon: codigoCupon?.trim() || null,
      p_canjes: canjes.filter((c) => c.cantidad > 0).map((c) => ({ id: c.id, cantidad: c.cantidad }))
    });

    if (error || !data) throw new Error(error?.message ?? 'No se pudo crear la compra.');

    const compra = data as CompraConfirmada;
    return {
      ...compra,
      subtotal: Number(compra.subtotal ?? compra.total),
      descuento_porcentaje: Number(compra.descuento_porcentaje ?? 0),
      descuento_monto: Number(compra.descuento_monto ?? 0),
      total: Number(compra.total),
      credito_usado: Number(compra.credito_usado ?? 0),
      a_pagar: Number(compra.a_pagar ?? compra.total),
      puntos_ganados: Number(compra.puntos_ganados ?? 0),
      puntos_canjeados: Number(compra.puntos_canjeados ?? 0),
      entradas: (compra.entradas ?? []).map((e) => ({ ...e, precio: Number(e.precio) })),
      candy: (compra.candy ?? []).map((c) => ({ ...c, precio_unitario: Number(c.precio_unitario) }))
    };
  }

  suscribirseAOcupacion(
    funcionId: string,
    onNuevaOcupacion: (butacaId: string) => void,
    onLiberada: (butacaId: string) => void = () => {}
  ): RealtimeChannel {
    const filtro = {
      schema: 'public',
      table: 'compra_entradas',
      filter: `funcion_id=eq.${funcionId}`
    };
    return this.supabase.client
      .channel(`ocupacion-funcion-${funcionId}`)
      .on('postgres_changes', { event: 'INSERT', ...filtro }, (payload) =>
        onNuevaOcupacion((payload.new as any).butaca_id)
      )
      .on('postgres_changes', { event: 'UPDATE', ...filtro }, (payload) => {
        const fila = payload.new as any;
        if (fila.activa === false) onLiberada(fila.butaca_id);
      })
      .subscribe();
  }

  crearCanalSeleccion(funcionId: string): RealtimeChannel {
    return this.supabase.client.channel(`seleccion-funcion-${funcionId}`);
  }
}
