import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { FuncionDePelicula } from '../../../core/models/funcion.model';
import { EstadoEsperaFuncion } from '../../../core/models/lista-espera.model';
import { PeliculaConRelaciones } from '../../../core/models/pelicula.model';
import { ResenaPublica, ResumenResenas } from '../../../core/models/resena.model';
import { AuthService } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { FuncionesService } from '../../../core/services/funciones.service';
import { ListaEsperaService } from '../../../core/services/lista-espera.service';
import { PeliculasService } from '../../../core/services/peliculas.service';
import { ResenasService, mensajeErrorResena } from '../../../core/services/resenas.service';
import { ToastService } from '../../../core/services/toast.service';
import { estadoVenta } from '../../../core/utils/pelicula-fechas';
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
  private funcionesService = inject(FuncionesService);
  private listaEsperaService = inject(ListaEsperaService);
  private auth = inject(AuthService);
  private resenasService = inject(ResenasService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  pelicula = signal<PeliculaConRelaciones | null>(null);
  funciones = signal<FuncionDePelicula[]>([]);
  esperas = signal<Map<string, EstadoEsperaFuncion>>(new Map());
  procesandoEsperaId = signal<string | null>(null);
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
      const [pelicula, funciones] = await Promise.all([
        this.peliculasService.obtenerActivaPorId(id),
        this.funcionesService.listarProximasDePelicula(id)
      ]);

      this.pelicula.set(pelicula);
      this.funciones.set(funciones);
      await this.cargarEsperas();
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

  async cargarEsperas(): Promise<void> {
    try {
      this.esperas.set(await this.listaEsperaService.estadoDeFunciones(this.funciones().map((f) => f.id)));
    } catch (err) {
      console.error(err);
      this.esperas.set(new Map());
    }
  }

  espera(funcionId: string): EstadoEsperaFuncion | undefined {
    return this.esperas().get(funcionId);
  }

  async anotarse(funcion: FuncionDePelicula): Promise<void> {
    if (!this.logueado()) {
      this.router.navigateByUrl('/auth/login');
      return;
    }
    this.procesandoEsperaId.set(funcion.id);
    try {
      const posicion = await this.listaEsperaService.anotarse(funcion.id);
      this.toastService.exito(
        `Te anotaste en la lista de espera (posición ${posicion}). Si se libera una butaca te avisamos y tenés 15 minutos para comprarla.`
      );
      await this.cargarEsperas();
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo anotarte en la lista de espera.');
      await this.cargarEsperas();
    } finally {
      this.procesandoEsperaId.set(null);
    }
  }

  async salirDeEspera(funcion: FuncionDePelicula): Promise<void> {
    this.procesandoEsperaId.set(funcion.id);
    try {
      await this.listaEsperaService.salir(funcion.id);
      this.toastService.exito('Saliste de la lista de espera.');
      await this.cargarEsperas();
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo salir de la lista de espera.');
    } finally {
      this.procesandoEsperaId.set(null);
    }
  }

  irAButacas(funcionId: string): void {
    if (this.bloqueadaPorEdad()) return;
    this.router.navigateByUrl(`/funcion/${funcionId}/butacas`);
  }
}
