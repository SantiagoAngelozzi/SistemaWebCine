export interface CandyCategoria {
  id: string;
  nombre: string;
}

export interface CandyProducto {
  id: string;
  categoria_id: string | null;
  nombre: string;
  precio: number;
  imagen_url: string | null;
  activo: boolean;
}

export interface CandyProductoConCategoria extends CandyProducto {
  categoriaNombre: string;
}

export interface CandyProductoFormValue {
  categoriaId: string;
  nombre: string;
  precio: number;
  imagenUrl: string;
  activo: boolean;
}

export interface Combo {
  id: string;
  nombre: string;
  precio: number;
  incluye_entrada: boolean;
  activo: boolean;
}

export interface ItemCombo {
  candyProductoId: string;
  nombre: string;
  cantidad: number;
  precio: number;
}

export interface ComboConItems extends Combo {
  items: ItemCombo[];
}

export interface ComboFormValue {
  nombre: string;
  precio: number;
  incluyeEntrada: boolean;
  activo: boolean;
}

/** Productos agrupados por categoría para la pantalla de compra. */
export interface CategoriaConProductos {
  id: string;
  nombre: string;
  productos: CandyProductoConCategoria[];
}

/** Lo que el cliente puede comprar: sólo combos y productos activos. */
export interface CatalogoCandy {
  combos: ComboConItems[];
  categorias: CategoriaConProductos[];
}
