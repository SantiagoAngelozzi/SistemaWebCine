import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { CatalogoCandy } from '../../../core/models/candy.model';
import { CanjeSeleccionado, CompraConfirmada, ItemCandySeleccionado } from '../../../core/models/compra.model';
import { DescuentoAplicable, Recompensa } from '../../../core/models/fidelizacion.model';
import { AuthService } from '../../../core/services/auth.service';
import { CandyService } from '../../../core/services/candy.service';
import { ComprasService } from '../../../core/services/compras.service';
import { ComprobantePdfService } from '../../../core/services/comprobante-pdf.service';
import { CuentaService } from '../../../core/services/cuenta.service';
import { FidelizacionService } from '../../../core/services/fidelizacion.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatearCodigoCorto } from '../../../core/services/validacion.service';
import { formatearFecha } from '../../../core/utils/pelicula-fechas';
import { hoyIso } from '../../../core/utils/formato';
import {
  BeneficiosCompraComponent,
  CambioCanje
} from '../butacas/beneficios-compra/beneficios-compra.component';
import {
  CambioCantidadCandy,
  CandySelectorComponent,
  claveCarrito
} from '../butacas/candy-selector/candy-selector.component';

interface LineaPedido {
  clave: string;
  tipo: 'producto' | 'combo';
  id: string;
  nombre: string;
  cantidad: number;
  subtotal: number;
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

@Component({
  selector: 'app-candy-bar',
  standalone: true,
  imports: [CommonModule, RouterLink, CandySelectorComponent, BeneficiosCompraComponent],
  templateUrl: './candy-bar.component.html',
  styleUrl: './candy-bar.component.scss'
})
export class CandyBarComponent implements OnInit {
  private router = inject(Router);
  private authService = inject(AuthService);
  private candyService = inject(CandyService);
  private comprasService = inject(ComprasService);
  private cuentaService = inject(CuentaService);
  private fidelizacion = inject(FidelizacionService);
  private comprobantePdf = inject(ComprobantePdfService);
  private toastService = inject(ToastService);

  readonly formatearCodigoCorto = formatearCodigoCorto;

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  comprando = signal(false);
  generandoPdf = signal(false);
  compraExitosa = signal<CompraConfirmada | null>(null);

  catalogo = signal<CatalogoCandy | null>(null);
  carrito = signal<Map<string, number>>(new Map());

  logueado = computed(() => !!this.authService.session());
  puntosDisponibles = signal(0);
  recompensas = signal<Recompensa[]>([]);
  canjes = signal<Map<string, number>>(new Map());
  descuento = signal<DescuentoAplicable | null>(null);
  cuponAplicado = signal<string | null>(null);
  errorCupon = signal<string | null>(null);
  validandoCupon = signal(false);
  creditoDisponible = signal(0);
  usarCredito = signal(false);

  lineas = computed<LineaPedido[]>(() => {
    const catalogo = this.catalogo();
    if (!catalogo) return [];

    const lineas: LineaPedido[] = [];
    for (const combo of catalogo.combos) {
      const cantidad = this.carrito().get(claveCarrito('combo', combo.id)) ?? 0;
      if (cantidad > 0) {
        lineas.push({
          clave: claveCarrito('combo', combo.id),
          tipo: 'combo',
          id: combo.id,
          nombre: combo.nombre,
          cantidad,
          subtotal: redondear(cantidad * combo.precio)
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
            subtotal: redondear(cantidad * producto.precio)
          });
        }
      }
    }
    return lineas;
  });

  lineasCanje = computed(() =>
    this.recompensas()
      .map((recompensa) => ({ recompensa, cantidad: this.canjes().get(recompensa.id) ?? 0 }))
      .filter((linea) => linea.cantidad > 0)
  );

  puntosComprometidos = computed(() =>
    this.lineasCanje().reduce((acc, l) => acc + l.cantidad * l.recompensa.costo_puntos, 0)
  );

  hayAlgoEnElPedido = computed(() => this.lineas().length > 0 || this.lineasCanje().length > 0);

  subtotal = computed(() => redondear(this.lineas().reduce((acc, l) => acc + l.subtotal, 0)));

  porcentajeDescuento = computed(() => this.descuento()?.porcentaje ?? 0);

  descuentoMonto = computed(() => redondear((this.subtotal() * this.porcentajeDescuento()) / 100));

  etiquetaDescuento = computed(() => {
    const d = this.descuento();
    if (!d?.origen) return '';
    return d.origen === 'bienvenida' ? `${d.porcentaje}% de bienvenida` : `${d.porcentaje}% (cupón ${d.codigo})`;
  });

  total = computed(() => redondear(this.subtotal() - this.descuentoMonto()));

  creditoAplicado = computed(() =>
    this.usarCredito() ? redondear(Math.min(this.creditoDisponible(), this.total())) : 0
  );

  aPagar = computed(() => redondear(this.total() - this.creditoAplicado()));

  puntosAGanar = computed(() => (this.logueado() ? Math.floor(this.aPagar()) : 0));

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [catalogo] = await Promise.all([this.candyService.obtenerCatalogoVenta(), this.cargarBeneficios()]);
      const soloCandy: CatalogoCandy = {
        ...catalogo,
        combos: catalogo.combos.filter((combo) => !combo.incluye_entrada)
      };
      this.catalogo.set(soloCandy);
      this.depurarCarrito(soloCandy);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar el Candy Bar. Intentá de nuevo en unos minutos.');
    } finally {
      this.cargando.set(false);
    }
  }

  private async cargarBeneficios(): Promise<void> {
    try {
      const perfil = await this.cuentaService.obtenerPerfil();
      if (!perfil) {
        this.creditoDisponible.set(0);
        this.puntosDisponibles.set(0);
        this.recompensas.set([]);
        this.canjes.set(new Map());
        this.descuento.set(null);
        this.usarCredito.set(false);
        return;
      }

      const [recompensas, descuento] = await Promise.all([
        this.fidelizacion.listarRecompensas(true),
        this.fidelizacion.consultarDescuento(this.cuponAplicado())
      ]);
      this.creditoDisponible.set(perfil.credito);
      this.puntosDisponibles.set(perfil.puntos);

      const deCandy = recompensas.filter((r) => !r.otorga_entrada);
      this.recompensas.set(deCandy);
      const vigentes = new Set(deCandy.map((r) => r.id));
      this.canjes.update((mapa) => new Map(Array.from(mapa).filter(([id]) => vigentes.has(id))));

      this.descuento.set(descuento);
      if (this.cuponAplicado() && descuento.error_cupon) {
        this.errorCupon.set(descuento.error_cupon);
        this.cuponAplicado.set(null);
      }
    } catch (err) {
      console.error(err);
      this.creditoDisponible.set(0);
      this.puntosDisponibles.set(0);
      this.recompensas.set([]);
    }
    if (this.creditoDisponible() <= 0) this.usarCredito.set(false);
  }

  private depurarCarrito(catalogo: CatalogoCandy): void {
    const vigentes = new Set<string>([
      ...catalogo.combos.map((c) => claveCarrito('combo', c.id)),
      ...catalogo.categorias.flatMap((cat) => cat.productos.map((p) => claveCarrito('producto', p.id)))
    ]);
    this.carrito.update((mapa) => new Map(Array.from(mapa).filter(([clave]) => vigentes.has(clave))));
  }

  cambiarCantidad(cambio: CambioCantidadCandy): void {
    const clave = claveCarrito(cambio.tipo, cambio.id);
    this.carrito.update((mapa) => {
      const copia = new Map(mapa);
      if (cambio.cantidad > 0) copia.set(clave, cambio.cantidad);
      else copia.delete(clave);
      return copia;
    });
  }

  quitar(linea: LineaPedido): void {
    this.cambiarCantidad({ tipo: linea.tipo, id: linea.id, cantidad: 0 });
  }

  cambiarCanje(cambio: CambioCanje): void {
    this.canjes.update((mapa) => {
      const copia = new Map(mapa);
      if (cambio.cantidad > 0) copia.set(cambio.id, cambio.cantidad);
      else copia.delete(cambio.id);
      return copia;
    });
  }

  async aplicarCupon(codigo: string): Promise<void> {
    this.validandoCupon.set(true);
    this.errorCupon.set(null);
    try {
      const resultado = await this.fidelizacion.consultarDescuento(codigo);
      this.descuento.set(resultado);
      if (resultado.error_cupon) {
        this.errorCupon.set(resultado.error_cupon);
        this.cuponAplicado.set(null);
      } else {
        this.cuponAplicado.set(codigo.trim().toUpperCase());
      }
    } catch (err: any) {
      console.error(err);
      this.errorCupon.set(err?.message ?? 'No se pudo validar el cupón.');
    } finally {
      this.validandoCupon.set(false);
    }
  }

  async quitarCupon(): Promise<void> {
    this.cuponAplicado.set(null);
    this.errorCupon.set(null);
    try {
      this.descuento.set(await this.fidelizacion.consultarDescuento(null));
    } catch (err) {
      console.error(err);
      this.descuento.set(null);
    }
  }

  async confirmarCompra(): Promise<void> {
    if (!this.hayAlgoEnElPedido() || this.comprando()) return;

    this.comprando.set(true);
    this.errorMessage.set(null);
    try {
      const items: ItemCandySeleccionado[] = this.lineas().map((l) => ({ tipo: l.tipo, id: l.id, cantidad: l.cantidad }));
      const canjes: CanjeSeleccionado[] = this.lineasCanje().map((l) => ({ id: l.recompensa.id, cantidad: l.cantidad }));

      const compra = await this.comprasService.confirmarCompraCandy(
        items,
        this.usarCredito() && this.creditoDisponible() > 0,
        this.cuponAplicado(),
        canjes
      );
      this.compraExitosa.set(compra);
      this.carrito.set(new Map());
      this.canjes.set(new Map());
      this.cuponAplicado.set(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await this.descargarComprobante();
    } catch (err: any) {
      console.error(err);
      await this.cargar();
      this.errorMessage.set(err?.message ?? 'No se pudo confirmar la compra.');
    } finally {
      this.comprando.set(false);
    }
  }

  private descripcionCombo(comboId: string, nombre: string): string {
    const combo = this.catalogo()?.combos.find((c) => c.id === comboId);
    if (!combo) return nombre;
    return `${nombre} (${combo.items.map((item) => `${item.cantidad}x ${item.nombre}`).join(', ')})`;
  }

  async descargarComprobante(): Promise<void> {
    const compra = this.compraExitosa();
    if (!compra) return;

    this.generandoPdf.set(true);
    try {
      await this.comprobantePdf.descargar({
        codigoQr: compra.codigo_qr,
        codigoCorto: formatearCodigoCorto(compra.codigo_corto),
        soloCandy: true,
        fechaCompra: formatearFecha(hoyIso()),
        entradas: [],
        productos: compra.candy.map((item) => ({
          nombre: item.tipo === 'combo' ? this.descripcionCombo(item.id, item.nombre) : item.nombre,
          cantidad: item.cantidad,
          precio: item.precio_unitario,
          canje: item.canje
        })),
        total: compra.total,
        creditoUsado: compra.credito_usado,
        descuento:
          compra.descuento_monto > 0
            ? {
                etiqueta:
                  compra.descuento_origen === 'bienvenida'
                    ? `${compra.descuento_porcentaje}% de bienvenida`
                    : `${compra.descuento_porcentaje}% (cupon ${compra.descuento_codigo})`,
                monto: compra.descuento_monto
              }
            : undefined,
        puntosGanados: compra.puntos_ganados,
        puntosCanjeados: compra.puntos_canjeados
      });
      this.toastService.exito('Comprobante PDF descargado.');
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo generar el comprobante PDF.');
    } finally {
      this.generandoPdf.set(false);
    }
  }

  nuevoPedido(): void {
    this.compraExitosa.set(null);
    this.cargar();
  }

  volverAInicio(): void {
    this.router.navigateByUrl('/inicio');
  }
}
