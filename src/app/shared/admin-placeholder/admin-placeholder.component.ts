import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-admin-placeholder',
  standalone: true,
  templateUrl: './admin-placeholder.component.html',
  styleUrl: './admin-placeholder.component.scss'
})
export class AdminPlaceholderComponent {
  // Se completan via route data + withComponentInputBinding() en app.config.ts,
  // asi cada seccion del admin reutiliza este mismo componente sin duplicar codigo.
  @Input() title = 'Sección';
  @Input() description = 'Esta sección todavía no tiene funcionalidad.';
}
