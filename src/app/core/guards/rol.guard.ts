import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * Módulo de validación de QR: sólo empleados (y administradores, que
 * también pueden validar). Sin sesión -> login.
 */
export const empleadoGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const rol = await auth.obtenerRolActual();
  if (!rol) return router.createUrlTree(['/auth/login']);
  if (rol === 'empleado' || rol === 'administrador') return true;
  return router.createUrlTree(['/inicio']);
};

/**
 * Parte pública (cartelera, compra, etc.). El empleado tiene acceso
 * exclusivo al módulo de validación, así que se lo redirige ahí.
 */
export const sinEmpleadoGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const rol = await auth.obtenerRolActual();
  return rol === 'empleado' ? router.createUrlTree(['/empleado']) : true;
};
