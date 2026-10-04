import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const empleadoGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const rol = await auth.obtenerRolActual();
  if (!rol) return router.createUrlTree(['/auth/login']);
  if (rol === 'empleado' || rol === 'administrador') return true;
  return router.createUrlTree(['/inicio']);
};

export const sinEmpleadoGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const rol = await auth.obtenerRolActual();
  return rol === 'empleado' ? router.createUrlTree(['/empleado']) : true;
};

export const sesionGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const rol = await auth.obtenerRolActual();
  return rol ? true : router.createUrlTree(['/auth/login']);
};
