import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';

import {
  ACCIONES_POR_TIPO,
  AuditoriaService,
  FiltrosAuditoria,
  RegistroAuditoria,
  TipoAccion
} from '../../../core/services/auditoria.service';
import {
  CambioCampo,
  DescripcionRegistro,
  NOMBRE_ENTIDAD,
  camposRegistro,
  describirRegistro
} from '../../../core/utils/auditoria-texto';
import { hoyIso } from '../../../core/utils/formato';
import { FechaInputComponent, esFechaIso } from '../../../shared/fecha-input/fecha-input.component';

interface FilaAuditoria {
  registro: RegistroAuditoria;
  descripcion: DescripcionRegistro;
  campos: CambioCampo[];
}

const TAMANIO_PAGINA = 25;

@Component({
  selector: 'app-admin-auditoria',
  standalone: true,
  imports: [CommonModule, FormsModule, FechaInputComponent],
  templateUrl: './auditoria.component.html',
  styleUrl: './auditoria.component.scss'
})
export class AuditoriaComponent implements OnInit, OnDestroy {
  private auditoriaService = inject(AuditoriaService);
  private canal: RealtimeChannel | null = null;

  readonly entidades = Object.entries(NOMBRE_ENTIDAD).map(([valor, nombre]) => ({ valor, nombre }));
  readonly tipos: { valor: TipoAccion; nombre: string }[] = [
    { valor: 'todas', nombre: 'Todas las acciones' },
    { valor: 'altas', nombre: 'Altas' },
    { valor: 'modificaciones', nombre: 'Modificaciones (incluye precios)' },
    { valor: 'bajas', nombre: 'Bajas' },
    { valor: 'qr', nombre: 'Validaciones de QR' },
    { valor: 'cancelaciones', nombre: 'Cancelaciones de compras' },
    { valor: 'roles', nombre: 'Cambios de rol' }
  ];
  readonly tamanioPagina = TAMANIO_PAGINA;
  readonly hoy = hoyIso();

  filtros = signal<FiltrosAuditoria>({ desde: null, hasta: null, entidad: null, tipo: 'todas' });
  pagina = signal(0);
  total = signal(0);
  filas = signal<FilaAuditoria[]>([]);
  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  expandidos = signal<Set<string>>(new Set());
  nuevos = signal<Set<string>>(new Set());
  pendientes = signal(0);

  totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / TAMANIO_PAGINA)));
  hayFiltros = computed(() => {
    const f = this.filtros();
    return !!(f.desde || f.hasta || f.entidad || f.tipo !== 'todas');
  });
  rango = computed(() => {
    if (!this.total()) return '';
    const desde = this.pagina() * TAMANIO_PAGINA + 1;
    const hasta = Math.min(this.total(), desde + this.filas().length - 1);
    return `${desde}–${hasta} de ${this.total()}`;
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
    this.canal = this.auditoriaService.suscribirse((id) => this.alLlegarRegistro(id));
  }

  ngOnDestroy(): void {
    if (this.canal) this.auditoriaService.desuscribirse(this.canal);
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const { registros, total } = await this.auditoriaService.listar(this.filtros(), this.pagina(), TAMANIO_PAGINA);
      this.filas.set(registros.map((r) => this.armarFila(r)));
      this.total.set(total);
      this.pendientes.set(0);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar el registro de auditoría.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarFiltro<K extends keyof FiltrosAuditoria>(campo: K, valor: FiltrosAuditoria[K]): Promise<void> {
    this.filtros.update((f) => ({ ...f, [campo]: valor || (campo === 'tipo' ? 'todas' : null) }));
    this.pagina.set(0);
    await this.cargar();
  }

  async cambiarFecha(campo: 'desde' | 'hasta', valor: string): Promise<void> {
    if (valor && !esFechaIso(valor)) return;
    if ((valor || null) === this.filtros()[campo]) return;
    await this.cambiarFiltro(campo, valor || null);
  }

  async limpiarFiltros(): Promise<void> {
    this.filtros.set({ desde: null, hasta: null, entidad: null, tipo: 'todas' });
    this.pagina.set(0);
    await this.cargar();
  }

  async irAPagina(pagina: number): Promise<void> {
    if (pagina < 0 || pagina >= this.totalPaginas()) return;
    this.pagina.set(pagina);
    await this.cargar();
  }

  async verNuevos(): Promise<void> {
    this.pagina.set(0);
    await this.cargar();
  }

  alternarDetalle(id: string): void {
    this.expandidos.update((actual) => {
      const nuevo = new Set(actual);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  tieneDetalle(fila: FilaAuditoria): boolean {
    return fila.descripcion.cambios.length > 0 || fila.campos.length > 0;
  }

  private async alLlegarRegistro(id: string): Promise<void> {
    try {
      const registro = await this.auditoriaService.obtener(id);
      if (!registro) return;

      if (this.pagina() !== 0 || !this.cumpleFiltros(registro)) {
        if (this.cumpleFiltros(registro)) this.pendientes.update((n) => n + 1);
        return;
      }

      this.filas.update((filas) =>
        filas.some((f) => f.registro.id === id)
          ? filas
          : [this.armarFila(registro), ...filas].slice(0, TAMANIO_PAGINA)
      );
      this.total.update((t) => t + 1);
      this.nuevos.update((s) => new Set(s).add(id));
      setTimeout(() => {
        this.nuevos.update((s) => {
          const copia = new Set(s);
          copia.delete(id);
          return copia;
        });
      }, 4000);
    } catch (err) {
      console.error(err);
    }
  }

  private cumpleFiltros(registro: RegistroAuditoria): boolean {
    const f = this.filtros();
    if (f.entidad && registro.entidad !== f.entidad) return false;
    if (f.tipo !== 'todas' && !ACCIONES_POR_TIPO[f.tipo].includes(registro.accion)) return false;
    if (f.hasta && f.hasta < this.hoy) return false;
    return true;
  }

  private armarFila(registro: RegistroAuditoria): FilaAuditoria {
    return { registro, descripcion: describirRegistro(registro), campos: camposRegistro(registro) };
  }
}
