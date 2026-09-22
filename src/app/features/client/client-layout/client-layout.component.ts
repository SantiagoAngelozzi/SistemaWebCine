import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface ClientNavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-client-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './client-layout.component.html',
  styleUrl: './client-layout.component.scss'
})
export class ClientLayoutComponent {
  navItems: ClientNavItem[] = [
    { path: 'inicio', label: 'Inicio' },
    { path: 'cartelera', label: 'Cartelera' },
    { path: 'proximamente', label: 'Próximamente' },
    { path: 'mis-peliculas', label: 'Mis Películas' },
    { path: 'perfil', label: 'Perfil' }
  ];
}