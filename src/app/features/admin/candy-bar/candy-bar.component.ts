import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  CandyCategoria,
  CandyProductoConCategoria,
  ComboConItems
} from '../../../core/models/candy.model';
import { CandyService, mensajeErrorCandy } from '../../../core/services/candy.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ToastService } from '../../../core/services/toast.service';
import { FormErrorComponent } from '../../../shared/form-error/form-error.component';

type Tab = 'productos' | 'combos';

@Component({
  selector: 'app-admin-candy-bar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormErrorComponent],
  templateUrl: './candy-bar.component.html',
  styleUrl: './candy-bar.component.scss'
})
export class CandyBarComponent implements OnInit {
  private fb = inject(FormBuilder);
  private candyService = inject(CandyService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  tabActiva = signal<Tab>('productos');
  cargando = signal(true);

  categorias = signal<CandyCategoria[]>([]);
  productos = signal<CandyProductoConCategoria[]>([]);
  combos = signal<ComboConItems[]>([]);

  guardandoCategoria = signal(false);
  mostrandoFormProducto = signal(false);
  editandoProductoId = signal<string | null>(null);
  guardandoProducto = signal(false);

  mostrandoFormCombo = signal(false);
  editandoComboId = signal<string | null>(null);
  guardandoCombo = signal(false);
  // productoId -> cantidad (0/ausente = no incluido en el combo que se esta armando)
  itemsCombo = signal<Map<string, number>>(new Map());

  formProducto = this.fb.nonNullable.group({
    categoriaId: [''],
    nombre: ['', Validators.required],
    precio: [0, [Validators.required, Validators.min(0)]],
    imagenUrl: [''],
    activo: [true]
  });

  /** Lo que costarían por separado los productos del combo que se está armando. */
  precioPorSeparado = computed(() => {
    const precios = new Map(this.productos().map((p) => [p.id, p.precio]));
    let suma = 0;
    for (const [productoId, cantidad] of this.itemsCombo()) {
      suma += (precios.get(productoId) ?? 0) * cantidad;
    }
    return Math.round(suma * 100) / 100;
  });

  formCombo = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    precio: [0, [Validators.required, Validators.min(0)]],
    incluyeEntrada: [true],
    activo: [true]
  });

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
  }

  cambiarTab(tab: Tab): void {
    this.tabActiva.set(tab);
  }

  async cargarTodo(): Promise<void> {
    this.cargando.set(true);
    try {
      const [categorias, productos, combos] = await Promise.all([
        this.candyService.listarCategorias(),
        this.candyService.listarProductos(),
        this.candyService.listarCombos()
      ]);
      this.categorias.set(categorias);
      this.productos.set(productos);
      this.combos.set(combos);
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudieron cargar los datos del candy bar.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ---------- Categorías ----------

  async crearCategoria(nombre: string): Promise<void> {
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) return;

    this.guardandoCategoria.set(true);
    try {
      await this.candyService.crearCategoria(nombreLimpio);
      this.toastService.exito(`Categoría "${nombreLimpio}" creada`);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorCandy(err, 'No se pudo crear la categoría.'));
    } finally {
      this.guardandoCategoria.set(false);
    }
  }

  async eliminarCategoria(categoria: CandyCategoria): Promise<void> {
    const confirmado = await this.confirmService.preguntar(
      `¿Eliminar la categoría "${categoria.nombre}"? Los productos que la usan quedan sin categoría.`,
      { titulo: 'Eliminar categoría', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;

    try {
      await this.candyService.eliminarCategoria(categoria.id);
      this.toastService.exito('Categoría eliminada');
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorCandy(err, 'No se pudo eliminar la categoría.'));
    }
  }

  // ---------- Productos ----------

  abrirNuevoProducto(): void {
    this.editandoProductoId.set(null);
    this.formProducto.reset({ categoriaId: '', nombre: '', precio: 0, imagenUrl: '', activo: true });
    this.mostrandoFormProducto.set(true);
  }

  abrirEdicionProducto(producto: CandyProductoConCategoria): void {
    this.editandoProductoId.set(producto.id);
    this.formProducto.reset({
      categoriaId: producto.categoria_id ?? '',
      nombre: producto.nombre,
      precio: producto.precio,
      imagenUrl: producto.imagen_url ?? '',
      activo: producto.activo
    });
    this.mostrandoFormProducto.set(true);
  }

  cancelarProducto(): void {
    this.mostrandoFormProducto.set(false);
  }

  async guardarProducto(): Promise<void> {
    if (this.formProducto.invalid) {
      this.formProducto.markAllAsTouched();
      this.toastService.error('Revisá los campos marcados en rojo.');
      return;
    }
    this.guardandoProducto.set(true);
    try {
      const valores = this.formProducto.getRawValue();
      const id = this.editandoProductoId();

      if (id) {
        await this.candyService.actualizarProducto(id, valores);
        this.toastService.exito('Producto actualizado');
      } else {
        await this.candyService.crearProducto(valores);
        this.toastService.exito('Producto creado 🍿');
      }

      this.mostrandoFormProducto.set(false);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorCandy(err, 'No se pudo guardar el producto.'));
    } finally {
      this.guardandoProducto.set(false);
    }
  }

  async eliminarProducto(producto: CandyProductoConCategoria): Promise<void> {
    const combosQueLoUsan = this.combos()
      .filter((combo) => combo.items.some((item) => item.candyProductoId === producto.id))
      .map((combo) => combo.nombre);
    const aviso = combosQueLoUsan.length
      ? ` También se quitará de: ${combosQueLoUsan.join(', ')}.`
      : '';

    const confirmado = await this.confirmService.preguntar(
      `¿Eliminar "${producto.nombre}"?${aviso}`,
      { titulo: 'Eliminar producto', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;

    try {
      await this.candyService.eliminarProducto(producto.id);
      this.toastService.exito('Producto eliminado');
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorCandy(err, 'No se pudo eliminar el producto.'));
    }
  }

  // ---------- Combos ----------

  abrirNuevoCombo(): void {
    this.editandoComboId.set(null);
    this.formCombo.reset({ nombre: '', precio: 0, incluyeEntrada: true, activo: true });
    this.itemsCombo.set(new Map());
    this.mostrandoFormCombo.set(true);
  }

  abrirEdicionCombo(combo: ComboConItems): void {
    this.editandoComboId.set(combo.id);
    this.formCombo.reset({
      nombre: combo.nombre,
      precio: combo.precio,
      incluyeEntrada: combo.incluye_entrada,
      activo: combo.activo
    });
    const mapa = new Map<string, number>();
    combo.items.forEach((i) => mapa.set(i.candyProductoId, i.cantidad));
    this.itemsCombo.set(mapa);
    this.mostrandoFormCombo.set(true);
  }

  cancelarCombo(): void {
    this.mostrandoFormCombo.set(false);
  }

  cantidadDe(productoId: string): number {
    return this.itemsCombo().get(productoId) ?? 0;
  }

  toggleProductoEnCombo(productoId: string, incluido: boolean): void {
    this.itemsCombo.update((mapa) => {
      const copia = new Map(mapa);
      if (incluido) copia.set(productoId, 1);
      else copia.delete(productoId);
      return copia;
    });
  }

  cambiarCantidad(productoId: string, cantidad: number): void {
    // Si escriben algo inválido (0, negativo, decimal) se normaliza a un
    // entero >= 1 para que el input y el estado no queden desincronizados.
    const normalizada = Math.max(1, Math.floor(Number(cantidad) || 1));
    this.itemsCombo.update((mapa) => {
      const copia = new Map(mapa);
      copia.set(productoId, normalizada);
      return copia;
    });
  }

  async guardarCombo(): Promise<void> {
    if (this.formCombo.invalid) {
      this.formCombo.markAllAsTouched();
      this.toastService.error('Revisá los campos marcados en rojo.');
      return;
    }
    if (!this.itemsCombo().size) {
      this.toastService.error('Elegí al menos un producto para el combo.');
      return;
    }

    this.guardandoCombo.set(true);
    try {
      const valores = this.formCombo.getRawValue();
      const items = Array.from(this.itemsCombo().entries()).map(([candyProductoId, cantidad]) => ({
        candyProductoId,
        cantidad
      }));
      const id = this.editandoComboId();

      await this.candyService.guardarCombo(id, valores, items);
      this.toastService.exito(id ? 'Combo actualizado' : 'Combo creado 🎬🍿');

      this.mostrandoFormCombo.set(false);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorCandy(err, 'No se pudo guardar el combo.'));
    } finally {
      this.guardandoCombo.set(false);
    }
  }

  async eliminarCombo(combo: ComboConItems): Promise<void> {
    const confirmado = await this.confirmService.preguntar(`¿Eliminar el combo "${combo.nombre}"?`, {
      titulo: 'Eliminar combo',
      textoConfirmar: 'Eliminar'
    });
    if (!confirmado) return;

    try {
      await this.candyService.eliminarCombo(combo.id);
      this.toastService.exito('Combo eliminado');
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorCandy(err, 'No se pudo eliminar el combo.'));
    }
  }
}