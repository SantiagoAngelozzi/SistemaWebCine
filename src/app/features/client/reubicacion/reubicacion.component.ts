import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { MiCompra } from '../../../core/models/cuenta.model';
import { FuncionDePelicula } from '../../../core/models/funcion.model';
import { EstadoEsperaFuncion } from '../../../core/models/lista-espera.model';
import { CuentaService } from '../../../core/services/cuenta.service';
import { FuncionesService } from '../../../core/services/funciones.service';
import { ListaEsperaService } from '../../../core/services/lista-espera.service';
import { formatearFecha } from '../../../core/utils/pelicula-fechas';

@Component({
  selector: 'app-reubicacion',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './reubicacion.component.html',
  styleUrl: './reubicacion.component.scss'
})
export class ReubicacionComponent implements OnInit {
  private cuentaService = inject(CuentaService);
  private funcionesService = inject(FuncionesService);
  private listaEsperaService = inject(ListaEsperaService);
  private router = inject(Router);

  @Input() compraId = '';

  readonly formatearFecha = formatearFecha;

  cargando = signal(true);
  errorMessage = signal<string | null>(null);
  compra = signal<MiCompra | null>(null);
  credito = signal(0);
  funciones = signal<FuncionDePelicula[]>([]);
  disponibilidad = signal<Map<string, EstadoEsperaFuncion>>(new Map());

  async ngOnInit(): Promise<void> {
    this.cargando.set(true);
    try {
      const [compra, credito] = await Promise.all([
        this.cuentaService.obtenerCompra(this.compraId),
        this.cuentaService.obtenerCredito()
      ]);

      if (!compra || !compra.canceladaPorCine || !compra.peliculaId) {
        this.errorMessage.set('No encontramos una compra cancelada por el cine para reubicar.');
        return;
      }

      this.compra.set(compra);
      this.credito.set(credito);

      const funciones = (await this.funcionesService.listarProximasDePelicula(compra.peliculaId)).filter(
        (f) => f.id !== compra.funcionId
      );
      this.funciones.set(funciones);
      this.disponibilidad.set(await this.listaEsperaService.estadoDeFunciones(funciones.map((f) => f.id)));
    } catch (err) {
      console.error(err);
      this.errorMessage.set('No se pudieron cargar las funciones para reubicarte.');
    } finally {
      this.cargando.set(false);
    }
  }

  agotada(funcion: FuncionDePelicula): boolean {
    return this.disponibilidad().get(funcion.id)?.agotada ?? false;
  }

  elegir(funcion: FuncionDePelicula): void {
    this.router.navigate(['/funcion', funcion.id, 'butacas'], { queryParams: { usarCredito: 1 } });
  }
}
