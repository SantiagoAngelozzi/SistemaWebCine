import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';

import { Notificacion } from '../models/notificacion.model';
import { SupabaseService } from './supabase.service';
import { ToastService } from './toast.service';

const LIMITE = 30;

@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private supabase = inject(SupabaseService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private zone = inject(NgZone);

  readonly notificaciones = signal<Notificacion[]>([]);
  readonly noLeidas = computed(() => this.notificaciones().filter((n) => !n.leida).length);
  readonly permisoNavegador = signal<NotificationPermission | 'no_soportado'>(
    typeof Notification === 'undefined' ? 'no_soportado' : Notification.permission
  );

  private canal: RealtimeChannel | null = null;
  private usuarioId: string | null = null;

  async iniciar(usuarioId: string): Promise<void> {
    if (this.usuarioId === usuarioId) return;
    this.detener();
    this.usuarioId = usuarioId;
    await this.cargar();
    this.suscribirse(usuarioId);
  }

  detener(): void {
    if (this.canal) {
      this.supabase.client.removeChannel(this.canal);
      this.canal = null;
    }
    this.usuarioId = null;
    this.notificaciones.set([]);
  }

  async cargar(): Promise<void> {
    if (!this.usuarioId) return;
    const { data, error } = await this.supabase.client
      .from('notificaciones')
      .select('id, tipo, titulo, mensaje, link, leida, created_at')
      .eq('usuario_id', this.usuarioId)
      .order('created_at', { ascending: false })
      .limit(LIMITE);

    if (error) {
      console.error(error);
      return;
    }
    this.notificaciones.set((data ?? []).map(mapear));
  }

  async marcarLeida(id: string): Promise<void> {
    this.notificaciones.update((lista) => lista.map((n) => (n.id === id ? { ...n, leida: true } : n)));
    const { error } = await this.supabase.client.rpc('marcar_notificaciones_leidas', { p_id: id });
    if (error) console.error(error);
  }

  async marcarTodasLeidas(): Promise<void> {
    this.notificaciones.update((lista) => lista.map((n) => ({ ...n, leida: true })));
    const { error } = await this.supabase.client.rpc('marcar_notificaciones_leidas', { p_id: null });
    if (error) console.error(error);
  }

  async pedirPermisoNavegador(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    const permiso = await Notification.requestPermission();
    this.permisoNavegador.set(permiso);
  }

  private suscribirse(usuarioId: string): void {
    this.canal = this.supabase.client
      .channel(`notificaciones-${usuarioId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notificaciones', filter: `usuario_id=eq.${usuarioId}` },
        (payload: { new: any }) => this.zone.run(() => this.alLlegar(mapear(payload.new)))
      )
      .subscribe();
  }

  private alLlegar(notificacion: Notificacion): void {
    if (this.notificaciones().some((n) => n.id === notificacion.id)) return;
    this.notificaciones.update((lista) => [notificacion, ...lista].slice(0, LIMITE));
    this.toast.mostrar(`${notificacion.titulo}: ${notificacion.mensaje}`, 'info', 8000);
    this.mostrarAvisoNavegador(notificacion);
  }

  private mostrarAvisoNavegador(notificacion: Notificacion): void {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const opciones: NotificationOptions = {
      body: notificacion.mensaje,
      icon: '/icons/icon-192.png',
      tag: notificacion.id
    };

    try {
      const aviso = new Notification(notificacion.titulo, opciones);
      aviso.onclick = () =>
        this.zone.run(() => {
          window.focus();
          this.abrir(notificacion);
          aviso.close();
        });
    } catch {
      navigator.serviceWorker
        ?.getRegistration()
        .then((registro) => registro?.showNotification(notificacion.titulo, opciones))
        .catch((err) => console.error(err));
    }
  }

  abrir(notificacion: Notificacion): void {
    if (!notificacion.leida) this.marcarLeida(notificacion.id);
    if (notificacion.link) this.router.navigateByUrl(notificacion.link);
  }
}

function mapear(fila: any): Notificacion {
  return {
    id: fila.id,
    tipo: fila.tipo,
    titulo: fila.titulo,
    mensaje: fila.mensaje,
    link: fila.link ?? null,
    leida: !!fila.leida,
    creadaEl: fila.created_at
  };
}
