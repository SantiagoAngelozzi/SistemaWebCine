import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { EstadoPropuesta, PropuestaPelicula } from '../../../core/models/propuesta.model';
import { ConfirmService } from '../../../core/services/confirm.service';
import { PropuestasService } from '../../../core/services/propuestas.service';
import { ToastService } from '../../../core/services/toast.service';
import { PropuestaCardComponent } from './propuesta-card/propuesta-card.component';

type Filtro = 'todas' | EstadoPropuesta;

@Component({
  selector: 'app-admin-propuestas',
  standalone: true,
  imports: [CommonModule, PropuestaCardComponent],
  templateUrl: './propuestas.component.html',
  styleUrl: './propuestas.component.scss'
})
export class PropuestasComponent implements OnInit {
  private propuestasService = inject(PropuestasService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  readonly filtros: { valor: Filtro; etiqueta: string }[] = [
    { valor: 'pendiente', etiqueta: 'Pendientes' },
    { valor: 'aceptada', etiqueta: 'Aceptadas' },
    { valor: 'rechazada', etiqueta: 'Rechazadas' },
    { valor: 'todas', etiqueta: 'Todas' }
  ];

  cargando = signal(true);
  propuestas = signal<PropuestaPelicula[]>([]);
  filtro = signal<Filtro>('pendiente');
  procesandoId = signal<string | null>(null);

  pendientes = computed(() => this.propuestas().filter((p) => p.estado === 'pendiente').length);

  filtradas = computed(() => {
    const filtro = this.filtro();
    return filtro === 'todas' ? this.propuestas() : this.propuestas().filter((p) => p.estado === filtro);
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.propuestas.set(await this.propuestasService.listarTodas());
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudieron cargar las propuestas.');
    } finally {
      this.cargando.set(false);
    }
  }

  aceptar(propuesta: PropuestaPelicula): void {
    this.router.navigate(['/admin/peliculas'], { queryParams: { propuesta: propuesta.id } });
  }

  async rechazar(propuesta: PropuestaPelicula): Promise<void> {
    const confirmado = await this.confirmService.preguntar(
      `Vas a rechazar la propuesta "${propuesta.titulo}". Le avisamos al cliente y podrá proponer otra película.`,
      { titulo: 'Rechazar propuesta', textoConfirmar: 'Rechazar' }
    );
    if (!confirmado) return;

    this.procesandoId.set(propuesta.id);
    try {
      await this.propuestasService.resolver(propuesta.id, 'rechazada');
      this.toastService.exito('Propuesta rechazada.');
      await this.cargar();
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo rechazar la propuesta.');
    } finally {
      this.procesandoId.set(null);
    }
  }
}
