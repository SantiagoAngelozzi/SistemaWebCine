import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import {
  RegistroValidacion,
  ResultadoValidacion,
  TipoValidacion
} from '../../../core/models/validacion.model';
import { AuthService } from '../../../core/services/auth.service';
import { ValidacionService, formatearCodigoCorto } from '../../../core/services/validacion.service';
import { formatearFecha } from '../../../core/utils/pelicula-fechas';
import { QrScannerComponent } from '../../../shared/qr-scanner/qr-scanner.component';

const MAX_HISTORIAL = 10;

@Component({
  selector: 'app-validar-qr',
  standalone: true,
  imports: [CommonModule, FormsModule, QrScannerComponent],
  templateUrl: './validar-qr.component.html',
  styleUrl: './validar-qr.component.scss'
})
export class ValidarQrComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private validacionService = inject(ValidacionService);

  @ViewChild('inputCodigo') inputCodigo?: ElementRef<HTMLInputElement>;

  modo = signal<TipoValidacion>('sala');
  camaraEncendida = signal(false);
  validando = signal(false);
  resultado = signal<ResultadoValidacion | null>(null);
  errorConexion = signal<string | null>(null);
  historial = signal<RegistroValidacion[]>([]);

  codigoManual = '';

  private codigoEnPantalla: string | null = null;

  readonly formatearCodigoCorto = formatearCodigoCorto;
  readonly formatearFecha = formatearFecha;

  esAdmin = signal(false);

  constructor() {
    this.auth.obtenerRolActual().then((rol) => this.esAdmin.set(rol === 'administrador'));
  }

  irAlPanel(): void {
    this.router.navigateByUrl('/admin');
  }

  get emailEmpleado(): string {
    return this.auth.session()?.user?.email ?? '';
  }

  cambiarModo(modo: TipoValidacion): void {
    if (this.modo() === modo) return;
    this.modo.set(modo);
    this.limpiarResultado();
  }

  alternarCamara(): void {
    this.camaraEncendida.update((encendida) => !encendida);
  }

  async alLeerQr(codigo: string): Promise<void> {
    if (this.validando() || codigo === this.codigoEnPantalla) return;
    await this.validar(codigo);
  }

  async validarManual(): Promise<void> {
    const codigo = this.codigoManual.trim();
    if (!codigo || this.validando()) return;
    await this.validar(codigo);
    this.codigoManual = '';
    this.inputCodigo?.nativeElement.focus();
  }

  limpiarResultado(): void {
    this.resultado.set(null);
    this.errorConexion.set(null);
    this.codigoEnPantalla = null;
  }

  private async validar(codigo: string): Promise<void> {
    const tipo = this.modo();
    this.validando.set(true);
    this.errorConexion.set(null);

    try {
      const resultado = await this.validacionService.validar(codigo, tipo);
      this.resultado.set(resultado);
      this.codigoEnPantalla = codigo;
      this.vibrar(resultado.ok);
      this.agregarAlHistorial({
        hora: new Date(),
        codigo: resultado.codigo_corto ? formatearCodigoCorto(resultado.codigo_corto) : this.resumirCodigo(codigo),
        tipo,
        ok: resultado.ok,
        mensaje: resultado.mensaje
      });
    } catch (err: any) {
      console.error(err);
      this.resultado.set(null);
      this.codigoEnPantalla = null;
      this.errorConexion.set(err?.message ?? 'No se pudo validar el código. Revisá la conexión.');
      this.vibrar(false);
    } finally {
      this.validando.set(false);
    }
  }

  private agregarAlHistorial(registro: RegistroValidacion): void {
    this.historial.update((lista) => [registro, ...lista].slice(0, MAX_HISTORIAL));
  }

  private resumirCodigo(codigo: string): string {
    return codigo.length > 12 ? `${codigo.slice(0, 8)}…` : codigo.toUpperCase();
  }

  private vibrar(ok: boolean): void {
    try {
      navigator.vibrate?.(ok ? 120 : [120, 80, 120]);
    } catch {
    }
  }

  async cerrarSesion(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/auth/login');
  }
}
