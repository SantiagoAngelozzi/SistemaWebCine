import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';

import { ConfirmService } from '../../core/services/confirm.service';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-modal.component.html',
  styleUrl: './confirm-modal.component.scss'
})
export class ConfirmModalComponent {
  confirmService = inject(ConfirmService);
}
