import { Injectable, inject } from '@angular/core';

import {
  CandyCategoria,
  CandyProductoConCategoria,
  CandyProductoFormValue,
  CatalogoCandy,
  CategoriaConProductos,
  ComboConItems,
  ComboFormValue
} from '../models/candy.model';
import { SupabaseService } from './supabase.service';

const SIN_CATEGORIA_ID = 'sin-categoria';

@Injectable({ providedIn: 'root' })
export class CandyService {
  private supabase = inject(SupabaseService);


  async listarCategorias(): Promise<CandyCategoria[]> {
    const { data, error } = await this.supabase.client
      .from('candy_categorias')
      .select('*')
      .order('nombre');

    if (error) throw error;
    return data ?? [];
  }

  async crearCategoria(nombre: string): Promise<void> {
    const { error } = await this.supabase.client.from('candy_categorias').insert({ nombre });
    if (error) throw error;
  }

  async eliminarCategoria(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('candy_categorias').delete().eq('id', id);
    if (error) throw error;
  }


  async listarProductos(soloActivos = false): Promise<CandyProductoConCategoria[]> {
    let query = this.supabase.client
      .from('candy_productos')
      .select('*, candy_categorias(nombre)')
      .order('nombre');

    if (soloActivos) query = query.eq('activo', true);

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((fila: any) => ({
      ...fila,
      precio: Number(fila.precio),
      categoriaNombre: fila.candy_categorias?.nombre ?? 'Sin categoría'
    }));
  }

  async crearProducto(valores: CandyProductoFormValue): Promise<void> {
    const { error } = await this.supabase.client
      .from('candy_productos')
      .insert(this.mapearProducto(valores));
    if (error) throw error;
  }

  async actualizarProducto(id: string, valores: CandyProductoFormValue): Promise<void> {
    const { error } = await this.supabase.client
      .from('candy_productos')
      .update(this.mapearProducto(valores))
      .eq('id', id);
    if (error) throw error;
  }

  async eliminarProducto(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('candy_productos').delete().eq('id', id);
    if (error) throw error;
  }

  private mapearProducto(valores: CandyProductoFormValue) {
    return {
      categoria_id: valores.categoriaId || null,
      nombre: valores.nombre.trim(),
      precio: valores.precio,
      imagen_url: valores.imagenUrl.trim() || null,
      activo: valores.activo
    };
  }


  async listarCombos(soloActivos = false): Promise<ComboConItems[]> {
    let query = this.supabase.client
      .from('combos')
      .select('*, combo_productos(candy_producto_id, cantidad, candy_productos(nombre, precio))')
      .order('nombre');

    if (soloActivos) query = query.eq('activo', true);

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((fila: any) => ({
      id: fila.id,
      nombre: fila.nombre,
      precio: Number(fila.precio),
      incluye_entrada: fila.incluye_entrada,
      activo: fila.activo,
      items: (fila.combo_productos ?? []).map((cp: any) => ({
        candyProductoId: cp.candy_producto_id,
        nombre: cp.candy_productos?.nombre ?? '(producto eliminado)',
        cantidad: cp.cantidad,
        precio: Number(cp.candy_productos?.precio ?? 0)
      }))
    }));
  }

  async guardarCombo(
    id: string | null,
    valores: ComboFormValue,
    items: { candyProductoId: string; cantidad: number }[]
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('guardar_combo', {
      p_combo_id: id,
      p_nombre: valores.nombre.trim(),
      p_precio: valores.precio,
      p_incluye_entrada: valores.incluyeEntrada,
      p_activo: valores.activo,
      p_items: items.map((i) => ({ candy_producto_id: i.candyProductoId, cantidad: i.cantidad }))
    });
    if (error) throw error;
  }

  async eliminarCombo(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('combos').delete().eq('id', id);
    if (error) throw error;
  }


  async obtenerCatalogoVenta(): Promise<CatalogoCandy> {
    const [combos, productos] = await Promise.all([
      this.listarCombos(true),
      this.listarProductos(true)
    ]);

    const porCategoria = new Map<string, CategoriaConProductos>();
    for (const producto of productos) {
      const id = producto.categoria_id ?? SIN_CATEGORIA_ID;
      if (!porCategoria.has(id)) {
        porCategoria.set(id, { id, nombre: producto.categoriaNombre, productos: [] });
      }
      porCategoria.get(id)!.productos.push(producto);
    }

    const categorias = Array.from(porCategoria.values()).sort((a, b) => {
      if (a.id === SIN_CATEGORIA_ID) return 1;
      if (b.id === SIN_CATEGORIA_ID) return -1;
      return a.nombre.localeCompare(b.nombre);
    });

    return {
      combos: combos.filter((combo) => combo.items.length > 0),
      categorias
    };
  }
}

export function mensajeErrorCandy(err: any, porDefecto: string): string {
  switch (err?.code) {
    case '23505':
      return 'Ya existe un registro con ese nombre.';
    case '23503':
      return 'No se puede eliminar porque ya fue vendido. Desactivalo para ocultarlo de la venta.';
    case 'P0001':
      return err.message ?? porDefecto;
    default:
      return porDefecto;
  }
}
