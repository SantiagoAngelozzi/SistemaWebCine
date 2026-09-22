import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { SupabaseService } from '../services/supabase.service';

/**
 * Guard de rol admin — ACTIVO.
 *
 * Se resuelve en cada intento de entrar a /admin: primero confirma que
 * haya sesion, y despues consulta el rol real en la tabla public.usuarios
 * (no confia en nada que venga del cliente). Si no cumple, redirige en
 * vez de solo devolver false, para no dejar al usuario en una pantalla
 * en blanco.
 */
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