import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';

interface AdminNavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './admin-layout.component.html',
  styleUrl: './admin-layout.component.scss'
})
export class AdminLayoutComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  navItems: AdminNavItem[] = [
    { path: 'peliculas', label: 'Películas' },
    { path: 'salas-funciones', label: 'Salas y Funciones' },
    { path: 'candy-bar', label: 'Candy Bar' },
    { path: 'cupones-puntos', label: 'Cupones y Puntos' },
    { path: 'reportes', label: 'Reportes' },
    { path: 'auditoria', label: 'Auditoría', },
  ];

  async cerrarSesion(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/auth/login');
  }
}
