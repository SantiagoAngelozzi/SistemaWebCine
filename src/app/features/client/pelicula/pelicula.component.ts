import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { FuncionConDetalle } from '../../../core/models/funcion.model';
import { PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { ResenaPublica, ResumenResenas } from '../../../core/models/resena.model';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { PeliculasService } from '../../../core/services/peliculas.service';
import { ResenasService, mensajeErrorResena } from '../../../core/services/resenas.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { ToastService } from '../../../core/services/toast.service';
import { estadoVenta, funcionYaComenzo } from '../../../core/utils/pelicula-fechas';
import { hoyIso } from '../../../core/utils/formato';
import { EstrellasComponent } from '../../../shared/estrellas/estrellas.component';
import { TiempoRelativoPipe } from '../../../shared/pipes/tiempo-relativo.pipe';
import { ResenaFormComponent } from '../../../shared/resena-form/resena-form.component';

@Component({
  selector: 'app-pelicula-detalle',
  standalone: true,
  imports: [CommonModule, RouterLink, EstrellasComponent, ResenaFormComponent, TiempoRelativoPipe],
  templateUrl: './pelicula.component.html',
  styleUrl: './pelicula.component.scss'
})
export class PeliculaComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private peliculasService = inject(PeliculasService);
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  private resenasService = inject(ResenasService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  pelicula = signal<PeliculaConRelaciones | null>(null);
  funciones = signal<FuncionConDetalle[]>([]);
  ventaHabilitada = computed(() => {
    const pelicula = this.pelicula();
    return !!pelicula && estadoVenta(pelicula) !== 'proximamente';
  });

  readonly estrellasDesc = [5, 4, 3, 2, 1];
  resumen = signal<ResumenResenas | null>(null);
  errorResenas = signal(false);
  editandoResena = signal(false);
  esAdmin = signal(false);
  fechaNacimiento = signal<string | null>(null);
  bloqueadaPorEdad = computed(() => {
    const pelicula = this.pelicula();
    return !!pelicula && !this.auth.cumpleClasificacion(pelicula.clasificacion, this.fechaNacimiento());
  });
  logueado = computed(() => !!this.auth.session());
  miResena = computed(() => this.resumen()?.resenas.find((r) => r.esMia) ?? null);

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigateByUrl('/cartelera');
      return;
    }
    this.auth.obtenerRolActual().then((rol) => this.esAdmin.set(rol === 'administrador'));
    this.auth.obtenerFechaNacimiento().then((fecha) => this.fechaNacimiento.set(fecha));
    await Promise.all([this.cargar(id), this.cargarResenas(id)]);
  }

  async cargar(id: string): Promise<void> {
    this.cargando.set(true);
    this.errorMessage.set(null);
    try {
      const [pelicula, { data: funciones, error: errorFunciones }] = await Promise.all([
        this.peliculasService.obtenerActivaPorId(id),
        this.supabase.client
          .from('funciones')
          .select('*, peliculas(nombre), salas(nombre)')
          .eq('pelicula_id', id)
          .gte('fecha', hoyIso())
          .order('fecha')
          .order('hora_inicio')
      ]);

      if (errorFunciones) throw errorFunciones;

      this.pelicula.set(pelicula);
      this.funciones.set(
        (funciones ?? [])
          .filter((fila: any) => !funcionYaComenzo(fila.fecha, fila.hora_inicio))
          .map((fila: any) => ({
            ...fila,
            peliculaNombre: fila.peliculas?.nombre ?? '',
            salaNombre: fila.salas?.nombre ?? ''
          }))
      );
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudo cargar la película.');
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarResenas(peliculaId: string): Promise<void> {
    this.errorResenas.set(false);
    try {
      this.resumen.set(await this.resenasService.obtenerResumen(peliculaId));
    } catch (err) {
      console.error(err);
      this.errorResenas.set(true);
    }
  }

  porcentajeEstrellas(resumen: ResumenResenas, estrellas: number): number {
    return resumen.cantidad ? (resumen.distribucion[estrellas - 1] / resumen.cantidad) * 100 : 0;
  }

  async alGuardarResena(): Promise<void> {
    this.editandoResena.set(false);
    const pelicula = this.pelicula();
    if (pelicula) await this.cargarResenas(pelicula.id);
  }

  async eliminarResena(resena: ResenaPublica): Promise<void> {
    const confirmado = await this.confirmService.preguntar(
      resena.esMia ? '¿Eliminar tu reseña?' : `¿Eliminar la reseña de ${resena.autor}?`,
      { titulo: 'Eliminar reseña', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;
    try {
      await this.resenasService.eliminarResena(resena.id);
      this.toastService.exito('Reseña eliminada');
      const pelicula = this.pelicula();
      if (pelicula) await this.cargarResenas(pelicula.id);
    } catch (err) {
      console.error(err);
      this.toastService.error(mensajeErrorResena(err, 'No se pudo eliminar la reseña.'));
    }
  }

  irAResenas(): void {
    document.getElementById('resenas')?.scrollIntoView({ behavior: 'smooth' });
  }

  irAButacas(funcionId: string): void {
    if (this.bloqueadaPorEdad()) return;
    this.router.navigateByUrl(`/funcion/${funcionId}/butacas`);
  }
}
