import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  // Cliente unico de Supabase para toda la app. El resto de los servicios
  // (auth, peliculas, entradas, etc.) van a inyectar este servicio en vez
  // de crear su propio cliente.
  readonly client: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabaseKey
  );
}