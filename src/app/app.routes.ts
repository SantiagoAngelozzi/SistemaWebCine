import { Routes } from '@angular/router';

import { adminGuard } from './core/guards/admin.guard';
import { inicioAdminGuard, permisoGuard } from './core/guards/permiso.guard';
import { empleadoGuard, sesionGuard, sinEmpleadoGuard } from './core/guards/rol.guard';
import { edadFuncionGuard } from './core/guards/edad.guard';

export const routes: Routes = [
  {
    path: 'auth/login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent)
  },
    {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./features/admin/admin-layout/admin-layout.component').then(
        (m) => m.AdminLayoutComponent
      ),
    children: [
      { path: '', pathMatch: 'full', canActivate: [inicioAdminGuard], children: [] },
      {
        path: 'peliculas',
        canActivate: [permisoGuard],
        data: { seccion: 'peliculas' },
        loadComponent: () =>
          import('./features/admin/peliculas/peliculas.component').then(
            (m) => m.PeliculasComponent
          )
      },
      {
        path: 'salas-funciones',
        canActivate: [permisoGuard],
        data: { seccion: 'salas_funciones' },
        loadComponent: () =>
          import('./features/admin/salas-funciones/salas-funciones.component').then(
            (m) => m.SalasFuncionesComponent
          )
      },
      {
        path: 'candy-bar',
        canActivate: [permisoGuard],
        data: { seccion: 'candy' },
        loadComponent: () =>
          import('./features/admin/candy-bar/candy-bar.component').then(
            (m) => m.CandyBarComponent
          )
      },
      {
        path: 'empleados',
        canActivate: [permisoGuard],
        data: { seccion: 'empleados' },
        loadComponent: () =>
          import('./features/admin/empleados/empleados.component').then(
            (m) => m.EmpleadosComponent
          )
      },
      {
        path: 'cupones-puntos',
        canActivate: [permisoGuard],
        data: { seccion: 'cupones' },
        loadComponent: () =>
          import('./features/admin/cupones-puntos/cupones-puntos.component').then(
            (m) => m.CuponesPuntosComponent
          )
      },
      {
        path: 'reportes',
        canActivate: [permisoGuard],
        data: { seccion: 'reportes' },
        loadComponent: () =>
          import('./features/admin/reportes/reportes.component').then((m) => m.ReportesComponent)
      },
      {
        path: 'auditoria',
        canActivate: [permisoGuard],
        data: { seccion: 'auditoria' },
        loadComponent: () =>
          import('./features/admin/auditoria/auditoria.component').then((m) => m.AuditoriaComponent)
      },
      {
        path: 'propuestas',
        canActivate: [permisoGuard],
        data: { seccion: 'propuestas' },
        loadComponent: () =>
          import('./features/admin/propuestas/propuestas.component').then((m) => m.PropuestasComponent)
      },
      {
        path: 'roles',
        canActivate: [permisoGuard],
        data: { seccion: 'roles' },
        loadComponent: () =>
          import('./features/admin/roles/roles.component').then((m) => m.RolesComponent)
      }
    ]
  },
  {
    path: 'empleado',
    canActivate: [empleadoGuard],
    loadComponent: () =>
      import('./features/empleado/validar-qr/validar-qr.component').then(
        (m) => m.ValidarQrComponent
      )
  },
  {
    path: '',
    canActivate: [sinEmpleadoGuard],
    canActivateChild: [sinEmpleadoGuard],
    loadComponent: () =>
      import('./features/client/client-layout/client-layout.component').then(
        (m) => m.ClientLayoutComponent
      ),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'inicio' },
            {
        path: 'inicio',
        loadComponent: () =>
          import('./features/client/home/home.component').then((m) => m.HomeComponent)
      },
            {
        path: 'pelicula/:id',
        loadComponent: () =>
          import('./features/client/pelicula/pelicula.component').then((m) => m.PeliculaComponent)
      },
      {
        path: 'funcion/:funcionId/butacas',
        canActivate: [edadFuncionGuard],
        loadComponent: () =>
          import('./features/client/butacas/butacas.component').then((m) => m.ButacasComponent)
      },
      {
        path: 'cartelera',
        loadComponent: () =>
          import('./features/client/cartelera/cartelera.component').then(
            (m) => m.CarteleraComponent
          )
      },
      {
        path: 'candy-bar',
        loadComponent: () =>
          import('./features/client/candy-bar/candy-bar.component').then((m) => m.CandyBarComponent)
      },
      {
        path: 'proximamente',
        loadComponent: () =>
          import('./features/client/proximamente/proximamente.component').then(
            (m) => m.ProximamenteComponent
          )
      },
      {
        path: 'mis-peliculas',
        canActivate: [sesionGuard],
        loadComponent: () =>
          import('./features/client/mis-peliculas/mis-peliculas.component').then(
            (m) => m.MisPeliculasComponent
          )
      },
      {
        path: 'proponer-pelicula',
        canActivate: [sesionGuard],
        loadComponent: () =>
          import('./features/client/proponer-pelicula/proponer-pelicula.component').then(
            (m) => m.ProponerPeliculaComponent
          )
      },
      {
        path: 'reubicacion/:compraId',
        canActivate: [sesionGuard],
        loadComponent: () =>
          import('./features/client/reubicacion/reubicacion.component').then((m) => m.ReubicacionComponent)
      },
      {
        path: 'perfil',
        canActivate: [sesionGuard],
        loadComponent: () =>
          import('./features/client/perfil/perfil.component').then((m) => m.PerfilComponent)
      }
    ]
  },
  { path: '**', redirectTo: 'inicio' }
];
