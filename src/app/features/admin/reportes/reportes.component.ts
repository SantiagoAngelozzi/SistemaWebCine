import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ReporteFacturacion } from '../../../core/models/reporte.model';
import { ReporteExportService } from '../../../core/services/reporte-export.service';
import { ReportesService, mensajeErrorReporte } from '../../../core/services/reportes.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  diaMes,
  fechaIso,
  formatearEntero,
  formatearMoneda,
  hoyIso,
  parsearIso,
  sumarDias
} from '../../../core/utils/formato';
import { formatearFecha } from '../../../core/utils/pelicula-fechas';
import { GraficoColumnasComponent, PuntoColumna } from '../../../shared/graficos/grafico-columnas.component';
import { RankingBarrasComponent } from '../../../shared/graficos/ranking-barras.component';
import { FechaInputComponent, esFechaIso } from '../../../shared/fecha-input/fecha-input.component';

type Preset = '7' | '30' | 'mes' | 'mes-anterior' | 'personalizado';
type PeriodoPeliculas = 'semana' | 'mes';

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

@Component({
  selector: 'app-admin-reportes',
  standalone: true,
  imports: [CommonModule, FormsModule, GraficoColumnasComponent, RankingBarrasComponent, FechaInputComponent],
  templateUrl: './reportes.component.html',
  styleUrl: './reportes.component.scss'
})
export class ReportesComponent implements OnInit {
  private reportesService = inject(ReportesService);
  private exportService = inject(ReporteExportService);
  private toastService = inject(ToastService);

  readonly formatearMoneda = formatearMoneda;
  readonly formatearEntero = formatearEntero;
  readonly formatearFecha = formatearFecha;
  readonly hoy = hoyIso();
  readonly colorFacturacion = '#A6339B';
  readonly colorEntradas = '#16867C';

  preset = signal<Preset>('30');
  desde = signal(sumarDias(this.hoy, -29));
  hasta = signal(this.hoy);
  periodoPeliculas = signal<PeriodoPeliculas>('semana');

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  reporte = signal<ReporteFacturacion | null>(null);
  exportando = signal<'pdf' | 'xlsx' | null>(null);

  puntosFacturacion = computed(() => this.puntos((d) => d.facturacion));
  puntosEntradas = computed(() => this.puntos((d) => d.entradas));

  peliculas = computed(() => {
    const r = this.reporte();
    if (!r) return [];
    return this.periodoPeliculas() === 'semana' ? r.peliculasSemana : r.peliculasMes;
  });

  rangoPeliculas = computed(() => {
    const r = this.reporte();
    if (!r) return '';
    const dias = this.periodoPeliculas() === 'semana' ? 6 : 29;
    return `${formatearFecha(sumarDias(r.hasta, -dias))} al ${formatearFecha(r.hasta)}`;
  });

  productoEstrella = computed(() => this.reporte()?.productos[0] ?? null);

  diasDetalle = computed(() => [...(this.reporte()?.porDia ?? [])].reverse());

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    if (this.desde() > this.hasta()) {
      this.errorMessage.set('La fecha "desde" no puede ser posterior a "hasta".');
      return;
    }
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      this.reporte.set(await this.reportesService.obtenerReporte(this.desde(), this.hasta()));
    } catch (err) {
      console.error(err);
      this.reporte.set(null);
      this.errorMessage.set(mensajeErrorReporte(err, 'No se pudo cargar el reporte.'));
    } finally {
      this.cargando.set(false);
    }
  }

  async elegirPreset(preset: Preset): Promise<void> {
    this.preset.set(preset);
    const hoy = parsearIso(this.hoy);
    if (preset === '7') {
      this.desde.set(sumarDias(this.hoy, -6));
      this.hasta.set(this.hoy);
    } else if (preset === '30') {
      this.desde.set(sumarDias(this.hoy, -29));
      this.hasta.set(this.hoy);
    } else if (preset === 'mes') {
      this.desde.set(fechaIso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
      this.hasta.set(this.hoy);
    } else if (preset === 'mes-anterior') {
      this.desde.set(fechaIso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)));
      this.hasta.set(fechaIso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)));
    }
    await this.cargar();
  }

  async cambiarFecha(campo: 'desde' | 'hasta', valor: string): Promise<void> {
    if (!esFechaIso(valor) || valor === this[campo]()) return;
    this.preset.set('personalizado');
    this[campo].set(valor);
    await this.cargar();
  }

  exportarPdf(): void {
    this.exportar('pdf');
  }

  exportarXlsx(): void {
    this.exportar('xlsx');
  }

  private exportar(tipo: 'pdf' | 'xlsx'): void {
    const reporte = this.reporte();
    if (!reporte) return;
    this.exportando.set(tipo);
    try {
      if (tipo === 'pdf') this.exportService.exportarPdf(reporte);
      else this.exportService.exportarXlsx(reporte);
    } catch (err) {
      console.error(err);
      this.toastService.error(`No se pudo generar el ${tipo === 'pdf' ? 'PDF' : 'Excel'}.`);
    } finally {
      this.exportando.set(null);
    }
  }

  diaSemana(iso: string): string {
    return DIAS_SEMANA[parsearIso(iso).getDay()];
  }

  private puntos(valor: (d: ReporteFacturacion['porDia'][number]) => number): PuntoColumna[] {
    return (this.reporte()?.porDia ?? []).map((d) => ({
      etiqueta: diaMes(d.dia),
      titulo: `${this.diaSemana(d.dia)} ${formatearFecha(d.dia)}`,
      valor: valor(d)
    }));
  }
}
