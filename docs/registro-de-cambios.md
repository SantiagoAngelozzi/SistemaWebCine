# Registro de cambios

## 2026-09-29 — Módulo de empleados: validación de QR

### Qué pide el enunciado

- Usuarios para los empleados que escanean los QR para validar las entradas, tanto para el cine como para el Candy Bar.
- Carga manual del código si el lector no funciona.
- El QR deja de funcionar una vez que se valida la entrada o se entrega la comida.
- El empleado tiene acceso **exclusivo** al módulo de escaneo.
- Auditoría: quién validó cada QR, con fecha y hora.

### Decisión de diseño: un QR, dos usos

Cada compra tiene **un solo QR**, pero con dos usos que se consumen por separado:

| Uso | Dónde se escanea | Qué pasa |
|---|---|---|
| Acceso a sala | Puerta de la sala (modo "Sala") | Se marca `entrada_validada_at`. Si se vuelve a escanear en la sala, se rechaza por ya utilizado. |
| Retiro en Candy Bar | Mostrador (modo "Candy Bar") | Se marca `candy_entregado_at`. Si se vuelve a escanear en el Candy Bar, se rechaza por ya utilizado. |

Con un único flag, el cliente que entra primero a la sala ya no podría retirar el combo que pagó. Así, cada uso queda inhabilitado inmediatamente después de validarse, sin que uno bloquee al otro.

### Base de datos — `supabase/migrations/20260930_empleado_validacion_qr.sql`

- **Columnas nuevas en `compras`:** `codigo_corto`, `entrada_validada_at`, `entrada_validada_por`, `candy_entregado_at`, `candy_entregado_por`.
- **Código corto para carga manual:**
  - 8 caracteres de un alfabeto sin caracteres ambiguos (sin 0/O ni 1/I/L), por ejemplo `K7F3-9QXM`.
  - Se genera con un trigger al insertar cada compra; a las compras existentes también se les genera.
  - Es único (índice unique).
- **`qr_vigente`** se mantiene por compatibilidad: pasa a `false` cuando se consumieron todos los usos que tiene la compra.
- **`crear_compra_entradas`** ahora también devuelve `codigo_corto`, para imprimirlo en el PDF.
- **`validar_qr(p_codigo, p_tipo)`** (`p_tipo` = `'sala'` o `'candy'`):
  - Sólo la pueden usar empleados o administradores (`es_empleado_o_admin()`).
  - Acepta el contenido del QR (UUID) o el código corto, con o sin guion, en mayúsculas o minúsculas.
  - Bloquea la fila de la compra (`for update`): dos lectores que escanean el mismo QR a la vez no pueden validarlo dos veces.
  - **Rechaza cuando:**
    - el código no existe;
    - la compra está cancelada;
    - ese uso ya se consumió (informa fecha y hora);
    - es Candy Bar y la compra no tiene productos;
    - la función no es hoy;
    - es sala y la función ya terminó.
  - Las fechas se calculan en hora de Argentina, porque Supabase corre en UTC.
  - Devuelve el detalle para mostrar:
    - película, clasificación, sala, horario y butacas;
    - productos a entregar, con el contenido de cada combo ya multiplicado;
    - si todavía hay Candy Bar pendiente de retirar.
  - **Auditoría:** registra `QR_VALIDADO_SALA`, `QR_ENTREGA_CANDY` y también los intentos rechazados (`QR_RECHAZADO`, con el motivo).
- **`cambiar_rol_usuario(p_usuario_id, p_rol)`:**
  - Sólo la puede usar un administrador, y no puede cambiarse su propio rol.
  - Registra `CAMBIO_ROL` en la auditoría.

Se probó en un Postgres local, incluyendo correr la migración dos veces y aplicarla sobre compras ya existentes:

- permisos: anónimo, cliente, empleado y admin;
- validación por UUID y por código corto con guion y en minúsculas;
- Candy Bar antes que la sala y a la inversa;
- doble validación;
- compra sin Candy Bar;
- función de otro día;
- compra cancelada;
- los registros de auditoría.

### Front

**Nuevos**

- `core/guards/rol.guard.ts`
  - `empleadoGuard`: la ruta `/empleado` sólo para empleados y administradores.
  - `sinEmpleadoGuard`: si un empleado entra a la parte pública, lo redirige a `/empleado` (acceso exclusivo).
- `core/services/validacion.service.ts`: llama a `validar_qr` y formatea el código corto (`K7F3-9QXM`).
- `core/services/usuarios.service.ts`: lista los usuarios (admin) y cambia su rol.
- `core/models/validacion.model.ts`: tipos del resultado de validación.
- `shared/qr-scanner/`: lector de QR con cámara.
  - Usa la API nativa `BarcodeDetector` si existe (Chrome Android); si no, `jsqr`, que se carga sólo cuando hace falta (Safari/iOS, Firefox).
  - Usa la cámara trasera.
  - Ignora relecturas del mismo código durante 3 segundos.
  - Muestra mensajes claros si no hay permiso, no hay cámara o la página no está en HTTPS.
- `features/empleado/validar-qr/`: pantalla del empleado.
  - Selector grande de modo: **Acceso a sala** (turquesa) o **Candy Bar** (naranja). El color de la pantalla cambia para no validar en el modo equivocado.
  - Cámara con botón para activar y apagar, y campo para ingresar el código a mano.
  - Resultado grande en verde o en rojo, con:
    - el motivo;
    - película, función y butacas;
    - el aviso de +13/+18 (ingresar con un adulto);
    - los productos a entregar, con el contenido de cada combo;
    - un aviso si todavía tiene Candy Bar por retirar.
  - Vibra al validar (verde o rojo) y guarda un historial de las últimas 10 validaciones de la sesión.
  - Si el usuario es administrador, muestra un acceso a "Panel admin".
- `features/admin/empleados/`: pantalla del admin para asignar o quitar el rol empleado a usuarios registrados, con búsqueda y filtro por rol.

**Modificados**

- `app.routes.ts`: ruta `/empleado`, ruta `admin/empleados` y el guard `sinEmpleadoGuard` en la parte pública.
- `auth.service.ts`: `obtenerRolActual()`, con caché por usuario que se limpia al cerrar sesión, y `rutaInicioSegunRol()`.
- `login.component.ts`: al iniciar sesión redirige según el rol (admin → `/admin`, empleado → `/empleado`, cliente → `/inicio`).
- `admin-layout.component.ts`: ítems "Empleados" y "Validar QR" en el menú.
- `comprobante-pdf.service.ts`:
  - imprime el código corto debajo del QR;
  - corrige el texto de ayuda, que estaba centrado en el borde del QR y no en el medio.
- `butacas.component.*`: la pantalla de compra confirmada muestra el código corto grande, en lugar del UUID.
- `compra.model.ts`: `codigo_corto` en `CompraConfirmada`.
- `package.json`: dependencia `jsqr`.

### Cómo ponerlo en marcha

1. Correr en Supabase → SQL Editor, en este orden, las que falten:
   1. `20260930_candy_bar_en_compras.sql`
   2. `20260930_empleado_validacion_qr.sql`
2. `npm install`, para bajar `jsqr`.
3. `ng build` / `ng serve`.
4. Crear un empleado: registrar un usuario normal y, desde **Admin → Empleados**, tocar **Hacer empleado**.
5. La cámara necesita HTTPS: funciona en el deploy de Firebase y en `localhost`, no desde otra PC por IP.

### Cómo probarlo

1. Comprar una entrada con un combo para una función de **hoy** y anotar el código corto que muestra la pantalla o el PDF.
2. Iniciar sesión como empleado: tiene que ir directo a `/empleado`. Si intenta entrar a `/cartelera`, vuelve a `/empleado`.
3. En modo **Sala**, escanear el QR del PDF (en otro dispositivo) o escribir el código:
   - debe salir verde, con las butacas y el aviso "tiene productos para retirar";
   - la segunda vez, rojo por "ya ingresaron…".
4. En modo **Candy Bar**, con el mismo código:
   - debe salir verde, con los productos y el contenido del combo;
   - la segunda vez, rojo.
5. Con una compra sin productos, el modo Candy Bar tiene que decir que no incluye productos.
6. En `log_auditoria` tienen que figurar las validaciones y los rechazos, con el usuario y la hora.

### Pendiente o fuera de alcance

- La pantalla de **Auditoría** del admin todavía es un placeholder: los registros existen en la tabla, pero falta mostrarlos.
- La **cancelación** de compras todavía no existe; cuando se haga, `validar_qr` ya rechaza las compras canceladas.
- El empleado no es un rol "bloqueado" en la base para comprar: sólo se lo redirige desde el front. Si hace falta, se puede agregar la restricción en `crear_compra_entradas`.

---

## 2026-09-29 — Candy Bar y combos en la compra

### Admin (correcciones)

- **Guardado atómico de combos:** la RPC `guardar_combo` hace todo en una sola transacción. Antes, editar un combo eran 3 llamadas sueltas y el combo podía quedar sin productos.
- **Mensajes de error claros** para:
  - nombres de categoría repetidos;
  - productos o combos que no se pueden borrar porque ya se vendieron (se sugiere desactivarlos).
- Al eliminar un producto, avisa de qué combos se va a quitar.
- El formulario de combos muestra el precio "por separado" como referencia para la promo.
- La cantidad de un producto en un combo se normaliza a un entero ≥ 1.
- Auditoría de altas, cambios (incluidos los de precio) y bajas en `candy_productos` y `combos`.

### Compra del cliente

- **Paso 2 "Candy Bar y pago"** después de elegir las butacas:
  - combos especiales destacados arriba, con precio, contenido y ahorro;
  - productos por categoría, con filtros y botones +/−;
  - resumen con el total.
- **Combos con entrada:**
  - cada combo cubre el precio base de una butaca elegida; si la butaca es VIP, se cobra sólo el recargo;
  - no puede haber más combos con entrada que butacas;
  - si el cliente suelta una butaca, los combos se ajustan solos.
- **`crear_compra_entradas` recibe los ítems del Candy Bar:**
  - los precios y el total se calculan en la base;
  - todo queda bajo el mismo código QR.
- **PDF:** incluye los productos y los combos, marca las entradas cubiertas por un combo y agrega páginas si el detalle es largo.
- **Bugs corregidos:**
  - el mensaje de error de una compra fallida se borraba solo;
  - la selección de butacas quedaba desincronizada después de un error;
  - el PDF se podía volver a descargar sin entradas.

Migración: `supabase/migrations/20260930_candy_bar_en_compras.sql`.
