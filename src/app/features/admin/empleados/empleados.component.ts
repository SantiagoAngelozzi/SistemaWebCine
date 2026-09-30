import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import { AuthService, RolUsuario } from '../../../core/services/auth.service';
import { ConfirmService } from '../../../core/services/confirm.service';
import { ToastService } from '../../../core/services/toast.service';
import { UsuarioResumen, UsuariosService } from '../../../core/services/usuarios.service';

type Filtro = 'todos' | RolUsuario;

/**
 * Alta y baja del rol empleado. El empleado primero se registra como
 * cualquier usuario y después el admin le asigna el rol desde acá.
 */
@Component({
  selector: 'app-admin-empleados',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './empleados.component.html',
  styleUrl: './empleados.component.scss'
})
export class EmpleadosComponent implements OnInit {
  private usuariosService = inject(UsuariosService);
  private auth = inject(AuthService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  cargando = signal(true);
  usuarios = signal<UsuarioResumen[]>([]);
  busqueda = signal('');
  filtro = signal<Filtro>('todos');
  guardandoId = signal<string | null>(null);

  cantidadEmpleados = computed(() => this.usuarios().filter((u) => u.rol === 'empleado').length);

  usuariosFiltrados = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    const filtro = this.filtro();
    return this.usuarios().filter((u) => {
      if (filtro !== 'todos' && u.rol !== filtro) return false;
      if (!texto) return true;
      const nombre = `${u.nombre ?? ''} ${u.apellido ?? ''}`.toLowerCase();
      return u.email.toLowerCase().includes(texto) || nombre.includes(texto);
    });
  });

  get miId(): string | undefined {
    return this.auth.session()?.user?.id;
  }

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.usuarios.set(await this.usuariosService.listar());
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudieron cargar los usuarios.');
    } finally {
      this.cargando.set(false);
    }
  }

  nombreCompleto(usuario: UsuarioResumen): string {
    const nombre = `${usuario.nombre ?? ''} ${usuario.apellido ?? ''}`.trim();
    return nombre || '—';
  }

  async hacerEmpleado(usuario: UsuarioResumen): Promise<void> {
    const confirmado = await this.confirmService.preguntar(
      `${usuario.email} pasará a ser empleado: sólo podrá usar la validación de QR y no podrá comprar desde su cuenta.`,
      { titulo: 'Asignar rol empleado', textoConfirmar: 'Asignar' }
    );
    if (confirmado) await this.cambiarRol(usuario, 'empleado');
  }

  async quitarEmpleado(usuario: UsuarioResumen): Promise<void> {
    const confirmado = await this.confirmService.preguntar(
      `${usuario.email} dejará de ser empleado y volverá a ser cliente.`,
      { titulo: 'Quitar rol empleado', textoConfirmar: 'Quitar' }
    );
    if (confirmado) await this.cambiarRol(usuario, 'cliente');
  }

  private async cambiarRol(usuario: UsuarioResumen, rol: RolUsuario): Promise<void> {
    this.guardandoId.set(usuario.id);
    try {
      await this.usuariosService.cambiarRol(usuario.id, rol);
      this.usuarios.update((lista) => lista.map((u) => (u.id === usuario.id ? { ...u, rol } : u)));
      this.toastService.exito(rol === 'empleado' ? 'Rol empleado asignado' : 'Rol empleado quitado');
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo cambiar el rol.');
    } finally {
      this.guardandoId.set(null);
    }
  }
}
