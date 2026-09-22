import { Injectable, inject } from '@angular/core';

import { FuncionConDetalle, FuncionFormValue } from '../models/funcion.model';
import { SupabaseService } from './supabase.service';

const MARGEN_MINUTOS = 30;

@Injectable({ providedIn: 'root' })
export class FuncionesService {
  private supabase = inject(SupabaseService);

  async listar(): Promise<FuncionConDetalle[]> {
    const { data, error } = await this.supabase.client
      .from('funciones')
      .select('*, peliculas(nombre), salas(nombre)')
      .order('fecha', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) throw error;

    return (data ?? []).map((fila: any) => ({
      ...fila,
      peliculaNombre: fila.peliculas?.nombre ?? '(película eliminada)',
      salaNombre: fila.salas?.nombre ?? '(sala eliminada)'
    }));
  }

  async crear(valores: FuncionFormValue, usuarioId: string | undefined): Promise<void> {
    // 1) Traer la duracion real de la pelicula para calcular hora_fin.
    const { data: pelicula, error: errorPelicula } = await this.supabase.client
      .from('peliculas')
      .select('duracion_minutos')
      .eq('id', valores.peliculaId)
      .single();

    if (errorPelicula || !pelicula) {
      throw errorPelicula ?? new Error('Película no encontrada.');
    }

    const horaFin = this.sumarMinutos(valores.horaInicio, pelicula.duracion_minutos);

    // 2) Traer todas las salas y las funciones ya programadas ESE DIA, para
    // poder chequear solapamientos + el margen de 30 minutos.
    const [{ data: salas, error: errorSalas }, { data: funcionesDelDia, error: errorFunciones }] =
      await Promise.all([
        this.supabase.client.from('salas').select('id, nombre').order('nombre'),
        this.supabase.client
          .from('funciones')
          .select('sala_id, hora_inicio, hora_fin')
          .eq('fecha', valores.fecha)
      ]);

    if (errorSalas) throw errorSalas;
    if (errorFunciones) throw errorFunciones;
    if (!salas?.length) throw new Error('Todavía no hay salas creadas.');

    // 3) Elegir la primera sala sin conflicto (respetando el margen de 30
    // min antes y despues, tal como pide el PDF).
    const salaLibre = salas.find((sala) => {
      const ocupaciones = (funcionesDelDia ?? []).filter((f) => f.sala_id === sala.id);
      return !ocupaciones.some((f) =>
        this.hayConflicto(valores.horaInicio, horaFin, f.hora_inicio, f.hora_fin)
      );
    });

    if (!salaLibre) {
      throw new Error(
        'No hay ninguna sala libre en ese horario (respetando 30 min de limpieza). Probá otro horario o creá otra sala.'
      );
    }

    const { error } = await this.supabase.client.from('funciones').insert({
      pelicula_id: valores.peliculaId,
      sala_id: salaLibre.id,
      fecha: valores.fecha,
      hora_inicio: valores.horaInicio,
      hora_fin: horaFin,
      formato: valores.formato,
      idioma: valores.idioma,
      precio: valores.precio,
      created_by: usuarioId ?? null
    });

    if (error) throw error;
  }

  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('funciones').delete().eq('id', id);
    if (error) throw error;
  }

  private hayConflicto(
    inicioNueva: string,
    finNueva: string,
    inicioExistente: string,
    finExistente: string
  ): boolean {
    const a1 = this.aMinutos(inicioNueva) - MARGEN_MINUTOS;
    const a2 = this.aMinutos(finNueva) + MARGEN_MINUTOS;
    const b1 = this.aMinutos(inicioExistente);
    const b2 = this.aMinutos(finExistente);

    return a1 < b2 && b1 < a2;
  }

  private aMinutos(horaHHmm: string): number {
    const [h, m] = horaHHmm.split(':').map(Number);
    return h * 60 + m;
  }

  private sumarMinutos(horaHHmm: string, minutos: number): string {
    const total = this.aMinutos(horaHHmm) + minutos;
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}