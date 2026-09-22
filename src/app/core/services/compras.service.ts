import { Injectable, inject } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';

import { FuncionParaCompra } from '../models/compra.model';
import { Butaca, TipoButaca } from '../models/sala.model';
import { SupabaseService } from './supabase.service';

// Las butacas VIP salen un 50% mas caras que el precio base de la funcion.
// El PDF pide que sean "mas caras" sin dar un numero exacto; queda aca
// centralizado para ajustarlo facil si hace falta.
const RECARGO_VIP = 1.5;

@Injectable({ providedIn: 'root' })
export class ComprasService {
  private supabase = inject(SupabaseService);

  async obtenerFuncion(id: string): Promise<FuncionParaCompra> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select('*, peliculas(nombre, clasificacion, duracion_minutos), salas(nombre)')
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
      precio: data.precio,
      sala_id: data.sala_id,
      salaNombre: data.salas?.nombre ?? '',
      peliculaId: data.pelicula_id,
      peliculaNombre: data.peliculas?.nombre ?? '',
      peliculaClasificacion: data.peliculas?.clasificacion ?? 'ATP',
      peliculaDuracion: data.peliculas?.duracion_minutos ?? 0
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
    // Nota: no filtramos por estado de la compra porque todavia no existe
    // el flujo de cancelacion (toda compra queda "confirmada" por ahora).
    // Cuando se implemente cancelacion, ajustar esta consulta.
    const { data, error } = await this.supabase.client
      .from('compra_entradas')
      .select('butaca_id')
      .eq('funcion_id', funcionId);

    if (error) throw error;
    return new Set((data ?? []).map((fila: any) => fila.butaca_id));
  }

  calcularPrecioButaca(precioBase: number, tipo: TipoButaca): number {
    return tipo === 'vip' ? Math.round(precioBase * RECARGO_VIP * 100) / 100 : precioBase;
  }

  async confirmarCompra(
    funcionId: string,
    butacas: { id: string; tipo: TipoButaca }[],
    precioBase: number,
    usuarioId: string | null
  ): Promise<string> {
    const codigoQr = crypto.randomUUID();
    const total = butacas.reduce((acc, b) => acc + this.calcularPrecioButaca(precioBase, b.tipo), 0);

    const { data: compra, error: errorCompra } = await this.supabase.client
      .from('compras')
      .insert({
        usuario_id: usuarioId,
        total,
        estado: 'confirmada',
        codigo_qr: codigoQr
      })
      .select('id')
      .single();

    if (errorCompra || !compra) throw errorCompra ?? new Error('No se pudo crear la compra.');

    const filas = butacas.map((b) => ({
      compra_id: compra.id,
      funcion_id: funcionId,
      butaca_id: b.id,
      precio: this.calcularPrecioButaca(precioBase, b.tipo)
    }));

    const { error: errorEntradas } = await this.supabase.client.from('compra_entradas').insert(filas);

    if (errorEntradas) {
      // Si fallo (ej: alguien compro la misma butaca un instante antes,
      // rompe el unique(funcion_id, butaca_id)), deshacemos la compra para
      // no dejar un registro huerfano sin entradas asociadas.
      await this.supabase.client.from('compras').delete().eq('id', compra.id);
      throw new Error(
        'Una o más butacas ya fueron vendidas justo ahora por otra persona. Elegí otras y volvé a intentar.'
      );
    }

    return codigoQr;
  }

  suscribirseAOcupacion(funcionId: string, onNuevaOcupacion: (butacaId: string) => void): RealtimeChannel {
    return this.supabase.client
      .channel(`ocupacion-funcion-${funcionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'compra_entradas',
          filter: `funcion_id=eq.${funcionId}`
        },
        (payload) => onNuevaOcupacion((payload.new as any).butaca_id)
      )
      .subscribe();
  }

  crearCanalSeleccion(funcionId: string): RealtimeChannel {
    return this.supabase.client.channel(`seleccion-funcion-${funcionId}`);
  }
}