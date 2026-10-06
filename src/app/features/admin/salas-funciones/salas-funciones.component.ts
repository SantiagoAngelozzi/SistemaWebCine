import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { FuncionConDetalle } from '../../../core/models/funcion.model';
import { FormatoProyeccion, IdiomaPelicula, PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { SalaConCantidadButacas } from '../../../core/models/sala.model';
import { ConfirmService } from '../../../core/services/confirm.service';
import { FuncionesService } from '../../../core/services/funciones.service';
import { hoyIso, parsearIso, sumarDias } from '../../../core/utils/formato';
import { formatearFecha, funcionYaComenzo } from '../../../core/utils/pelicula-fechas';
import { PeliculasService } from '../../../core/services/peliculas.service';
import { SalasService } from '../../../core/services/salas.service';
import { ToastService } from '../../../core/services/toast.service';
import { FechaInputComponent, esFechaIso } from '../../../shared/fecha-input/fecha-input.component';
import { FormErrorComponent } from '../../../shared/form-error/form-error.component';

type Tab = 'salas' | 'funciones';

interface DiaCalendario {
  iso: string;
  etiqueta: string;
  diaMes: string;
  diaSemana: number;
}

interface ResultadoProgramacion {
  fecha: string;
  hora: string;
  ok: boolean;
  detalle: string;
}

const NOMBRES_DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_FUNCIONES_POR_VEZ = 60;

@Component({
  selector: 'app-admin-salas-funciones',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, FormErrorComponent, FechaInputComponent],
  templateUrl: './salas-funciones.component.html',
  styleUrl: './salas-funciones.component.scss'
})
export class SalasFuncionesComponent implements OnInit {
  private fb = inject(FormBuilder);
  private salasService = inject(SalasService);
  private funcionesService = inject(FuncionesService);
  private peliculasService = inject(PeliculasService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  readonly hoy = hoyIso();

  tabActiva = signal<Tab>('salas');

  cargando = signal(true);
  guardandoSala = signal(false);
  guardandoFuncion = signal(false);
  errorMessage = signal<string | null>(null);

  salas = signal<SalaConCantidadButacas[]>([]);
  funciones = signal<FuncionConDetalle[]>([]);
  mostrarPasadas = signal(false);

  proximas = computed(() => this.funciones().filter((f) => !funcionYaComenzo(f.fecha, f.hora_inicio)));

  pasadas = computed(() =>
    this.funciones()
      .filter((f) => funcionYaComenzo(f.fecha, f.hora_inicio))
      .reverse()
  );

  funcionesVisibles = computed(() =>
    this.mostrarPasadas() ? [...this.proximas(), ...this.pasadas()] : this.proximas()
  );
  peliculas = signal<PeliculaConRelaciones[]>([]);

  formatosDisponibles: FormatoProyeccion[] = ['2D', '3D', '4D', '5D'];

  formFuncion = this.fb.nonNullable.group({
    peliculaId: ['', Validators.required],
    formato: ['2D' as FormatoProyeccion, Validators.required],
    idioma: ['castellano' as IdiomaPelicula, Validators.required],
  });

  readonly horariosSugeridos = ['13:00', '15:30', '18:00', '20:30', '23:00'];
  readonly diasSemana = [1, 2, 3, 4, 5, 6, 0].map((numero) => ({ numero, nombre: NOMBRES_DIA[numero] }));
  readonly formatearFecha = formatearFecha;

  diasVisibles = signal(14);
  diasSeleccionados = signal<Set<string>>(new Set());
  horasSeleccionadas = signal<Set<string>>(new Set());
  horaManual = signal('');
  errorHora = signal<string | null>(null);
  fechaExtra = signal('');
  intentoProgramar = signal(false);
  progreso = signal<{ hechas: number; total: number } | null>(null);
  resultados = signal<ResultadoProgramacion[]>([]);

  proximosDias = computed<DiaCalendario[]>(() =>
    Array.from({ length: this.diasVisibles() }, (_, i) => {
      const iso = sumarDias(this.hoy, i);
      const fecha = parsearIso(iso);
      return {
        iso,
        etiqueta: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : NOMBRES_DIA[fecha.getDay()],
        diaMes: `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}`,
        diaSemana: fecha.getDay()
      };
    })
  );

  diasExtra = computed(() => {
    const visibles = new Set(this.proximosDias().map((d) => d.iso));
    return Array.from(this.diasSeleccionados())
      .filter((iso) => !visibles.has(iso))
      .sort();
  });

  horasExtra = computed(() =>
    Array.from(this.horasSeleccionadas())
      .filter((hora) => !this.horariosSugeridos.includes(hora))
      .sort()
  );

  combinaciones = computed(() => {
    const dias = Array.from(this.diasSeleccionados()).sort();
    const horas = Array.from(this.horasSeleccionadas()).sort();
    return dias.flatMap((fecha) => horas.map((hora) => ({ fecha, hora })));
  });

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
  }

  cambiarTab(tab: Tab): void {
    this.tabActiva.set(tab);
    this.errorMessage.set(null);
  }

  async cargarTodo(): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [salas, funciones, peliculas] = await Promise.all([
        this.salasService.listar(),
        this.funcionesService.listar(),
        this.peliculasService.listar()
      ]);
      this.salas.set(salas);
      this.funciones.set(funciones);
      this.peliculas.set(peliculas);
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar los datos.');
    } finally {
      this.cargando.set(false);
    }
  }

  async crearSala(nombre: string): Promise<void> {
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) {
      this.toastService.error('Ingresá un nombre para la sala.');
      return;
    }

    this.guardandoSala.set(true);
    try {
      await this.salasService.crear(nombreLimpio);
      this.toastService.exito(`Sala "${nombreLimpio}" creada con sus butacas`);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudo crear la sala.');
    } finally {
      this.guardandoSala.set(false);
    }
  }

  async eliminarSala(sala: SalaConCantidadButacas): Promise<void> {
    const confirmado = await this.confirmService.preguntar(
      `¿Eliminar la sala "${sala.nombre}" y sus ${sala.cantidadButacas} butacas? Esta acción no se puede deshacer.`,
      { titulo: 'Eliminar sala', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;

    try {
      await this.salasService.eliminar(sala.id);
      this.toastService.exito('Sala eliminada');
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(
        'No se pudo eliminar la sala (probablemente tenga funciones programadas todavía).'
      );
    }
  }

  toggleDia(iso: string): void {
    this.diasSeleccionados.update((set) => {
      const copia = new Set(set);
      if (copia.has(iso)) copia.delete(iso);
      else copia.add(iso);
      return copia;
    });
  }

  diaSemanaCompleto(numero: number): boolean {
    const dias = this.proximosDias().filter((d) => d.diaSemana === numero);
    return dias.length > 0 && dias.every((d) => this.diasSeleccionados().has(d.iso));
  }

  toggleDiaSemana(numero: number): void {
    const dias = this.proximosDias().filter((d) => d.diaSemana === numero);
    const completo = this.diaSemanaCompleto(numero);
    this.diasSeleccionados.update((set) => {
      const copia = new Set(set);
      for (const dia of dias) {
        if (completo) copia.delete(dia.iso);
        else copia.add(dia.iso);
      }
      return copia;
    });
  }

  agregarFechaExtra(valor: string): void {
    this.fechaExtra.set(valor);
    if (!esFechaIso(valor)) return;
    this.diasSeleccionados.update((set) => new Set(set).add(valor));
    setTimeout(() => this.fechaExtra.set(''));
  }

  toggleHora(hora: string): void {
    this.horasSeleccionadas.update((set) => {
      const copia = new Set(set);
      if (copia.has(hora)) copia.delete(hora);
      else copia.add(hora);
      return copia;
    });
  }

  escribirHora(input: HTMLInputElement): void {
    const digitos = input.value.replace(/\D/g, '').slice(0, 4);
    const texto = digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos;
    input.value = texto;
    this.horaManual.set(texto);
    this.errorHora.set(null);
  }

  agregarHoraManual(): void {
    const hora = this.horaManual();
    if (!hora) return;
    if (!HORA_VALIDA.test(hora)) {
      this.errorHora.set('Escribí la hora como HH:MM, por ejemplo 21:45.');
      return;
    }
    this.horasSeleccionadas.update((set) => new Set(set).add(hora));
    this.horaManual.set('');
    this.errorHora.set(null);
  }

  limpiarProgramacion(): void {
    this.diasSeleccionados.set(new Set());
    this.horasSeleccionadas.set(new Set());
    this.intentoProgramar.set(false);
  }

  async crearFuncion(): Promise<void> {
    this.intentoProgramar.set(true);
    if (this.formFuncion.invalid) {
      this.formFuncion.markAllAsTouched();
      this.toastService.error('Elegí la película.');
      return;
    }
    if (!this.diasSeleccionados().size || !this.horasSeleccionadas().size) {
      this.toastService.error('Elegí al menos un día y un horario.');
      return;
    }

    const combinaciones = this.combinaciones();
    if (combinaciones.length > MAX_FUNCIONES_POR_VEZ) {
      this.toastService.error(`Podés programar hasta ${MAX_FUNCIONES_POR_VEZ} funciones por vez.`);
      return;
    }

    const valores = this.formFuncion.getRawValue();
    const resultados: (ResultadoProgramacion & { id?: string })[] = [];
    this.guardandoFuncion.set(true);
    this.resultados.set([]);
    this.progreso.set({ hechas: 0, total: combinaciones.length });

    try {
      for (const { fecha, hora } of combinaciones) {
        if (funcionYaComenzo(fecha, hora)) {
          resultados.push({ fecha, hora, ok: false, detalle: 'Ese horario ya pasó.' });
        } else {
          try {
            const id = await this.funcionesService.crear({ ...valores, fecha, horaInicio: hora });
            resultados.push({ fecha, hora, ok: true, detalle: '', id });
          } catch (err: any) {
            console.error(err);
            resultados.push({ fecha, hora, ok: false, detalle: err?.message ?? 'No se pudo crear.' });
          }
        }
        this.progreso.set({ hechas: resultados.length, total: combinaciones.length });
      }

      await this.cargarTodo();
      const salaPorFuncion = new Map(this.funciones().map((f) => [f.id, f.salaNombre]));
      this.resultados.set(
        resultados.map(({ id, ...r }) => (r.ok && id ? { ...r, detalle: salaPorFuncion.get(id) ?? 'Programada' } : r))
      );

      const creadas = resultados.filter((r) => r.ok).length;
      if (creadas === resultados.length) {
        this.toastService.exito(creadas === 1 ? 'Función programada.' : `Se programaron las ${creadas} funciones.`);
        this.limpiarProgramacion();
      } else if (creadas > 0) {
        this.toastService.error(`Se programaron ${creadas} de ${resultados.length}. Revisá el detalle.`);
      } else {
        this.toastService.error('No se pudo programar ninguna función. Revisá el detalle.');
      }
    } finally {
      this.guardandoFuncion.set(false);
      this.progreso.set(null);
    }
  }

  esPasada(funcion: FuncionConDetalle): boolean {
    return funcionYaComenzo(funcion.fecha, funcion.hora_inicio);
  }

  async eliminarFuncion(funcion: FuncionConDetalle): Promise<void> {
    if (funcion.tieneCompras) return;
    const confirmado = await this.confirmService.preguntar(
      `¿Eliminar la función de "${funcion.peliculaNombre}"?`,
      { titulo: 'Eliminar función', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;

    try {
      await this.funcionesService.eliminar(funcion.id);
      this.toastService.exito('Función eliminada');
      await this.cargarTodo();
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo eliminar la función.');
    }
  }
}
