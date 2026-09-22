import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<router-outlet />`
})
export class AppComponent {
  // Se inyecta aca (aunque no se use directamente en el template) para que
  // el constructor de AuthService corra apenas arranca la app y la sesion
  // este disponible en toda la app desde el primer render.
  private auth = inject(AuthService);
}