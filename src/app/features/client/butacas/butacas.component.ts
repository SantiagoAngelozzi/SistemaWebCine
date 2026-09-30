import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';

import { CatalogoCandy } from '../../../core/models/candy.model';
import {
  CompraConfirmada,
  FuncionParaCompra,
  ItemCandySeleccionado,
  TipoItemCandy
} from '../../../core/models/compra.model';
import { Butaca, TipoButaca } from '../../../core/models/sala.model';
import { AuthService } from '../../../core/services/auth.service';
import { CandyService } from '../../../core/services/candy.service';
import { CuentaService } from '../../../core/services/cuenta.service';
import { ComprasService } from '../../../core/services/compras.service';
import { ComprobantePdfService } from '../../../core/services/comprobante-pdf.service';
import { formatearCodigoCorto } from '../../../core/services/validacion.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../core/services/toast.service';
import { estadoVenta } from '../../../core/utils/pelicula-fechas';
import {
  CambioCantidadCandy,
  CandySelectorComponent,
  claveCarrito
} from './candy-selector/candy-selector.component';

type EstadoButaca = 'libre' | 'ocupada' | 'seleccionada' | 'reservada_otro';

interface ButacaUI extends Butaca {
  estado: EstadoButaca;
}

interface FilaUI { 
  fila: string;
  izquierda: ButacaUI[];
  centro: ButacaUI[];
  derecha: ButacaUI[];
}

type PasoCompra = 'butacas' | 'candy';

interface LineaCarrito {
  clave: string;
  tipo: TipoItemCandy;
  id: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  incluyeEntrada: boolean;
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

const CLIENTE_ID = crypto.randomUUID();

@Component({
  selector: 'app-butacas',
  standalone: true,
  imports: [CommonModule, CandySelectorComponent],
  templateUrl: './butacas.component.html',
  styleUrl: './butacas.component.scss'
})
export class ButacasComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private authService = inject(AuthService);
  private comprasService = inject(ComprasService);
  private candyService = inject(CandyService);
  private cuentaService = inject(CuentaService);
  private comprobantePdf = inject(ComprobantePdfService);
  private supabase = inject(SupabaseService);
  private toastService = inject(ToastService);

  recargoVipTexto = '50%';
  readonly formatearCodigoCorto = formatearCodigoCorto;

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  comprando = signal(false);
  compraExitosa = signal<CompraConfirmada | null>(null);
  generandoPdf = signal(false);

  funcion = signal<FuncionParaCompra | null>(null);
  filas = signal<FilaUI[]>([]);
  seleccionadas = signal<Set<string>>(new Set());

  paso = signal<PasoCompra>('butacas');
  catalogo = signal<CatalogoCandy | null>(null);
  errorCandy = signal<string | null>(null);
  /** clave "tipo:id" -> cantidad */
  carrito = signal<Map<string, number>>(new Map());

  private butacasPorId = new Map<string, ButacaUI>();
  private canalOcupacion: RealtimeChannel | null = null;
  private canalSeleccion: RealtimeChannel | null = null;
  private funcionId = '';

  hayVipSeleccionada = computed(() =>
    Array.from(this.seleccionadas()).some((id) => this.butacasPorId.get(id)?.tipo === 'vip')
  );

  seleccionadasTexto = computed(() => {
    const numeros = Array.from(this.seleccionadas())
      .map((id) => this.butacasPorId.get(id))
      .filter((b): b is ButacaUI => !!b)
      .map((b) => `${b.fila}-${b.columna}`);
    return numeros.length ? numeros.join(', ') : 'ninguna';
  });

  subtotalEntradas = computed(() => {
    const funcion = this.funcion();
    if (!funcion) return 0;
    const suma = Array.from(this.seleccionadas()).reduce((acc, id) => {
      const butaca = this.butacasPorId.get(id);
      if (!butaca) return acc;
      return acc + this.comprasService.calcularPrecioButaca(funcion.precio, butaca.tipo);
    }, 0);
    return redondear(suma);
  });

  lineasCarrito = computed<LineaCarrito[]>(() => {
    const catalogo = this.catalogo();
    if (!catalogo) return [];

    const lineas: LineaCarrito[] = [];
    for (const combo of catalogo.combos) {
      const cantidad = this.carrito().get(claveCarrito('combo', combo.id)) ?? 0;
      if (cantidad > 0) {
        lineas.push({
          clave: claveCarrito('combo', combo.id),
          tipo: 'combo',
          id: combo.id,
          nombre: combo.nombre,
          cantidad,
          precioUnitario: combo.precio,
          subtotal: redondear(cantidad * combo.precio),
          incluyeEntrada: combo.incluye_entrada
        });
      }
    }
    for (const categoria of catalogo.categorias) {
      for (const producto of categoria.productos) {
        const cantidad = this.carrito().get(claveCarrito('producto', producto.id)) ?? 0;
        if (cantidad > 0) {
          lineas.push({
            clave: claveCarrito('producto', producto.id),
            tipo: 'producto',
            id: producto.id,
            nombre: producto.nombre,
            cantidad,
            precioUnitario: producto.precio,
          subtotal: redondear(cantidad * producto.precio),
            incluyeEntrada: false
          });
        }
      }
    }
    return lineas;
  });

  combosConEntrada = computed(() =>
    this.lineasCarrito()
      .filter((linea) => linea.incluyeEntrada)
      .reduce((acc, linea) => acc + linea.cantidad, 0)
  );

  /**
   * Cada combo con entrada cubre el precio base de una butaca (la VIP sigue
   * pagando su recargo). Misma regla que aplica la RPC en la base.
   */
  descuentoEntradasEnCombos = computed(() => {
    const funcion = this.funcion();
    if (!funcion) return 0;
    const cubiertas = Math.min(this.combosConEntrada(), this.seleccionadas().size);
    return redondear(cubiertas * funcion.precio);
  });

  subtotalCandy = computed(() =>
    redondear(this.lineasCarrito().reduce((acc, l) => acc + l.subtotal, 0))
  );

  total = computed(() =>
    redondear(this.subtotalEntradas() - this.descuentoEntradasEnCombos() + this.subtotalCandy())
  );

  /** Crédito en cuenta del usuario logueado (0 para anónimos). */
  creditoDisponible = signal(0);
  usarCredito = signal(false);

  /** Vista previa: la base decide cuánto crédito se usa realmente. */
  creditoAplicado = computed(() =>
    this.usarCredito() ? redondear(Math.min(this.creditoDisponible(), this.total())) : 0
  );

  aPagar = computed(() => redondear(this.total() - this.creditoAplicado()));

  async ngOnInit(): Promise<void> {
    const funcionId = this.route.snapshot.paramMap.get('funcionId');
    if (!funcionId) {
      this.router.navigateByUrl('/cartelera');
      return;
    }
    this.funcionId = funcionId;
    await this.cargar();
    this.suscribirseRealtime();
  }

  ngOnDestroy(): void {
    if (this.canalOcupacion) this.supabase.client.removeChannel(this.canalOcupacion);
    if (this.canalSeleccion) this.supabase.client.removeChannel(this.canalSeleccion);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const funcion = await this.comprasService.obtenerFuncion(this.funcionId);
      if (
        estadoVenta({
          fecha_estreno: funcion.peliculaFechaEstreno,
          dias_preventa: funcion.peliculaDiasPreventa
        }) === 'proximamente'
      ) {
        this.errorMessage.set('La venta de esta película todavía no está habilitada.');
        return;
      }
      this.funcion.set(funcion);

      const [butacas, ocupadas] = await Promise.all([
        this.comprasService.listarButacasDeSala(funcion.sala_id),
        this.comprasService.listarButacasOcupadas(this.funcionId),
        this.cargarCatalogoCandy(),
        this.cargarCredito()
      ]);

      this.armarFilas(butacas, ocupadas);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar el mapa de butacas.'); 
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarCredito(): Promise<void> {
    try {
      this.creditoDisponible.set(await this.cuentaService.obtenerCredito());
    } catch (err) {
      console.error(err);
      this.creditoDisponible.set(0);
    }
    if (this.creditoDisponible() <= 0) this.usarCredito.set(false);
  }

  /** Si el Candy Bar falla se puede seguir comprando sólo entradas. */
  private async cargarCatalogoCandy(): Promise<void> {
    this.errorCandy.set(null);
    try {
      const catalogo = await this.candyService.obtenerCatalogoVenta();
      this.catalogo.set(catalogo);
      this.depurarCarrito(catalogo);
    } catch (err) {
      console.error(err);
      this.catalogo.set(null);
      this.carrito.set(new Map());
      this.errorCandy.set('No se pudo cargar el Candy Bar. Podés continuar comprando sólo las entradas.');
    }
  }

  /** Quita del carrito lo que ya no está a la venta (p. ej. tras recargar). */
  private depurarCarrito(catalogo: CatalogoCandy): void {
    const vigentes = new Set<string>([
      ...catalogo.combos.map((c) => claveCarrito('combo', c.id)),
      ...catalogo.categorias.flatMap((cat) => cat.productos.map((p) => claveCarrito('producto', p.id)))
    ]);
    this.carrito.update((mapa) => new Map(Array.from(mapa).filter(([clave]) => vigentes.has(clave))));
  }

  private armarFilas(butacas: Butaca[], ocupadas: Set<string>): void {
    const porFila = new Map<string, Butaca[]>();
    for (const b of butacas) {
      if (!porFila.has(b.fila)) porFila.set(b.fila, []);
      porFila.get(b.fila)!.push(b);
    }

    const filas: FilaUI[] = [];
    this.butacasPorId.clear();

    for (const [fila, lista] of porFila) {
      lista.sort((a, b) => a.columna - b.columna);
      const ui: ButacaUI[] = lista.map((b) => {
        const estado: EstadoButaca = ocupadas.has(b.id)
          ? 'ocupada'
          : this.seleccionadas().has(b.id)
            ? 'seleccionada'
            : 'libre';
        const item: ButacaUI = { ...b, estado };
        this.butacasPorId.set(b.id, item);
        return item;
      });

      filas.push({
        fila,
        izquierda: ui.filter((b) => b.columna <= 4),
        centro: ui.filter((b) => b.columna >= 6 && b.columna <= 25),
        derecha: ui.filter((b) => b.columna >= 27)
      });
    }

    filas.sort((a, b) => a.fila.localeCompare(b.fila));
    this.filas.set(filas);

    // Al recargar (p. ej. tras un error de compra) se conserva la selección
    // de las butacas que siguen libres y se descartan las que se vendieron.
    this.seleccionadas.update((set) => new Set(Array.from(set).filter((id) => !ocupadas.has(id))));
    this.ajustarCombosAButacas();
    if (!this.seleccionadas().size) this.paso.set('butacas');
  }

  private suscribirseRealtime(): void {
 
    this.canalOcupacion = this.comprasService.suscribirseAOcupacion(
      this.funcionId,
      (butacaId) => this.alOcuparseButaca(butacaId),
      (butacaId) => this.alLiberarseButaca(butacaId)
    );

    this.canalSeleccion = this.comprasService.crearCanalSeleccion(this.funcionId);
    this.canalSeleccion
      .on('broadcast', { event: 'seleccion' }, ({ payload }) => {
        if (payload.clienteId === CLIENTE_ID) return;
        const butaca = this.butacasPorId.get(payload.butacaId);
        if (!butaca || butaca.estado === 'ocupada') return;
        this.marcarEstado(payload.butacaId, payload.accion === 'seleccionada' ? 'reservada_otro' : 'libre');
      })
      .subscribe();
  }

  private alOcuparseButaca(butacaId: string): void {
    this.marcarEstado(butacaId, 'ocupada');

    // Nuestra propia compra también dispara este evento: en ese caso no hay
    // nada que avisar ni ajustar.
    if (this.comprando() || this.compraExitosa()) return;
    if (!this.seleccionadas().has(butacaId)) return;

    const butaca = this.butacasPorId.get(butacaId);
    this.seleccionadas.update((set) => {
      const copia = new Set(set);
      copia.delete(butacaId);
      return copia;
    });
    this.toastService.error(
      `Otra persona acaba de comprar la butaca ${butaca ? `${butaca.fila}-${butaca.columna}` : ''}. Elegí otra.`
    );
    this.ajustarCombosAButacas();
    if (!this.seleccionadas().size) this.paso.set('butacas');
  }

  /** Alguien canceló su compra: la butaca vuelve a estar libre para todos. */
  private alLiberarseButaca(butacaId: string): void {
    const butaca = this.butacasPorId.get(butacaId);
    if (!butaca || butaca.estado !== 'ocupada') return;
    butaca.estado = 'libre';
    this.filas.update((filas) => filas.map((f) => ({ ...f })));
  }

  private marcarEstado(butacaId: string, estado: EstadoButaca): void {
    const butaca = this.butacasPorId.get(butacaId);
    if (!butaca || butaca.estado === 'ocupada') return;
    butaca.estado = estado;
    this.filas.update((filas) => filas.map((f) => ({ ...f })));
  }

  toggleButaca(butaca: ButacaUI): void {
    if (butaca.estado === 'ocupada' || butaca.estado === 'reservada_otro') return;

    const yaSeleccionada = this.seleccionadas().has(butaca.id);
    this.seleccionadas.update((set) => {
      const copia = new Set(set);
      if (yaSeleccionada) copia.delete(butaca.id);
      else copia.add(butaca.id);
      return copia;
    });

    this.marcarEstado(butaca.id, yaSeleccionada ? 'libre' : 'seleccionada');
    if (yaSeleccionada) this.ajustarCombosAButacas();

    this.canalSeleccion?.send({
      type: 'broadcast',
      event: 'seleccion',
      payload: {
        clienteId: CLIENTE_ID,
        butacaId: butaca.id,
        accion: yaSeleccionada ? 'liberada' : 'seleccionada'
      }
    });
  }

  // ---------- Pasos y Candy Bar ----------

  irACandy(): void {
    if (!this.seleccionadas().size) return;
    this.errorMessage.set(null);
    this.paso.set('candy');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  volverAButacas(): void {
    this.paso.set('butacas');
  }

  cambiarCantidadCandy(cambio: CambioCantidadCandy): void {
    const clave = claveCarrito(cambio.tipo, cambio.id);
    this.carrito.update((mapa) => {
      const copia = new Map(mapa);
      if (cambio.cantidad > 0) copia.set(clave, cambio.cantidad);
      else copia.delete(clave);
      return copia;
    });
  }

  quitarDelCarrito(linea: LineaCarrito): void {
    this.cambiarCantidadCandy({ tipo: linea.tipo, id: linea.id, cantidad: 0 });
  }

  /**
   * No puede haber más combos con entrada que butacas elegidas. Si el
   * cliente suelta una butaca (o se la ganan), se quitan combos con entrada
   * empezando por el último del listado.
   */
  private ajustarCombosAButacas(): void {
    let sobrante = this.combosConEntrada() - this.seleccionadas().size;
    if (sobrante <= 0) return;

    const lineas = this.lineasCarrito().filter((l) => l.incluyeEntrada).reverse();
    this.carrito.update((mapa) => {
      const copia = new Map(mapa);
      for (const linea of lineas) {
        if (sobrante <= 0) break;
        const quitar = Math.min(sobrante, linea.cantidad);
        const restante = linea.cantidad - quitar;
        if (restante > 0) copia.set(linea.clave, restante);
        else copia.delete(linea.clave);
        sobrante -= quitar;
      }
      return copia;
    });
    this.toastService.mostrar('Ajustamos tus combos con entrada a la cantidad de butacas elegidas.');
  }

  private itemsCandyParaCompra(): ItemCandySeleccionado[] {
    return this.lineasCarrito().map((linea) => ({
      tipo: linea.tipo,
      id: linea.id,
      cantidad: linea.cantidad
    }));
  }

  // ---------- Compra ----------

  async confirmarCompra(): Promise<void> {
    const funcion = this.funcion();
    if (!funcion || !this.seleccionadas().size) return;

    this.comprando.set(true);
    this.errorMessage.set(null);

    try {
      const {
        data: { session }
      } = await this.supabase.client.auth.getSession();

      if (session?.user?.id) {
        const { data: perfil, error: perfilError } = await this.supabase.client
          .from('usuarios')
          .select('fecha_nacimiento')
          .eq('id', session.user.id)
          .single();

        if (perfilError || !perfil) {
          this.errorMessage.set('No se pudo verificar tu perfil para comprar entradas.');
          return;
        }

        // Sólo se bloquea si se conoce la fecha de nacimiento y no alcanza la
        // edad mínima (misma regla que la base). Sin fecha, se vende con la
        // advertencia impresa en el comprobante, igual que a un anónimo.
        const edadMinima = funcion.peliculaClasificacion === '+18' ? 18 : funcion.peliculaClasificacion === '+13' ? 13 : 0;
        if (
          edadMinima &&
          perfil.fecha_nacimiento &&
          !this.authService.tieneEdadMinima(perfil.fecha_nacimiento, edadMinima)
        ) {
          this.errorMessage.set(`No podés comprar entradas para una película ${funcion.peliculaClasificacion} si no cumplís la edad mínima.`);
          return;
        }
      }

      const butacas: { id: string; tipo: TipoButaca }[] = Array.from(this.seleccionadas()).map((id) => {
        const b = this.butacasPorId.get(id)!;
        return { id: b.id, tipo: b.tipo };
      });

      const compra = await this.comprasService.confirmarCompra(
        funcion.id,
        butacas,
        this.itemsCandyParaCompra(),
        this.usarCredito() && this.creditoDisponible() > 0
      );
      this.compraExitosa.set(compra);
      this.carrito.set(new Map());
      if (compra.credito_usado > 0) {
        this.creditoDisponible.update((c) => redondear(Math.max(0, c - compra.credito_usado)));
        this.usarCredito.set(false);
      }
      await this.descargarComprobante();
    } catch (err: any) {
      console.error(err);
      // Se recarga primero (butacas ocupadas y catálogo actualizados) y
      // después se muestra el error, porque cargar() limpia el mensaje.
      await this.cargar();
      this.errorMessage.set(err?.message ?? 'No se pudo confirmar la compra.');
    } finally {
      this.comprando.set(false);
    }
  }

  /** "Combo Clásico (1 entrada + 2x Pochoclo grande, 1x Gaseosa)" */
  private descripcionCombo(comboId: string, nombre: string): string {
    const combo = this.catalogo()?.combos.find((c) => c.id === comboId);
    if (!combo) return nombre;
    const partes = combo.items.map((item) => `${item.cantidad}x ${item.nombre}`).join(', ');
    return `${nombre} (${combo.incluye_entrada ? '1 entrada + ' : ''}${partes})`;
  }

  volverAInicio(): void {
    this.router.navigateByUrl('/inicio');
  }

  async descargarComprobante(): Promise<void> {
    const funcion = this.funcion();
    const compra = this.compraExitosa();
    if (!funcion || !compra) return;

    // Se usa el detalle que devolvió la base (precios reales), no lo que
    // calculó el navegador ni la selección actual del mapa (que se vacía
    // cuando llega por Realtime nuestra propia compra).
    const entradas = compra.entradas.map((entrada) => ({
      ubicacion: entrada.ubicacion,
      tipo: entrada.tipo,
      precio: entrada.precio,
      incluidaEnCombo: entrada.incluida_en_combo
    }));

    const productos = compra.candy.map((item) => ({
      nombre: item.tipo === 'combo' ? this.descripcionCombo(item.id, item.nombre) : item.nombre,
      cantidad: item.cantidad,
      precio: item.precio_unitario
    }));

    this.generandoPdf.set(true);
    try {
      await this.comprobantePdf.descargar({
        codigoQr: compra.codigo_qr,
        codigoCorto: formatearCodigoCorto(compra.codigo_corto),
        pelicula: funcion.peliculaNombre,
        sala: funcion.salaNombre,
        fecha: funcion.fecha,
        hora: funcion.hora_inicio,
        formato: funcion.formato,
        idioma: funcion.idioma,
        entradas,
        productos,
        total: compra.total,
        creditoUsado: compra.credito_usado,
        advertenciaEdad:
          funcion.peliculaClasificacion === 'ATP'
            ? undefined
            : `Película ${funcion.peliculaClasificacion}: concurrencia obligatoria con un adulto responsable.`
      });
      this.toastService.exito('Comprobante PDF descargado.');
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo generar el comprobante PDF.');
    } finally {
      this.generandoPdf.set(false);
    }
  }
}
