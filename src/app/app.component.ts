import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AuthService } from './core/services/auth.service';
import { ConfirmModalComponent } from './shared/confirm-modal/confirm-modal.component';
import { ToastContainerComponent } from './shared/toast/toast-container.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ConfirmModalComponent, ToastContainerComponent],
  template: `
    <router-outlet />
    <app-confirm-modal />
    <app-toast-container />
  `
})
export class AppComponent {
  private auth = inject(AuthService);
}