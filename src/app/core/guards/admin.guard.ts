import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SupabaseService } from '../services/supabase.service';

export const adminGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  const {
    data: { session }
  } = await supabase.client.auth.getSession();

  if (!session) {
    return router.createUrlTree(['/auth/login']);
  }

  const { data: usuario, error } = await supabase.client
    .from('usuarios')
    .select('rol')
    .eq('id', session.user.id)
    .single();

  if (error || !usuario || usuario.rol !== 'administrador') {
    return router.createUrlTree(['/inicio']);
  }

  return true;
};
