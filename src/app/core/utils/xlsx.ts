/**
 * Generador mínimo de archivos Excel (.xlsx) sin dependencias.
 *
 * Un .xlsx es un ZIP con varios XML adentro (formato Office Open XML):
 *   [Content_Types].xml, _rels/.rels, xl/workbook.xml,
 *   xl/_rels/workbook.xml.rels, xl/styles.xml y xl/worksheets/sheetN.xml.
 * Acá se arman esos XML y se empaquetan en un ZIP "sin compresión"
 * (método store), que Excel, LibreOffice y Google Sheets abren sin problema.
 */

export type EstiloCelda =
  | 'titulo'
  | 'subtitulo'
  | 'encabezado'
  | 'moneda'
  | 'entero'
  | 'fecha'
  | 'total'
  | 'total-moneda'
  | 'total-entero';

export interface CeldaConEstilo {
  valor: string | number | Date | null;
  estilo?: EstiloCelda;
}

export type Celda = string | number | Date | null | CeldaConEstilo;

export interface HojaXlsx {
  nombre: string;
  filas: Celda[][];
  /** Ancho de cada columna en caracteres. */
  anchos?: number[];
}

// Índices de estilo (orden de <cellXfs> en styles.xml).
const ESTILOS: Record<EstiloCelda | 'normal', number> = {
  normal: 0,
  titulo: 1,
  subtitulo: 2,
  encabezado: 3,
  moneda: 4,
  entero: 5,
  fecha: 6,
  total: 7,
  'total-moneda': 8,
  'total-entero': 9
};

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2">' +
  '<numFmt numFmtId="164" formatCode="&quot;$&quot; #,##0.00"/>' +
  '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/>' +
  '</numFmts>' +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="16"/><name val="Calibri"/></font>' +
  '<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="3">' +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFF4D03F"/><bgColor indexed="64"/></patternFill></fill>' +
  '</fills>' +
  '<borders count="2">' +
  '<border><left/><right/><top/><bottom/><diagonal/></border>' +
  '<border><left/><right/><top style="thin"><color rgb="FF1B1A2E"/></top><bottom/><diagonal/></border>' +
  '</borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="10">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' + // 0 normal
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 1 título
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + // 2 subtítulo
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' + // 3 encabezado
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' + // 4 moneda
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' + // 5 entero
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' + // 6 fecha
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' + // 7 total
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 8
  '<xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // 9
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Arma el archivo .xlsx completo. */
export function crearXlsx(hojas: HojaXlsx[]): Blob {
  const archivos: { nombre: string; contenido: string }[] = [
    { nombre: '[Content_Types].xml', contenido: contentTypes(hojas.length) },
    {
      nombre: '_rels/.rels',
      contenido:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    { nombre: 'xl/workbook.xml', contenido: workbook(hojas) },
    { nombre: 'xl/_rels/workbook.xml.rels', contenido: workbookRels(hojas.length) },
    { nombre: 'xl/styles.xml', contenido: STYLES_XML },
    ...hojas.map((hoja, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXml(hoja) }))
  ];

  const encoder = new TextEncoder();
  const zip = crearZip(archivos.map((a) => ({ nombre: a.nombre, datos: encoder.encode(a.contenido) })));
  return new Blob([zip], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}

// ---------- XML del libro ----------

function contentTypes(cantidadHojas: number): string {
  let hojas = '';
  for (let i = 1; i <= cantidadHojas; i++) {
    hojas +=
      `<Override PartName="/xl/worksheets/sheet${i}.xml" ` +
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    hojas +
    '</Types>'
  );
}

function workbook(hojas: HojaXlsx[]): string {
  const sheets = hojas
    .map((hoja, i) => `<sheet name="${escaparXml(nombreHoja(hoja.nombre))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRels(cantidadHojas: number): string {
  let rels = '';
  for (let i = 1; i <= cantidadHojas; i++) {
    rels +=
      `<Relationship Id="rId${i}" ` +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
      `Target="worksheets/sheet${i}.xml"/>`;
  }
  rels +=
    `<Relationship Id="rId${cantidadHojas + 1}" ` +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    rels +
    '</Relationships>'
  );
}

function hojaXml(hoja: HojaXlsx): string {
  const cols = hoja.anchos?.length
    ? '<cols>' +
      hoja.anchos.map((ancho, i) => `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`).join('') +
      '</cols>'
    : '';

  const filas = hoja.filas
    .map((fila, i) => {
      const numeroFila = i + 1;
      const celdas = fila
        .map((celda, j) => celdaXml(celda, `${letraColumna(j)}${numeroFila}`))
        .join('');
      return `<row r="${numeroFila}">${celdas}</row>`;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    cols +
    `<sheetData>${filas}</sheetData></worksheet>`
  );
}

function celdaXml(celda: Celda, referencia: string): string {
  const { valor, estilo } = normalizarCelda(celda);
  const s = ESTILOS[estilo ?? (valor instanceof Date ? 'fecha' : 'normal')];
  const atributoEstilo = s ? ` s="${s}"` : '';

  if (valor === null || valor === '') {
    return s ? `<c r="${referencia}"${atributoEstilo}/>` : '';
  }
  if (valor instanceof Date) {
    return `<c r="${referencia}"${atributoEstilo}><v>${fechaSerialExcel(valor)}</v></c>`;
  }
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? `<c r="${referencia}"${atributoEstilo}><v>${valor}</v></c>` : '';
  }
  return (
    `<c r="${referencia}" t="inlineStr"${atributoEstilo}>` +
    `<is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`
  );
}

function normalizarCelda(celda: Celda): CeldaConEstilo {
  if (celda !== null && typeof celda === 'object' && !(celda instanceof Date)) return celda;
  return { valor: celda };
}

/** 0 -> A, 25 -> Z, 26 -> AA ... */
function letraColumna(indice: number): string {
  let letras = '';
  let n = indice + 1;
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

/** Excel guarda las fechas como días desde el 30/12/1899. */
function fechaSerialExcel(fecha: Date): number {
  const utc = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  return Math.round((utc - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Excel no acepta nombres de hoja de más de 31 caracteres ni con : \ / ? * [ ]. */
function nombreHoja(nombre: string): string {
  return nombre.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Hoja';
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

// ---------- ZIP (método "store", sin compresión) ----------

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < datos.length; i++) crc = TABLA_CRC[(crc ^ datos[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function crearZip(archivos: { nombre: string; datos: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const partesLocales: Uint8Array[] = [];
  const partesCentrales: Uint8Array[] = [];
  let desplazamiento = 0;

  // Fecha/hora fija en formato MS-DOS (1/1/2026 00:00): el contenido no depende de ella.
  const horaDos = 0;
  const fechaDos = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const archivo of archivos) {
    const nombre = encoder.encode(archivo.nombre);
    const crc = crc32(archivo.datos);
    const tamanio = archivo.datos.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // firma "PK\3\4"
    local.setUint16(4, 20, true); // versión necesaria
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // método: store
    local.setUint16(10, horaDos, true);
    local.setUint16(12, fechaDos, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, tamanio, true);
    local.setUint32(22, tamanio, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); // firma "PK\1\2"
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, horaDos, true);
    central.setUint16(14, fechaDos, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, tamanio, true);
    central.setUint32(24, tamanio, true);
    central.setUint16(28, nombre.length, true);
    central.setUint32(42, desplazamiento, true);

    partesLocales.push(new Uint8Array(local.buffer), nombre, archivo.datos);
    partesCentrales.push(new Uint8Array(central.buffer), nombre);
    desplazamiento += 30 + nombre.length + tamanio;
  }

  const tamanioCentral = partesCentrales.reduce((total, parte) => total + parte.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true); // firma "PK\5\6"
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamanioCentral, true);
  fin.setUint32(16, desplazamiento, true);

  const partes = [...partesLocales, ...partesCentrales, new Uint8Array(fin.buffer)];
  const total = partes.reduce((suma, parte) => suma + parte.length, 0);
  const resultado = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    resultado.set(parte, posicion);
    posicion += parte.length;
  }
  return resultado;
}
