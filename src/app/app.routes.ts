import { Routes } from '@angular/router';

import { AdminPlaceholderComponent } from './shared/admin-placeholder/admin-placeholder.component';

import { adminGuard } from './core/guards/admin.guard';

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
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
            {
        path: 'peliculas',
        loadComponent: () =>
          import('./features/admin/peliculas/peliculas.component').then(
            (m) => m.PeliculasComponent
          )
      },
      {
        path: 'peliculas',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Películas',
          description: 'Alta, edición y baja de películas: géneros, formatos, idioma y clasificación por edad.'
        }
      },
            {
        path: 'salas-funciones',
        loadComponent: () =>
          import('./features/admin/salas-funciones/salas-funciones.component').then(
            (m) => m.SalasFuncionesComponent
          )
      },
      {
        path: 'candy-bar',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Candy Bar',
          description: 'Catálogo de productos por categoría y armado de combos especiales a precio fijo.'
        }
      },
      {
        path: 'cupones-puntos',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Cupones y Puntos',
          description: 'Configuración de cupones (bienvenida, segmentados por edad) y del programa de puntos de fidelización.'
        }
      },
      {
        path: 'reportes',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Reportes',
          description: 'Exportación de facturación a PDF y Excel, con gráficos semanales y mensuales.'
        }
      },
      {
        path: 'auditoria',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Auditoría',
          description: 'Registro cronológico e inmutable de acciones del panel: quién, qué y cuándo.'
        }
      }
    ]
  },
  {
    path: '',
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
        loadComponent: () =>
          import('./features/client/butacas/butacas.component').then((m) => m.ButacasComponent)
      },
      {
        path: 'cartelera',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Cartelera',
          description: 'Listado completo de películas con buscador y filtro dinámico por género (multi-género por película).'
        }
      },
      {
        path: 'proximamente',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Próximamente',
          description: 'Estrenos de las próximas semanas, con opción de activar alerta para cuando abra la venta.'
        }
      },
      {
        path: 'mis-peliculas',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Mis Películas',
          description: 'Historial visual de funciones vistas: póster, fecha y calificación personal otorgada.'
        }
      },
      {
        path: 'perfil',
        component: AdminPlaceholderComponent,
        data: {
          title: 'Perfil',
          description: 'Datos de la cuenta, cupones disponibles, puntos de fidelización y crédito por cancelaciones.'
        }
      }
    ]
  },
  { path: '**', redirectTo: 'inicio' }
];