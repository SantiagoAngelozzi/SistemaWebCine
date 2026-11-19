import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SeccionAdmin } from '../models/rol.model';
import { PermisosService } from '../services/permisos.service';
import { ToastService } from '../services/toast.service';

export const permisoGuard: CanActivateFn = async (route) => {
  const permisos = inject(PermisosService);
  const router = inject(Router);
  const toast = inject(ToastService);

  const seccion = route.data['seccion'] as SeccionAdmin | undefined;
  await permisos.cargar();

  if (!seccion || permisos.puede(seccion)) return true;

  toast.error('Tu rol no tiene acceso a esa sección del panel.');
  return router.createUrlTree([permisos.primeraRutaPermitida() ?? '/inicio']);
};

export const inicioAdminGuard: CanActivateFn = async () => {
  const permisos = inject(PermisosService);
  const router = inject(Router);

  await permisos.cargar();
  return router.createUrlTree([permisos.primeraRutaPermitida() ?? '/inicio']);
};
