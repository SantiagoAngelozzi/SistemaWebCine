import { Injectable, inject } from '@angular/core';

import { FilaReporteDia, ItemRanking, ReporteFacturacion } from '../models/reporte.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class ReportesService {
  private supabase = inject(SupabaseService);

  async obtenerReporte(desde: string, hasta: string): Promise<ReporteFacturacion> {
    const { data, error } = await this.supabase.client.rpc('reporte_facturacion', {
      p_desde: desde,
      p_hasta: hasta
    });
    if (error) throw error;

    const r = (data ?? {}) as any;
    const res = r.resumen ?? {};
    return {
      desde: r.desde,
      hasta: r.hasta,
      generado: r.generado,
      resumen: {
        compras: num(res.compras),
        entradas: num(res.entradas),
        subtotal: num(res.subtotal),
        descuentos: num(res.descuentos),
        facturacion: num(res.facturacion),
        credito: num(res.credito),
        cobrado: num(res.cobrado),
        candy: num(res.candy),
        canceladas: num(res.canceladas),
        ticketPromedio: num(res.ticket_promedio)
      },
      porDia: ((r.por_dia ?? []) as any[]).map(
        (d): FilaReporteDia => ({
          dia: d.dia,
          compras: num(d.compras),
          entradas: num(d.entradas),
          subtotal: num(d.subtotal),
          descuentos: num(d.descuentos),
          facturacion: num(d.facturacion),
          credito: num(d.credito),
          cobrado: num(d.cobrado),
          candy: num(d.candy),
          canceladas: num(d.canceladas)
        })
      ),
      peliculasSemana: ranking(r.peliculas_semana, 'entradas'),
      peliculasMes: ranking(r.peliculas_mes, 'entradas'),
      productos: ranking(r.productos, 'unidades'),
      combos: ranking(r.combos, 'unidades')
    };
  }
}

function num(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function ranking(filas: unknown, campoCantidad: 'entradas' | 'unidades'): ItemRanking[] {
  return ((filas ?? []) as any[]).map((f) => ({
    nombre: f.nombre ?? '',
    cantidad: num(f[campoCantidad]),
    recaudacion: num(f.recaudacion)
  }));
}

export function mensajeErrorReporte(err: any, porDefecto: string): string {
  return err?.code === 'P0001' && err?.message ? err.message : porDefecto;
}
