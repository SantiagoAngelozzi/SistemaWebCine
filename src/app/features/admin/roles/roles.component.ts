import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  RolPersonalizado,
  SECCIONES_ASIGNABLES,
  SeccionAsignable,
  etiquetaSeccion
} from '../../../core/models/rol.model';
import { ConfirmService } from '../../../core/services/confirm.service';
import { RolesService } from '../../../core/services/roles.service';
import { ToastService } from '../../../core/services/toast.service';
import { UsuarioResumen, UsuariosService } from '../../../core/services/usuarios.service';
import { alMenosUnoMarcado } from '../../../core/utils/validadores';
import { FormErrorComponent } from '../../../shared/form-error/form-error.component';

type GrupoPermisos = Record<SeccionAsignable, FormControl<boolean>>;

function crearGrupoPermisos(): FormGroup<GrupoPermisos> {
  const controles = {} as GrupoPermisos;
  for (const seccion of SECCIONES_ASIGNABLES) {
    controles[seccion] = new FormControl(false, { nonNullable: true });
  }
  return new FormGroup(controles, { validators: alMenosUnoMarcado() });
}

@Component({
  selector: 'app-admin-roles',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormErrorComponent],
  templateUrl: './roles.component.html',
  styleUrl: './roles.component.scss'
})
export class RolesComponent implements OnInit {
  private fb = inject(FormBuilder);
  private rolesService = inject(RolesService);
  private usuariosService = inject(UsuariosService);
  private confirmService = inject(ConfirmService);
  private toastService = inject(ToastService);

  readonly secciones = SECCIONES_ASIGNABLES;
  readonly etiquetaSeccion = etiquetaSeccion;

  cargando = signal(true);
  guardando = signal(false);
  roles = signal<RolPersonalizado[]>([]);
  usuarios = signal<UsuarioResumen[]>([]);
  editandoId = signal<string | null>(null);
  mostrandoForm = signal(false);
  busqueda = signal('');
  asignandoId = signal<string | null>(null);

  clientes = computed(() => {
    const texto = this.busqueda().trim().toLowerCase();
    return this.usuarios()
      .filter((u) => u.rol === 'cliente')
      .filter((u) => {
        if (!texto) return true;
        const nombre = `${u.nombre ?? ''} ${u.apellido ?? ''}`.toLowerCase();
        return u.email.toLowerCase().includes(texto) || nombre.includes(texto);
      })
      .sort((a, b) => Number(!!b.rol_personalizado_id) - Number(!!a.rol_personalizado_id));
  });

  form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    descripcion: ['', Validators.maxLength(200)],
    permisos: crearGrupoPermisos()
  });

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const [roles, usuarios] = await Promise.all([this.rolesService.listar(), this.usuariosService.listar()]);
      this.roles.set(roles);
      this.usuarios.set(usuarios);
    } catch (err) {
      console.error(err);
      this.toastService.error('No se pudieron cargar los roles.');
    } finally {
      this.cargando.set(false);
    }
  }

  abrirNuevo(): void {
    this.editandoId.set(null);
    this.form.reset();
    this.mostrandoForm.set(true);
  }

  abrirEdicion(rol: RolPersonalizado): void {
    this.editandoId.set(rol.id);
    this.form.reset();
    this.form.patchValue({ nombre: rol.nombre, descripcion: rol.descripcion ?? '' });
    for (const seccion of rol.secciones) {
      this.form.controls.permisos.controls[seccion].setValue(true);
    }
    this.mostrandoForm.set(true);
  }

  cancelar(): void {
    this.mostrandoForm.set(false);
  }

  async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toastService.error('Revisá los campos marcados en rojo.');
      return;
    }

    const { nombre, descripcion, permisos } = this.form.getRawValue();
    const secciones = this.secciones.filter((s) => permisos[s]);

    this.guardando.set(true);
    try {
      await this.rolesService.guardar(this.editandoId(), { nombre, descripcion, secciones });
      this.toastService.exito(this.editandoId() ? 'Rol actualizado' : 'Rol creado');
      this.mostrandoForm.set(false);
      await this.cargar();
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo guardar el rol.');
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminar(rol: RolPersonalizado): Promise<void> {
    const aviso = rol.cantidadUsuarios
      ? ` Los ${rol.cantidadUsuarios} usuario(s) que lo tienen pierden el acceso al panel.`
      : '';
    const confirmado = await this.confirmService.preguntar(`¿Eliminar el rol "${rol.nombre}"?${aviso}`, {
      titulo: 'Eliminar rol',
      textoConfirmar: 'Eliminar'
    });
    if (!confirmado) return;

    try {
      await this.rolesService.eliminar(rol.id);
      this.toastService.exito('Rol eliminado');
      await this.cargar();
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo eliminar el rol.');
    }
  }

  nombreRol(rolId: string | null): string {
    return this.roles().find((r) => r.id === rolId)?.nombre ?? 'Sin rol';
  }

  nombreCompleto(usuario: UsuarioResumen): string {
    return `${usuario.nombre ?? ''} ${usuario.apellido ?? ''}`.trim() || '—';
  }

  async asignar(usuario: UsuarioResumen, rolId: string): Promise<void> {
    const nuevo = rolId || null;
    if (nuevo === usuario.rol_personalizado_id) return;

    this.asignandoId.set(usuario.id);
    try {
      await this.rolesService.asignar(usuario.id, nuevo);
      this.usuarios.update((lista) =>
        lista.map((u) => (u.id === usuario.id ? { ...u, rol_personalizado_id: nuevo } : u))
      );
      this.roles.update((lista) =>
        lista.map((r) => ({
          ...r,
          cantidadUsuarios:
            r.cantidadUsuarios + (r.id === nuevo ? 1 : 0) - (r.id === usuario.rol_personalizado_id ? 1 : 0)
        }))
      );
      this.toastService.exito(nuevo ? `${usuario.email} ahora tiene el rol ${this.nombreRol(nuevo)}` : 'Rol quitado');
    } catch (err: any) {
      console.error(err);
      this.toastService.error(err?.message ?? 'No se pudo asignar el rol.');
    } finally {
      this.asignandoId.set(null);
    }
  }
}
