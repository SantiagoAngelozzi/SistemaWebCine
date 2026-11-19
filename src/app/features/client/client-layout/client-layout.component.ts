import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Notificacion } from '../../../core/models/notificacion.model';
import { AuthService } from '../../../core/services/auth.service';
import { NotificacionesService } from '../../../core/services/notificaciones.service';
import { PermisosService } from '../../../core/services/permisos.service';
import { CampanaNotificacionesComponent } from '../../../shared/campana-notificaciones/campana-notificaciones.component';

interface ClientNavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-client-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, CampanaNotificacionesComponent],
  templateUrl: './client-layout.component.html',
  styleUrl: './client-layout.component.scss'
})
export class ClientLayoutComponent implements OnDestroy {
  private auth = inject(AuthService);
  private router = inject(Router);
  private permisos = inject(PermisosService);
  readonly notificacionesService = inject(NotificacionesService);

  navItems: ClientNavItem[] = [
    { path: 'inicio', label: 'Inicio' },
    { path: 'cartelera', label: 'Cartelera' },
    { path: 'proximamente', label: 'Próximamente' },
    { path: 'candy-bar', label: 'Candy Bar' },
    { path: 'mis-peliculas', label: 'Mis Películas' },
    { path: 'proponer-pelicula', label: 'Proponer' },
    { path: 'perfil', label: 'Perfil' }
  ];

  logueado = computed(() => !!this.auth.session());
  accesoPanel = this.permisos.esStaff;

  puedeActivarAvisos = computed(() => this.notificacionesService.permisoNavegador() === 'default');

  nombreUsuario = computed(() => {
    const usuario = this.auth.session()?.user;
    if (!usuario) return '';
    return (usuario.user_metadata?.['nombre'] as string | undefined) || usuario.email || 'Mi cuenta';
  });

  constructor() {
    effect(() => {
      const usuarioId: string | undefined = this.auth.session()?.user?.id;
      if (usuarioId) {
        this.notificacionesService.iniciar(usuarioId);
        this.permisos.cargar();
      } else {
        this.notificacionesService.detener();
      }
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void {
    this.notificacionesService.detener();
  }

  abrirNotificacion(notificacion: Notificacion): void {
    this.notificacionesService.abrir(notificacion);
  }

  async cerrarSesion(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/inicio');
  }
}
