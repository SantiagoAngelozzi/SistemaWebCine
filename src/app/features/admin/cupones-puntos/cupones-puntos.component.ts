import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';

import { CandyProductoConCategoria } from '../../../core/models/candy.model';
import { Cupon, CuponConUsos, Recompensa } from '../../../core/models/fidelizacion.model';
import { CandyService } from '../../../core/services/candy.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import {
  FidelizacionService,
  mensajeErrorFidelizacion
} from '../../../core/services/fidelizacion.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatearFecha } from '../../../core/utils/pelicula-fechas';
import { FormErrorComponent } from '../../../shared/form-error/form-error.component';

type Tab = 'cupones' | 'puntos';

/** Un cupón segmentado necesita al menos una edad; y la mínima no supera a la máxima. */
function validarRangoEdad(grupo: AbstractControl): ValidationErrors | null {
  const tipo = grupo.get('tipo')?.value;
  const min = grupo.get('edadMinima')?.value;
  const max = grupo.get('edadMaxima')?.value;
  if (tipo !== 'segmentado_edad') return null;
  if (min == null && max == null) return { rangoEdad: 'Indicá una edad mínima, una máxima o ambas.' };
  if (min != null && max != null && min > max) return { rangoEdad: 'La edad mínima no puede superar a la máxima.' };
  return null;
}

@Component({
  selector: 'app-admin-cupones-puntos',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormErrorComponent],
  templateUrl: './cupones-puntos.component.html',
  styleUrl: './cupones-puntos.component.scss'
})
export class CuponesPuntosComponent implements OnInit {
  private fb = inject(FormBuilder);
  private fidelizacion = inject(FidelizacionService);
  private candyService = inject(CandyService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  readonly formatearFecha = formatearFecha;

  tabActiva = signal<Tab>('cupones');
  cargando = signal(true);

  bienvenida = signal<Cupon | null>(null);
  cupones = signal<CuponConUsos[]>([]);
  recompensas = signal<Recompensa[]>([]);
  productos = signal<CandyProductoConCategoria[]>([]);

  guardandoBienvenida = signal(false);
  mostrandoFormCupon = signal(false);
  editandoCuponId = signal<string | null>(null);
  guardandoCupon = signal(false);
  mostrandoFormRecompensa = signal(false);
  editandoRecompensaId = signal<string | null>(null);
  guardandoRecompensa = signal(false);

  formBienvenida = this.fb.nonNullable.group({
    porcentaje: [20, [Validators.required, Validators.min(1), Validators.max(100)]],
    activo: [true]
  });

  formCupon = this.fb.group(
    {
      codigo: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9_-]{3,20}$/)]],
      tipo: this.fb.nonNullable.control<'general' | 'segmentado_edad'>('general'),
      porcentaje: [10, [Validators.required, Validators.min(1), Validators.max(100)]],
      edadMinima: [null as number | null, [Validators.min(0), Validators.max(120)]],
      edadMaxima: [null as number | null, [Validators.min(0), Validators.max(120)]],
      fechaDesde: [''],
      fechaHasta: [''],
      usosMaximos: [null as number | null, Validators.min(1)],
      activo: [true]
    },
    { validators: validarRangoEdad }
  );

  formRecompensa = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    costoPuntos: [500, [Validators.required, Validators.min(1)]],
    tipo: this.fb.nonNullable.control<'entrada' | 'producto'>('entrada'),
    candyProductoId: [''],
    activo: [true]
  });

  /** Mensaje del validador de rango de edad (null si no hay error). */
  get errorRangoEdad(): string | null {
    return this.formCupon.errors?.['rangoEdad'] ?? null;
  }

  async ngOnInit(): Promise<void> {
    await this.cargarTodo();
  }

  async cargarTodo(): Promise<void> {
    this.cargando.set(true);
    try {
      const [bienvenida, cupones, recompensas, productos] = await Promise.all([
        this.fidelizacion.obtenerBienvenida(),
        this.fidelizacion.listarCupones(),
        this.fidelizacion.listarRecompensas(),
        this.candyService.listarProductos()
      ]);
      this.bienvenida.set(bienvenida);
      this.cupones.set(cupones);
      this.recompensas.set(recompensas);
      this.productos.set(productos);
      if (bienvenida) {
        this.formBienvenida.reset({ porcentaje: bienvenida.porcentaje_descuento, activo: bienvenida.activo });
      }
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudieron cargar los cupones y puntos.');
    } finally {
      this.cargando.set(false);
    }
  }

  // ---------- Bienvenida ----------

  async guardarBienvenida(): Promise<void> {
    if (this.formBienvenida.invalid) {
      this.formBienvenida.markAllAsTouched();
      return;
    }
    this.guardandoBienvenida.set(true);
    try {
      const { porcentaje, activo } = this.formBienvenida.getRawValue();
      await this.fidelizacion.guardarBienvenida(porcentaje, activo);
      this.toastService.exito('Cupón de bienvenida actualizado');
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorFidelizacion(err, 'No se pudo guardar el cupón de bienvenida.'));
    } finally {
      this.guardandoBienvenida.set(false);
    }
  }

  // ---------- Cupones ----------

  abrirNuevoCupon(): void {
    this.editandoCuponId.set(null);
    this.formCupon.reset({
      codigo: '',
      tipo: 'general',
      porcentaje: 10,
      edadMinima: null,
      edadMaxima: null,
      fechaDesde: '',
      fechaHasta: '',
      usosMaximos: null,
      activo: true
    });
    this.mostrandoFormCupon.set(true);
  }

  abrirEdicionCupon(cupon: CuponConUsos): void {
    this.editandoCuponId.set(cupon.id);
    this.formCupon.reset({
      codigo: cupon.codigo,
      tipo: cupon.tipo === 'segmentado_edad' ? 'segmentado_edad' : 'general',
      porcentaje: cupon.porcentaje_descuento,
      edadMinima: cupon.edad_minima,
      edadMaxima: cupon.edad_maxima,
      fechaDesde: cupon.fecha_desde,
      fechaHasta: cupon.fecha_hasta ?? '',
      usosMaximos: cupon.usos_maximos,
      activo: cupon.activo
    });
    this.mostrandoFormCupon.set(true);
  }

  async guardarCupon(): Promise<void> {
    if (this.formCupon.invalid) {
      this.formCupon.markAllAsTouched();
      this.toastService.error(this.formCupon.errors?.['rangoEdad'] ?? 'Revisá los campos marcados en rojo.');
      return;
    }
    this.guardandoCupon.set(true);
    try {
      const v = this.formCupon.getRawValue();
      const valores = {
        codigo: v.codigo ?? '',
        tipo: v.tipo,
        porcentaje: Number(v.porcentaje),
        edadMinima: v.edadMinima,
        edadMaxima: v.edadMaxima,
        fechaDesde: v.fechaDesde ?? '',
        fechaHasta: v.fechaHasta ?? '',
        usosMaximos: v.usosMaximos,
        activo: !!v.activo
      };
      const id = this.editandoCuponId();
      if (id) {
        await this.fidelizacion.actualizarCupon(id, valores);
        this.toastService.exito('Cupón actualizado');
      } else {
        await this.fidelizacion.crearCupon(valores);
        this.toastService.exito('Cupón creado 🎟️');
      }
      this.mostrandoFormCupon.set(false);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorFidelizacion(err, 'No se pudo guardar el cupón.'));
    } finally {
      this.guardandoCupon.set(false);
    }
  }

  async eliminarCupon(cupon: CuponConUsos): Promise<void> {
    const confirmado = await this.confirmService.preguntar(`¿Eliminar el cupón ${cupon.codigo}?`, {
      titulo: 'Eliminar cupón',
      textoConfirmar: 'Eliminar'
    });
    if (!confirmado) return;
    try {
      await this.fidelizacion.eliminarCupon(cupon.id);
      this.toastService.exito('Cupón eliminado');
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorFidelizacion(err, 'No se pudo eliminar el cupón.'));
    }
  }

  condicionCupon(cupon: Cupon): string {
    if (cupon.tipo !== 'segmentado_edad') return 'Todos los registrados';
    if (cupon.edad_minima != null && cupon.edad_maxima != null) {
      return `De ${cupon.edad_minima} a ${cupon.edad_maxima} años`;
    }
    if (cupon.edad_minima != null) return `${cupon.edad_minima} años o más`;
    return `Hasta ${cupon.edad_maxima} años`;
  }

  vigenciaCupon(cupon: Cupon): string {
    const desde = formatearFecha(cupon.fecha_desde);
    return cupon.fecha_hasta ? `${desde} al ${formatearFecha(cupon.fecha_hasta)}` : `Desde ${desde}`;
  }

  // ---------- Recompensas ----------

  abrirNuevaRecompensa(): void {
    this.editandoRecompensaId.set(null);
    this.formRecompensa.reset({ nombre: '', costoPuntos: 500, tipo: 'entrada', candyProductoId: '', activo: true });
    this.mostrandoFormRecompensa.set(true);
  }

  abrirEdicionRecompensa(recompensa: Recompensa): void {
    this.editandoRecompensaId.set(recompensa.id);
    this.formRecompensa.reset({
      nombre: recompensa.nombre,
      costoPuntos: recompensa.costo_puntos,
      tipo: recompensa.otorga_entrada ? 'entrada' : 'producto',
      candyProductoId: recompensa.candy_producto_id ?? '',
      activo: recompensa.activo
    });
    this.mostrandoFormRecompensa.set(true);
  }

  async guardarRecompensa(): Promise<void> {
    const valores = this.formRecompensa.getRawValue();
    if (this.formRecompensa.invalid) {
      this.formRecompensa.markAllAsTouched();
      this.toastService.error('Revisá los campos marcados en rojo.');
      return;
    }
    if (valores.tipo === 'producto' && !valores.candyProductoId) {
      this.toastService.error('Elegí el producto del Candy Bar que se canjea.');
      return;
    }
    this.guardandoRecompensa.set(true);
    try {
      const id = this.editandoRecompensaId();
      if (id) {
        await this.fidelizacion.actualizarRecompensa(id, valores);
        this.toastService.exito('Recompensa actualizada');
      } else {
        await this.fidelizacion.crearRecompensa(valores);
        this.toastService.exito('Recompensa creada ⭐');
      }
      this.mostrandoFormRecompensa.set(false);
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorFidelizacion(err, 'No se pudo guardar la recompensa.'));
    } finally {
      this.guardandoRecompensa.set(false);
    }
  }

  async eliminarRecompensa(recompensa: Recompensa): Promise<void> {
    const confirmado = await this.confirmService.preguntar(`¿Eliminar la recompensa "${recompensa.nombre}"?`, {
      titulo: 'Eliminar recompensa',
      textoConfirmar: 'Eliminar'
    });
    if (!confirmado) return;
    try {
      await this.fidelizacion.eliminarRecompensa(recompensa.id);
      this.toastService.exito('Recompensa eliminada');
      await this.cargarTodo();
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorFidelizacion(err, 'No se pudo eliminar la recompensa.'));
    }
  }
}
