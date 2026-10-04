import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal
} from '@angular/core';

type EstadoCamara = 'iniciando' | 'activa' | 'error';

type LectorQr = (video: HTMLVideoElement) => Promise<string | null>;

const INTERVALO_MS = 200;
const ESPERA_MISMO_CODIGO_MS = 3000;

@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  templateUrl: './qr-scanner.component.html',
  styleUrl: './qr-scanner.component.scss'
})
export class QrScannerComponent implements AfterViewInit, OnDestroy {
  private zone = inject(NgZone);

  @Input() pausado = false;
  @Output() codigoLeido = new EventEmitter<string>();

  @ViewChild('video', { static: true }) videoRef!: ElementRef<HTMLVideoElement>;

  estado = signal<EstadoCamara>('iniciando');
  error = signal<string | null>(null);

  private stream: MediaStream | null = null;
  private lector: LectorQr | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destruido = false;
  private ultimoCodigo = '';
  private ultimoCodigoAt = 0;
  private canvas: HTMLCanvasElement | null = null;

  async ngAfterViewInit(): Promise<void> {
    await this.iniciar();
  }

  ngOnDestroy(): void {
    this.destruido = true;
    if (this.timer) clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private async iniciar(): Promise<void> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.fallar('La cámara sólo funciona con HTTPS. Usá la carga manual del código.');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      if (this.destruido) {
        this.stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = this.videoRef.nativeElement;
      video.srcObject = this.stream;
      await video.play();

      this.lector = await this.crearLector();
      this.estado.set('activa');
      this.zone.runOutsideAngular(() => this.programarLectura());
    } catch (err: any) {
      console.error(err);
      if (err?.name === 'NotAllowedError') {
        this.fallar('No se dio permiso para usar la cámara. Habilitalo en el navegador o usá la carga manual.');
      } else if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') {
        this.fallar('No se encontró una cámara en este dispositivo. Usá la carga manual.');
      } else if (err?.name === 'NotReadableError') {
        this.fallar('La cámara está siendo usada por otra aplicación.');
      } else {
        this.fallar('No se pudo iniciar la cámara. Usá la carga manual.');
      }
    }
  }

  private async crearLector(): Promise<LectorQr> {
    const Detector = (window as any).BarcodeDetector;
    if (Detector) {
      try {
        const formatos: string[] = await Detector.getSupportedFormats();
        if (formatos.includes('qr_code')) {
          const detector = new Detector({ formats: ['qr_code'] });
          return async (video) => {
            const codigos = await detector.detect(video);
            return codigos[0]?.rawValue ?? null;
          };
        }
      } catch {
      }
    }

    const modulo: any = await import('jsqr');
    const jsQR: typeof import('jsqr').default =
      typeof modulo.default === 'function' ? modulo.default : (modulo.default?.default ?? modulo);
    this.canvas = document.createElement('canvas');
    const contexto = this.canvas.getContext('2d', { willReadFrequently: true });

    return async (video) => {
      if (!contexto || !this.canvas || !video.videoWidth) return null;
      const escala = Math.min(1, 640 / video.videoWidth);
      const ancho = Math.round(video.videoWidth * escala);
      const alto = Math.round(video.videoHeight * escala);
      this.canvas.width = ancho;
      this.canvas.height = alto;
      contexto.drawImage(video, 0, 0, ancho, alto);
      const imagen = contexto.getImageData(0, 0, ancho, alto);
      return jsQR(imagen.data, ancho, alto, { inversionAttempts: 'dontInvert' })?.data ?? null;
    };
  }

  private programarLectura(): void {
    if (this.destruido) return;
    this.timer = setTimeout(() => this.leer(), INTERVALO_MS);
  }

  private async leer(): Promise<void> {
    const video = this.videoRef.nativeElement;
    try {
      if (!this.pausado && this.lector && video.readyState >= video.HAVE_CURRENT_DATA) {
        const codigo = (await this.lector(video))?.trim();
        if (codigo && this.esLecturaNueva(codigo)) {
          this.zone.run(() => this.codigoLeido.emit(codigo));
        }
      }
    } catch (err) {
      console.error('Error leyendo QR:', err);
    }
    this.programarLectura();
  }

  private esLecturaNueva(codigo: string): boolean {
    const ahora = Date.now();
    if (codigo === this.ultimoCodigo && ahora - this.ultimoCodigoAt < ESPERA_MISMO_CODIGO_MS) {
      return false;
    }
    this.ultimoCodigo = codigo;
    this.ultimoCodigoAt = ahora;
    return true;
  }

  private fallar(mensaje: string): void {
    this.estado.set('error');
    this.error.set(mensaje);
  }
}
