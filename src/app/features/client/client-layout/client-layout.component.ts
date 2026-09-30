import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';

interface ClientNavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-client-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './client-layout.component.html',
  styleUrl: './client-layout.component.scss'
})
export class ClientLayoutComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  navItems: ClientNavItem[] = [
    { path: 'inicio', label: 'Inicio' },
    { path: 'cartelera', label: 'Cartelera' },
    { path: 'proximamente', label: 'Próximamente' },
    { path: 'mis-peliculas', label: 'Mis Películas' },
    { path: 'perfil', label: 'Perfil' }
  ];

  /** Se actualiza sola al iniciar o cerrar sesión (signal de AuthService). */
  logueado = computed(() => !!this.auth.session());

  nombreUsuario = computed(() => {
    const usuario = this.auth.session()?.user;
    if (!usuario) return '';
    return (usuario.user_metadata?.['nombre'] as string | undefined) || usuario.email || 'Mi cuenta';
  });

  async cerrarSesion(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/inicio');
  }
}
