import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // withComponentInputBinding: permite que `data` de cada ruta (emoji,
    // title, description) llegue directo como @Input() al componente,
    // asi las 7 secciones del admin reutilizan AdminPlaceholderComponent
    // sin duplicar codigo.
    provideRouter(routes, withComponentInputBinding())
  ]
};
