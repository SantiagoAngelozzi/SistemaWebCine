import { Injectable, inject } from '@angular/core';

import {
  CandyMiCompra,
  EntradaMiCompra,
  EstadoMiCompra,
  MiCompra,
  MovimientoCredito,
  PerfilUsuario,
  ResultadoCancelacion
} from '../models/cuenta.model';
import { SupabaseService } from './supabase.service';

/** Horas antes de la función hasta las que se puede cancelar. */
export const HORAS_LIMITE_CANCELACION = 2;

const MS_POR_HORA = 60 * 60 * 1000;

/**
 * Datos de la cuenta del usuario logueado: perfil, crédito, compras y
 * cancelación. Las políticas RLS hacen que cada usuario vea sólo lo suyo.
 */
@Injectable({ providedIn: 'root' })
export class CuentaService {
  private supabase = inject(SupabaseService);

  private async usuarioId(): Promise<string | null> {
    const {
      data: { session }
    } = await this.supabase.client.auth.getSession();
    return session?.user?.id ?? null;
  }

  async obtenerPerfil(): Promise<PerfilUsuario | null> {
    const id = await this.usuarioId();
    if (!id) return null;

    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, email, nombre, apellido, fecha_nacimiento, credito, puntos')
      .eq('id', id)
      .single();

    if (error) throw error;
    return { ...data, credito: Number(data.credito ?? 0), puntos: Number(data.puntos ?? 0) };
  }

  /** Crédito disponible del usuario logueado (0 si es anónimo). */
  async obtenerCredito(): Promise<number> {
    const id = await this.usuarioId();
    if (!id) return 0;

    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('credito')
      .eq('id', id)
      .single();

    if (error) throw error;
    return Number(data?.credito ?? 0);
  }

  async listarMisCompras(): Promise<MiCompra[]> {
    const id = await this.usuarioId();
    if (!id) return [];

    const { data, error } = await this.supabase.client
      .from('compras')
      .select(
        `id, codigo_qr, codigo_corto, total, credito_usado, estado, created_at, cancelada_at,
         entrada_validada_at, candy_entregado_at,
         compra_entradas(precio, incluida_en_combo,
           butacas(fila, columna, tipo),
           funciones(fecha, hora_inicio, hora_fin, formato, idioma,
             salas(nombre), peliculas(nombre, clasificacion, imagen_url))),
         compra_candy_items(cantidad, precio_unitario,
           candy_productos(nombre),
           combos(nombre, incluye_entrada, combo_productos(cantidad, candy_productos(nombre))))`
      )
      .eq('usuario_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((fila: any) => this.mapearCompra(fila));
  }

  async listarMovimientosCredito(): Promise<MovimientoCredito[]> {
    const { data, error } = await this.supabase.client
      .from('movimientos_credito')
      .select('id, monto, motivo, created_at, compras(codigo_corto)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((fila: any) => ({
      id: fila.id,
      monto: Number(fila.monto),
      motivo: fila.motivo,
      created_at: fila.created_at,
      compraCodigoCorto: fila.compras?.codigo_corto ?? null
    }));
  }

  /**
   * RPC cancelar_compra: valida dueño, estado, uso y el límite de 2 horas,
   * libera las butacas y acredita el total en la cuenta.
   */
  async cancelarCompra(compraId: string): Promise<ResultadoCancelacion> {
    const { data, error } = await this.supabase.client.rpc('cancelar_compra', {
      p_compra_id: compraId
    });

    if (error || !data) throw new Error(error?.message ?? 'No se pudo cancelar la compra.');
    return {
      compra_id: data.compra_id,
      credito_otorgado: Number(data.credito_otorgado),
      credito_total: Number(data.credito_total)
    };
  }

  private mapearCompra(fila: any): MiCompra {
    const entradasFilas: any[] = fila.compra_entradas ?? [];
    const funcion = entradasFilas[0]?.funciones ?? {};
    const fecha: string = funcion.fecha ?? '';
    const horaInicio: string = funcion.hora_inicio ?? '00:00:00';
    const horaFin: string = funcion.hora_fin ?? horaInicio;
    const inicio = this.fechaHoraLocal(fecha, horaInicio);
    const fin = this.fechaHoraLocal(fecha, horaFin);

    const entradas: EntradaMiCompra[] = entradasFilas
      .map((e) => ({
        ubicacion: `${e.butacas?.fila ?? '?'}-${e.butacas?.columna ?? '?'}`,
        tipo: e.butacas?.tipo ?? 'estandar',
        precio: Number(e.precio),
        incluidaEnCombo: !!e.incluida_en_combo
      }))
      .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion, 'es', { numeric: true }));

    const candy: CandyMiCompra[] = (fila.compra_candy_items ?? []).map((i: any) => {
      const esCombo = !!i.combos;
      const contenido = esCombo
        ? (i.combos.combo_productos ?? [])
            .map((cp: any) => `${cp.cantidad}x ${cp.candy_productos?.nombre ?? '?'}`)
            .join(', ')
        : '';
      return {
        nombre: esCombo ? i.combos.nombre : i.candy_productos?.nombre ?? '(producto)',
        cantidad: i.cantidad,
        precioUnitario: Number(i.precio_unitario),
        esCombo,
        contenido,
        incluyeEntrada: esCombo && !!i.combos.incluye_entrada
      };
    });

    const entradaValidada = !!fila.entrada_validada_at;
    const candyEntregado = !!fila.candy_entregado_at;
    const ahora = Date.now();

    let estado: EstadoMiCompra;
    if (fila.estado === 'cancelada') estado = 'cancelada';
    else if (entradaValidada) estado = 'utilizada';
    else if (fin.getTime() < ahora) estado = 'finalizada';
    else estado = 'confirmada';

    let motivoNoCancelable: string | null = null;
    if (fila.estado === 'cancelada') motivoNoCancelable = 'Compra cancelada.';
    else if (entradaValidada || candyEntregado) motivoNoCancelable = 'La compra ya se usó.';
    else if (inicio.getTime() - ahora < HORAS_LIMITE_CANCELACION * MS_POR_HORA) {
      motivoNoCancelable =
        inicio.getTime() < ahora
          ? 'La función ya empezó.'
          : `Sólo se puede cancelar hasta ${HORAS_LIMITE_CANCELACION} h antes de la función.`;
    }

    return {
      id: fila.id,
      codigoQr: fila.codigo_qr,
      codigoCorto: fila.codigo_corto,
      total: Number(fila.total),
      creditoUsado: Number(fila.credito_usado ?? 0),
      estadoBase: fila.estado,
      estado,
      creadaEl: fila.created_at,
      canceladaEl: fila.cancelada_at,
      entradaValidada,
      candyEntregado,
      pelicula: funcion.peliculas?.nombre ?? '(película)',
      clasificacion: funcion.peliculas?.clasificacion ?? 'ATP',
      imagenUrl: funcion.peliculas?.imagen_url ?? null,
      sala: funcion.salas?.nombre ?? '',
      fecha,
      horaInicio,
      formato: funcion.formato ?? '',
      idioma: funcion.idioma ?? '',
      inicio,
      entradas,
      candy,
      cancelable: motivoNoCancelable === null,
      motivoNoCancelable
    };
  }

  /** "2026-10-02" + "18:00:00" -> Date local (las funciones se cargan en hora local). */
  private fechaHoraLocal(fecha: string, hora: string): Date {
    if (!fecha) return new Date(NaN);
    const [anio, mes, dia] = fecha.split('-').map(Number);
    const [hh, mm] = hora.split(':').map(Number);
    return new Date(anio, mes - 1, dia, hh || 0, mm || 0);
  }
}
