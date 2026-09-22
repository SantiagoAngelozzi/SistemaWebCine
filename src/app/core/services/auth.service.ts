import { Injectable, inject, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';

import { SupabaseService } from './supabase.service';

export interface RegistroData {
  nombre: string;
  apellido: string;
  fechaNacimiento: string;
  tipoSangre: string;
  colorOjos: string;
  diasVacaciones: number | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private supabase = inject(SupabaseService);

  // Signal con la sesion actual, disponible para toda la app (ej. el futuro
  // adminGuard va a leer esto para chequear el rol).
  readonly session = signal<Session | null>(null);

  constructor() {
    this.supabase.client.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
    });

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
    });
  }

  signIn(email: string, password: string) {
    return this.supabase.client.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string, datos: RegistroData) {
    // Los datos extra (nombre, apellido, etc.) viajan en options.data como
    // siempre. Del lado de la base de datos, un trigger en auth.users los
    // toma de ahi y arma automaticamente la fila en public.usuarios (ver
    // supabase/schema.sql). No hace falta ningun insert manual aca.
    return this.supabase.client.auth.signUp({
      email,
      password,
      options: { data: { ...datos } }
    });
  }

  signOut() {
    return this.supabase.client.auth.signOut();
  }
}