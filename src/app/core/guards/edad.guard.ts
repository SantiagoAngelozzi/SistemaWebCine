import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';
import { SupabaseService } from '../services/supabase.service';
import { ToastService } from '../services/toast.service';

export const edadFuncionGuard: CanActivateFn = async (route) => {
  const supabase = inject(SupabaseService);
  const auth = inject(AuthService);
  const router = inject(Router);
  const toast = inject(ToastService);

  const funcionId = route.paramMap.get('funcionId');
  if (!funcionId) return router.createUrlTree(['/cartelera']);

  const {
    data: { session }
  } = await supabase.client.auth.getSession();
  if (!session) return true;

  const [{ data: funcion }, fechaNacimiento] = await Promise.all([
    supabase.client
      .from('funciones')
      .select('pelicula_id, peliculas(clasificacion)')
      .eq('id', funcionId)
      .maybeSingle(),
    auth.obtenerFechaNacimiento()
  ]);

  if (!funcion) return true;

  const clasificacion = (funcion as any).peliculas?.clasificacion as string | undefined;
  if (auth.cumpleClasificacion(clasificacion, fechaNacimiento)) return true;

  toast.error(`Esta película es ${clasificacion}: no cumplís la edad mínima para ver las funciones.`);
  return router.createUrlTree(['/pelicula', funcion.pelicula_id]);
};
