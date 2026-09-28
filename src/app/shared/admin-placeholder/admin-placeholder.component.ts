import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-admin-placeholder',
  standalone: true,
  templateUrl: './admin-placeholder.component.html',
  styleUrl: './admin-placeholder.component.scss'
})
export class AdminPlaceholderComponent {
  @Input() title = 'Sección';
  @Input() description = 'Esta sección todavía no tiene funcionalidad.';
}
