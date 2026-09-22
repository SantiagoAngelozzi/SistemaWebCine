import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { SupabaseService } from '../../../core/services/supabase.service';

type AuthTab = 'login' | 'registro';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private fb = new FormBuilder();
  private auth = inject(AuthService);
  private supabase = inject(SupabaseService);
  private router = inject(Router);

  activeTab = signal<AuthTab>('login');
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  registroForm = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    apellido: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    fechaNacimiento: ['', Validators.required],
    tipoSangre: [''],
    colorOjos: [''],
    diasVacaciones: [null as number | null],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  switchTab(tab: AuthTab): void {
    this.activeTab.set(tab);
    this.errorMessage.set(null);
  }

  async submitLogin(): Promise<void> {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const { email, password } = this.loginForm.getRawValue();
      const { data, error } = await this.auth.signIn(email, password);

      if (error) {
        this.errorMessage.set(this.traducirError(error.message));
        return;
      }
      await this.redirigirSegunRol(data.user?.id);
    } catch (err) {
      console.error('Error inesperado en login:', err);
      this.errorMessage.set('Ocurrió un error inesperado. Revisá la consola (F12) para más detalle.');
    } finally {
      this.loading.set(false);
    }
  }

  async submitRegistro(): Promise<void> {
    if (this.registroForm.invalid) {
      this.registroForm.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const { email, password, ...datos } = this.registroForm.getRawValue();
      const { error } = await this.auth.signUp(email, password, datos);

      if (error) {
        this.errorMessage.set(this.traducirError(error.message));
        return;
      }
      this.router.navigateByUrl('/inicio');
    } catch (err) {
      console.error('Error inesperado en registro:', err);
      this.errorMessage.set('Ocurrió un error inesperado. Revisá la consola (F12) para más detalle.');
    } finally {
      this.loading.set(false);
    }
  }

  continuarComoInvitado(): void {
    this.router.navigateByUrl('/inicio');
  }

  private async redirigirSegunRol(userId: string | undefined): Promise<void> {
    if (!userId) {
      this.router.navigateByUrl('/inicio');
      return;
    }

    const { data: usuario } = await this.supabase.client
      .from('usuarios')
      .select('rol')
      .eq('id', userId)
      .single();

    this.router.navigateByUrl(usuario?.rol === 'administrador' ? '/admin' : '/inicio');
  }

  private traducirError(message: string): string {
    if (message.includes('Invalid login credentials')) {
      return 'Email o contraseña incorrectos.';
    }
    if (message.toLowerCase().includes('already registered')) {
      return 'Ese email ya está registrado.';
    }
    return message;
  }
}