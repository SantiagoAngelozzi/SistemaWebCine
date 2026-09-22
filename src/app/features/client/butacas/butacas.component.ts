import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';

import { FuncionParaCompra } from '../../../core/models/compra.model';
import { Butaca, TipoButaca } from '../../../core/models/sala.model';
import { ComprasService } from '../../../core/services/compras.service';
import { SupabaseService } from '../../../core/services/supabase.service';

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

// Identificador propio de esta pestaña/sesion, para distinguir "mis"
// selecciones transmitidas por broadcast de las de otros usuarios.
const CLIENTE_ID = crypto.randomUUID();

@Component({
  selector: 'app-butacas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './butacas.component.html',
  styleUrl: './butacas.component.scss'
})
export class ButacasComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private comprasService = inject(ComprasService);
  private supabase = inject(SupabaseService);

  recargoVipTexto = '50%';

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  comprando = signal(false);
  codigoCompraExitosa = signal<string | null>(null);

  funcion = signal<FuncionParaCompra | null>(null);
  filas = signal<FilaUI[]>([]);
  seleccionadas = signal<Set<string>>(new Set());

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

  total = computed(() => {
    const funcion = this.funcion();
    if (!funcion) return 0;
    return Array.from(this.seleccionadas()).reduce((acc, id) => {
      const butaca = this.butacasPorId.get(id);
      if (!butaca) return acc;
      return acc + this.comprasService.calcularPrecioButaca(funcion.precio, butaca.tipo);
    }, 0);
  });

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
      this.funcion.set(funcion);

      const [butacas, ocupadas] = await Promise.all([
        this.comprasService.listarButacasDeSala(funcion.sala_id),
        this.comprasService.listarButacasOcupadas(this.funcionId)
      ]);

      this.armarFilas(butacas, ocupadas);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar el mapa de butacas.'); 
    } finally {
      this.cargando.set(false);
    }
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
        const item: ButacaUI = { ...b, estado: ocupadas.has(b.id) ? 'ocupada' : 'libre' };
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
  }

  private suscribirseRealtime(): void {
    // Capa 1: ocupacion real. Cuando alguien confirma una compra (en
    // cualquier pestaña/dispositivo), la butaca se traba para todos los
    // que esten mirando esta funcion en ese momento.
    this.canalOcupacion = this.comprasService.suscribirseAOcupacion(this.funcionId, (butacaId) => {
      this.marcarEstado(butacaId, 'ocupada');
      this.seleccionadas.update((set) => {
        if (!set.has(butacaId)) return set;
        const copia = new Set(set);
        copia.delete(butacaId);
        return copia;
      });
    });

    // Capa 2: selecciones en curso de otros usuarios (broadcast efimero,
    // no persiste en la base). Asi dos personas ven en vivo que la otra
    // esta por elegir una butaca, antes de que confirme nada.
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

  private marcarEstado(butacaId: string, estado: EstadoButaca): void {
    const butaca = this.butacasPorId.get(butacaId);
    if (!butaca || butaca.estado === 'ocupada') return;
    butaca.estado = estado;
    // Los objetos butaca estan mutados in-place dentro del Map; disparamos
    // el signal con una copia superficial para que Angular vuelva a pintar.
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

  async confirmarCompra(): Promise<void> {
    const funcion = this.funcion();
    if (!funcion || !this.seleccionadas().size) return;

    this.comprando.set(true);
    this.errorMessage.set(null);

    try {
      const {
        data: { session }
      } = await this.supabase.client.auth.getSession();

      const butacas: { id: string; tipo: TipoButaca }[] = Array.from(this.seleccionadas()).map((id) => {
        const b = this.butacasPorId.get(id)!;
        return { id: b.id, tipo: b.tipo };
      });

      const codigo = await this.comprasService.confirmarCompra(
        funcion.id,
        butacas,
        funcion.precio,
        session?.user.id ?? null
      );

      this.codigoCompraExitosa.set(codigo);
    } catch (err: any) {
      console.error(err);
      this.errorMessage.set(err?.message ?? 'No se pudo confirmar la compra.');
      await this.cargar(); // refrescar por si alguna butaca se vendio mientras tanto
    } finally {
      this.comprando.set(false);
    }
  }

  volverAInicio(): void {
    this.router.navigateByUrl('/inicio');
  }
}