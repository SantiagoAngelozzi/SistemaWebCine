import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { SECCIONES_ADMIN } from '../../../core/models/rol.model';
import { AuthService } from '../../../core/services/auth.service';
import { PermisosService } from '../../../core/services/permisos.service';

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
export class AdminLayoutComponent implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private permisosService = inject(PermisosService);

  permisos = this.permisosService.permisos;

  navItems = computed<AdminNavItem[]>(() => {
    const permisos = this.permisos();
    const items: AdminNavItem[] = SECCIONES_ADMIN.filter(
      (s) => permisos.esAdmin || permisos.secciones.includes(s.seccion)
    ).map((s) => ({ path: s.ruta, label: s.etiqueta }));

    if (permisos.esAdmin) {
      const indiceEmpleados = items.findIndex((i) => i.path === 'empleados');
      items.splice(indiceEmpleados + 1, 0, { path: '/empleado', label: 'Validar QR' });
    }
    return items;
  });

  async ngOnInit(): Promise<void> {
    await this.permisosService.cargar();
  }

  async cerrarSesion(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/auth/login');
  }
}
