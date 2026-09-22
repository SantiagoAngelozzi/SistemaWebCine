import { Injectable, inject } from '@angular/core';

import {
  FormatoProyeccion,
  Genero,
  PeliculaConRelaciones,
  PeliculaFormValue
} from '../models/pelicula.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class PeliculasService {
  private supabase = inject(SupabaseService);

  async listarGeneros(): Promise<Genero[]> {
    const { data, error } = await this.supabase.client
      .from('generos')
      .select('id, nombre')
      .order('nombre');

    if (error) throw error;
    return data ?? [];
  }

  async listar(): Promise<PeliculaConRelaciones[]> {
    // Select anidado: Supabase resuelve el join usando las FK ya definidas
    // en el schema (pelicula_generos -> generos, pelicula_formatos).
    const { data, error } = await this.supabase.client
      .from('peliculas')
      .select('*, pelicula_generos(genero_id, generos(id, nombre)), pelicula_formatos(formato)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((fila) => this.mapearFila(fila));
  }

  // Usado por las vistas publicas (Home, Cartelera): solo peliculas
  // activas, con limite opcional.
  async listarActivas(limite?: number): Promise<PeliculaConRelaciones[]> {
    let query = this.supabase.client
      .from('peliculas')
      .select('*, pelicula_generos(genero_id, generos(id, nombre)), pelicula_formatos(formato)')
      .eq('activa', true)
      .order('created_at', { ascending: false });

    if (limite) {
      query = query.limit(limite);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((fila) => this.mapearFila(fila));
  }

    // Usado por la ficha de pelicula (ruta /pelicula/:id).
  async obtenerActivaPorId(id: string): Promise<PeliculaConRelaciones | null> {
    const { data, error } = await this.supabase.client
      .from('peliculas')
      .select('*, pelicula_generos(genero_id, generos(id, nombre)), pelicula_formatos(formato)')
      .eq('id', id)
      .eq('activa', true)
      .maybeSingle();

    if (error) throw error;
    return data ? this.mapearFila(data) : null;
  }

  async crear(
    valores: PeliculaFormValue,
    generoIds: string[],
    formatos: FormatoProyeccion[]
  ): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('peliculas')
      .insert(this.mapearValoresATabla(valores))
      .select('id')
      .single();

    if (error) throw error;

    await this.guardarRelaciones(data.id, generoIds, formatos);
    return data.id;
  }

  async actualizar(
    id: string,
    valores: PeliculaFormValue,
    generoIds: string[],
    formatos: FormatoProyeccion[]
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('peliculas')
      .update(this.mapearValoresATabla(valores))
      .eq('id', id);

    if (error) throw error;

    // Sincronizar relaciones: se borran y se vuelven a insertar. Es mas
    // simple que calcular un diff, y el volumen por pelicula es chico
    // (unos pocos generos/formatos como mucho).
    await this.supabase.client.from('pelicula_generos').delete().eq('pelicula_id', id);
    await this.supabase.client.from('pelicula_formatos').delete().eq('pelicula_id', id);
    await this.guardarRelaciones(id, generoIds, formatos);
  }

  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('peliculas').delete().eq('id', id);
    if (error) throw error;
  }

  private async guardarRelaciones(
    peliculaId: string,
    generoIds: string[],
    formatos: FormatoProyeccion[]
  ): Promise<void> {
    if (generoIds.length) {
      const filas = generoIds.map((genero_id) => ({ pelicula_id: peliculaId, genero_id }));
      const { error } = await this.supabase.client.from('pelicula_generos').insert(filas);
      if (error) throw error;
    }
    if (formatos.length) {
      const filas = formatos.map((formato) => ({ pelicula_id: peliculaId, formato }));
      const { error } = await this.supabase.client.from('pelicula_formatos').insert(filas);
      if (error) throw error;
    }
  }

  private mapearFila(fila: any): PeliculaConRelaciones {
    return {
      ...fila,
      generoIds: (fila.pelicula_generos ?? []).map((pg: any) => pg.genero_id),
      generoNombres: (fila.pelicula_generos ?? [])
        .map((pg: any) => pg.generos?.nombre)
        .filter(Boolean),
      formatos: (fila.pelicula_formatos ?? []).map((pf: any) => pf.formato as FormatoProyeccion)
    };
  }

  private mapearValoresATabla(valores: PeliculaFormValue) {
    return {
      nombre: valores.nombre,
      sinopsis: valores.sinopsis || null,
      imagen_url: valores.imagenUrl || null,
      duracion_minutos: valores.duracionMinutos,
      idioma: valores.idioma,
      clasificacion: valores.clasificacion,
      fecha_estreno: valores.fechaEstreno,
      precio_normal: valores.precioNormal,
      precio_preventa: valores.precioPreventa,
      dias_preventa: valores.diasPreventa,
      activa: valores.activa
    };
  }
}