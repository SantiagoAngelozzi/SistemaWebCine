import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MiCompra, MovimientoCredito, PerfilUsuario } from '../../../core/models/cuenta.model';
import { ComprobantePdfService } from '../../../core/services/comprobante-pdf.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { CuentaService, HORAS_LIMITE_CANCELACION } from '../../../core/services/cuenta.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatearCodigoCorto } from '../../../core/services/validacion.service';
import { formatearFecha } from '../../../core/utils/pelicula-fechas';

type Pestania = 'compras' | 'credito';

const ETIQUETA_ESTADO: Record<MiCompra['estado'], string> = {
  confirmada: 'Confirmada',
  utilizada: 'Utilizada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada'
};

/**
 * Cuenta del usuario registrado: datos, crédito en cuenta, "Mis compras"
 * (con cancelación hasta 2 h antes y re-descarga del comprobante) y el
 * historial de movimientos de crédito.
 */
@Component({
  selector: 'app-perfil',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './perfil.component.html',
  styleUrl: './perfil.component.scss'
})
export class PerfilComponent implements OnInit {
  private cuentaService = inject(CuentaService);
  private comprobantePdf = inject(ComprobantePdfService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  readonly horasLimite = HORAS_LIMITE_CANCELACION;
  readonly formatearCodigoCorto = formatearCodigoCorto;
  readonly formatearFecha = formatearFecha;

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  pestania = signal<Pestania>('compras');

  perfil = signal<PerfilUsuario | null>(null);
  compras = signal<MiCompra[]>([]);
  movimientos = signal<MovimientoCredito[]>([]);

  cancelandoId = signal<string | null>(null);
  descargandoId = signal<string | null>(null);

  /** Funciones que todavía no pasaron ni se usaron, la más cercana primero. */
  proximas = computed(() =>
    this.compras()
      .filter((c) => c.estado === 'confirmada')
      .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
  );

  historial = computed(() => this.compras().filter((c) => c.estado !== 'confirmada'));

  nombreCompleto = computed(() => {
    const p = this.perfil();
    if (!p) return '';
    return `${p.nombre ?? ''} ${p.apellido ?? ''}`.trim() || p.email;
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [perfil, compras, movimientos] = await Promise.all([
        this.cuentaService.obtenerPerfil(),
        this.cuentaService.listarMisCompras(),
        this.cuentaService.listarMovimientosCredito()
      ]);
      this.perfil.set(perfil);
      this.compras.set(compras);
      this.movimientos.set(movimientos);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar tu cuenta. Intentá de nuevo en unos minutos.');
    } finally {
      this.cargando.set(false);
    }
  }

  etiquetaEstado(compra: MiCompra): string {
    return ETIQUETA_ESTADO[compra.estado];
  }

  horaCorta(hora: string): string {
    return hora.slice(0, 5);
  }

  async cancelar(compra: MiCompra): Promise<void> {
    if (!compra.cancelable) return;

    const confirmado = await this.confirmService.preguntar(
      `Vas a cancelar tu compra para "${compra.pelicula}" del ${formatearFecha(compra.fecha)} a las ` +
        `${this.horaCorta(compra.horaInicio)}. Se acreditarán $${compra.total} en tu cuenta para usar en ` +
        `próximas compras (no hay devolución de dinero) y las butacas quedan liberadas.`,
      { titulo: 'Cancelar compra', textoConfirmar: 'Cancelar compra', textoCancelar: 'Volver' }
    );
    if (!confirmado) return;

    this.cancelandoId.set(compra.id);
    try {
      const resultado = await this.cuentaService.cancelarCompra(compra.id);
      this.toastService.exito(
        `Compra cancelada. Se acreditaron $${resultado.credito_otorgado} (crédito disponible: $${resultado.credito_total}).`
      );
      await this.cargar();
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo cancelar la compra.');
      await this.cargar();
    } finally {
      this.cancelandoId.set(null);
    }
  }

  async descargarComprobante(compra: MiCompra): Promise<void> {
    this.descargandoId.set(compra.id);
    try {
      await this.comprobantePdf.descargar({
        codigoQr: compra.codigoQr,
        codigoCorto: formatearCodigoCorto(compra.codigoCorto),
        pelicula: compra.pelicula,
        sala: compra.sala,
        fecha: formatearFecha(compra.fecha),
        hora: this.horaCorta(compra.horaInicio),
        formato: compra.formato,
        idioma: compra.idioma,
        entradas: compra.entradas.map((e) => ({
          ubicacion: e.ubicacion,
          tipo: e.tipo,
          precio: e.precio,
          incluidaEnCombo: e.incluidaEnCombo
        })),
        productos: compra.candy.map((item) => ({
          nombre: item.esCombo
            ? `${item.nombre} (${item.incluyeEntrada ? '1 entrada + ' : ''}${item.contenido})`
            : item.nombre,
          cantidad: item.cantidad,
          precio: item.precioUnitario
        })),
        total: compra.total,
        creditoUsado: compra.creditoUsado,
        advertenciaEdad:
          compra.clasificacion === 'ATP'
            ? undefined
            : `Película ${compra.clasificacion}: concurrencia obligatoria con un adulto responsable.`
      });
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo generar el comprobante PDF.');
    } finally {
      this.descargandoId.set(null);
    }
  }
}
