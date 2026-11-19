import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { PermisosService } from '../services/permisos.service';
import { SupabaseService } from '../services/supabase.service';

export const adminGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const permisos = inject(PermisosService);
  const router = inject(Router);

  const {
    data: { session }
  } = await supabase.client.auth.getSession();

  if (!session) {
    return router.createUrlTree(['/auth/login']);
  }

  const misPermisos = await permisos.cargar();
  if (misPermisos.esAdmin || misPermisos.secciones.length > 0) {
    return true;
  }

  return router.createUrlTree(['/inicio']);
};
