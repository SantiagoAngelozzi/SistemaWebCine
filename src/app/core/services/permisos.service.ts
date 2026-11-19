import { Injectable, computed, inject, signal } from '@angular/core';

import { MisPermisos, SECCIONES_ADMIN, SeccionAdmin } from '../models/rol.model';
import { SupabaseService } from './supabase.service';

const SIN_PERMISOS: MisPermisos = { esAdmin: false, rol: null, secciones: [] };

@Injectable({ providedIn: 'root' })
export class PermisosService {
  private supabase = inject(SupabaseService);

  readonly permisos = signal<MisPermisos>(SIN_PERMISOS);
  readonly esStaff = computed(() => this.permisos().esAdmin || this.permisos().secciones.length > 0);

  private usuarioCargado: string | null = null;
  private pedido: Promise<MisPermisos> | null = null;

  constructor() {
    this.supabase.client.auth.onAuthStateChange((_evento: string, session: any) => {
      if (session?.user?.id !== this.usuarioCargado) this.olvidar();
    });
  }

  async cargar(): Promise<MisPermisos> {
    const {
      data: { session }
    } = await this.supabase.client.auth.getSession();
    const usuarioId: string | null = session?.user?.id ?? null;

    if (!usuarioId) {
      this.olvidar();
      return SIN_PERMISOS;
    }
    if (this.usuarioCargado === usuarioId) return this.permisos();
    if (this.pedido) return this.pedido;

    this.pedido = this.pedirAlServidor(usuarioId);
    try {
      return await this.pedido;
    } finally {
      this.pedido = null;
    }
  }

  puede(seccion: SeccionAdmin): boolean {
    return this.permisos().esAdmin || this.permisos().secciones.includes(seccion);
  }

  primeraRutaPermitida(): string | null {
    const primera = SECCIONES_ADMIN.find((s) => this.puede(s.seccion));
    return primera ? `/admin/${primera.ruta}` : null;
  }

  olvidar(): void {
    this.usuarioCargado = null;
    this.permisos.set(SIN_PERMISOS);
  }

  private async pedirAlServidor(usuarioId: string): Promise<MisPermisos> {
    const { data, error } = await this.supabase.client.rpc('mis_permisos');
    if (error) {
      console.error(error);
      return SIN_PERMISOS;
    }
    const permisos: MisPermisos = {
      esAdmin: !!data?.es_admin,
      rol: data?.rol ?? null,
      secciones: (data?.secciones ?? []) as SeccionAdmin[]
    };
    this.usuarioCargado = usuarioId;
    this.permisos.set(permisos);
    return permisos;
  }
}
