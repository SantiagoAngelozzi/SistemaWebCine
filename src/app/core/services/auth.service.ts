import { Injectable, inject, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';

import { SupabaseService } from './supabase.service';

export type RolUsuario = 'cliente' | 'empleado' | 'administrador';

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

  readonly session = signal<Session | null>(null);

  /** Rol por usuario, para no consultar la base en cada navegación. */
  private rolesCache = new Map<string, RolUsuario>();

  constructor() {
    this.supabase.client.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
    });

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      if (!session) this.rolesCache.clear();
    });
  }

  /**
   * Rol del usuario logueado, o null si no hay sesión (visitante anónimo).
   * Si no se puede leer el perfil se asume 'cliente', el rol sin permisos.
   */
  async obtenerRolActual(): Promise<RolUsuario | null> {
    const {
      data: { session }
    } = await this.supabase.client.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return null;

    const cacheado = this.rolesCache.get(userId);
    if (cacheado) return cacheado;

    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('rol')
      .eq('id', userId)
      .single();

    if (error || !data) return 'cliente';

    const rol = data.rol as RolUsuario;
    this.rolesCache.set(userId, rol);
    return rol;
  }

  /** Ruta de inicio según el rol: cada perfil tiene su propia pantalla. */
  rutaInicioSegunRol(rol: RolUsuario | null): string {
    if (rol === 'administrador') return '/admin';
    if (rol === 'empleado') return '/empleado';
    return '/inicio';
  }

  signIn(email: string, password: string) {
    return this.supabase.client.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string, datos: RegistroData) {
    return this.supabase.client.auth.signUp({
      email,
      password,
      options: { data: { ...datos } }
    });
  }

  tieneEdadMinima(fechaNacimiento: string | null | undefined, edadMinima: number): boolean {
    if (!fechaNacimiento) return false;

    const nacimiento = new Date(fechaNacimiento);
    if (Number.isNaN(nacimiento.getTime())) return false;

    const hoy = new Date();
    let edad = hoy.getFullYear() - nacimiento.getFullYear();
    const mes = hoy.getMonth() - nacimiento.getMonth();

    if (mes < 0 || (mes === 0 && hoy.getDate() < nacimiento.getDate())) {
      edad--;
    }

    return edad >= edadMinima;
  }

  esMayorDeEdad(fechaNacimiento: string | null | undefined): boolean {
    return this.tieneEdadMinima(fechaNacimiento, 18);
  }

  signOut() {
    this.rolesCache.clear();
    return this.supabase.client.auth.signOut();
  }
}
