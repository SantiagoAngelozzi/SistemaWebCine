import { RegistroAuditoria } from '../services/auditoria.service';
import { formatearCodigoCorto } from '../services/validacion.service';

/**
 * Convierte un registro técnico de log_auditoria (accion + entidad + JSON)
 * en textos que entiende cualquiera: "Modificó la función …", "Cambio de precio".
 */

export const NOMBRE_ENTIDAD: Record<string, string> = {
  peliculas: 'Película',
  funciones: 'Función',
  salas: 'Sala',
  candy_productos: 'Producto',
  candy_categorias: 'Categoría',
  combos: 'Combo',
  cupones: 'Cupón',
  recompensas_puntos: 'Recompensa',
  compras: 'Compra',
  usuarios: 'Usuario'
};

const VERBO: Record<string, string> = {
  INSERT: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
  QR_VALIDADO_SALA: 'Validó el ingreso a sala',
  QR_ENTREGA_CANDY: 'Entregó el Candy Bar',
  QR_RECHAZADO: 'QR rechazado',
  COMPRA_CANCELADA: 'Canceló una compra',
  CAMBIO_ROL: 'Cambió el rol de un usuario'
};

const ICONO: Record<string, string> = {
  INSERT: '➕',
  UPDATE: '✏️',
  DELETE: '🗑️',
  QR_VALIDADO_SALA: '🎟️',
  QR_ENTREGA_CANDY: '🍿',
  QR_RECHAZADO: '⛔',
  COMPRA_CANCELADA: '↩️',
  CAMBIO_ROL: '🛡️'
};

const NOMBRE_CAMPO: Record<string, string> = {
  precio: 'Precio',
  precio_normal: 'Precio normal',
  precio_preventa: 'Precio de preventa',
  porcentaje_descuento: 'Descuento (%)',
  costo_puntos: 'Costo en puntos',
  hora_inicio: 'Hora de inicio',
  hora_fin: 'Hora de fin',
  fecha_estreno: 'Fecha de estreno',
  dias_preventa: 'Días de preventa',
  duracion_minutos: 'Duración (min)',
  imagen_url: 'Imagen',
  usos_maximos: 'Usos máximos',
  edad_minima: 'Edad mínima',
  edad_maxima: 'Edad máxima',
  fecha_desde: 'Válido desde',
  fecha_hasta: 'Válido hasta',
  incluye_entrada: 'Incluye entrada',
  otorga_entrada: 'Otorga entrada',
  candy_producto_id: 'Producto',
  categoria_id: 'Categoría',
  pelicula_id: 'Película',
  sala_id: 'Sala'
};

const MOTIVO_QR: Record<string, string> = {
  no_existe: 'el código no existe',
  cancelada: 'la compra estaba cancelada',
  sin_funcion: 'la compra no tiene entradas',
  ya_utilizado: 'ya se había usado',
  sin_candy: 'la compra no tiene Candy Bar',
  vencida: 'la función ya pasó',
  otra_fecha: 'la función es otro día'
};

/** Campos internos que no aportan al leer un cambio. */
const CAMPOS_OCULTOS = new Set(['id', 'created_at', 'updated_at', 'created_by']);

const CAMPOS_PRECIO = new Set(['precio', 'precio_normal', 'precio_preventa', 'porcentaje_descuento', 'costo_puntos']);

export interface CambioCampo {
  campo: string;
  antes: string;
  despues: string;
}

export interface DescripcionRegistro {
  icono: string;
  titulo: string;
  /** Nombre del objeto afectado ("Dune — Sala 1, 2026-10-02 18:00"). */
  objeto: string | null;
  /** Línea extra (motivo del rechazo, rol nuevo, etc.). */
  extra: string | null;
  cambios: CambioCampo[];
  esCambioDePrecio: boolean;
}

export function describirRegistro(registro: RegistroAuditoria): DescripcionRegistro {
  const detalle = registro.detalle ?? {};
  // Registros viejos (antes de la migración 20261003) guardaban la fila entera sin "registro".
  const fila: Record<string, any> = detalle['registro'] ?? detalle;
  const entidad = NOMBRE_ENTIDAD[registro.entidad ?? ''] ?? registro.entidad ?? '';
  const esCrud = ['INSERT', 'UPDATE', 'DELETE'].includes(registro.accion);

  const titulo = esCrud
    ? `${VERBO[registro.accion]} ${articulo(registro.entidad)} ${entidad.toLowerCase()}`
    : VERBO[registro.accion] ?? registro.accion;

  let objeto: string | null = detalle['etiqueta'] ?? fila['nombre'] ?? fila['codigo'] ?? null;
  if (!objeto && registro.entidad === 'funciones' && fila['fecha']) {
    objeto = `Función del ${fila['fecha']} ${String(fila['hora_inicio'] ?? '').slice(0, 5)}`.trim();
  }
  let extra: string | null = null;

  switch (registro.accion) {
    case 'QR_VALIDADO_SALA':
    case 'QR_ENTREGA_CANDY':
      objeto = detalle['codigo_corto'] ? `Compra ${formatearCodigoCorto(detalle['codigo_corto'])}` : 'Compra';
      extra =
        registro.accion === 'QR_VALIDADO_SALA'
          ? `${detalle['entradas'] ?? 0} entrada(s)`
          : `${detalle['items_candy'] ?? 0} producto(s)`;
      break;
    case 'QR_RECHAZADO':
      objeto = detalle['codigo_corto']
        ? `Compra ${formatearCodigoCorto(detalle['codigo_corto'])}`
        : detalle['codigo']
          ? `Código "${detalle['codigo']}"`
          : null;
      extra = `${detalle['tipo'] === 'candy' ? 'Candy Bar' : 'Sala'}: ${MOTIVO_QR[detalle['motivo']] ?? detalle['motivo'] ?? ''}`;
      break;
    case 'COMPRA_CANCELADA':
      objeto = detalle['codigo_corto'] ? `Compra ${formatearCodigoCorto(detalle['codigo_corto'])}` : 'Compra';
      extra = detalle['credito_otorgado'] != null ? `Crédito otorgado: $${detalle['credito_otorgado']}` : null;
      break;
    case 'CAMBIO_ROL':
      objeto = null;
      extra = `${detalle['rol_anterior'] ?? '?'} → ${detalle['rol_nuevo'] ?? '?'}`;
      break;
  }

  const cambiosCrudos: Record<string, { antes: unknown; despues: unknown }> = detalle['cambios'] ?? {};
  const cambios = Object.entries(cambiosCrudos)
    .filter(([campo]) => !CAMPOS_OCULTOS.has(campo))
    .map(([campo, valor]) => ({
      campo: nombreCampo(campo),
      antes: valorLegible(campo, valor?.antes),
      despues: valorLegible(campo, valor?.despues)
    }));

  return {
    icono: ICONO[registro.accion] ?? '•',
    titulo,
    objeto,
    extra,
    cambios,
    esCambioDePrecio: Object.keys(cambiosCrudos).some((campo) => CAMPOS_PRECIO.has(campo))
  };
}

/** Campos de la fila completa (para altas y bajas), en formato legible. */
export function camposRegistro(registro: RegistroAuditoria): CambioCampo[] {
  const detalle = registro.detalle ?? {};
  const fila: Record<string, any> = detalle['registro'] ?? detalle;
  if (!['INSERT', 'DELETE'].includes(registro.accion)) return [];
  return Object.entries(fila)
    .filter(([campo, valor]) => !CAMPOS_OCULTOS.has(campo) && valor !== null && typeof valor !== 'object')
    .map(([campo, valor]) => ({ campo: nombreCampo(campo), antes: '', despues: valorLegible(campo, valor) }));
}

function articulo(entidad: string | null): string {
  return ['peliculas', 'funciones', 'salas', 'candy_categorias', 'compras', 'recompensas_puntos'].includes(entidad ?? '')
    ? 'una'
    : 'un';
}

function nombreCampo(campo: string): string {
  if (NOMBRE_CAMPO[campo]) return NOMBRE_CAMPO[campo];
  const texto = campo.replace(/_/g, ' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function valorLegible(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if (campo.startsWith('precio')) return `$${valor}`;
  if (campo === 'porcentaje_descuento') return `${valor}%`;
  if (campo.startsWith('hora')) return String(valor).slice(0, 5);
  if (typeof valor === 'object') return Array.isArray(valor) ? valor.join(', ') : JSON.stringify(valor);
  return String(valor);
}
