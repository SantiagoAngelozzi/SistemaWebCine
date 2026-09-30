-- Ejecutar UNA VEZ en Supabase SQL Editor, DESPUÉS de
-- 20260930_candy_bar_en_compras.sql.
--
-- Módulo de empleados — validación de QR:
--   * El QR es uno solo por compra, pero tiene DOS usos que se consumen por
--     separado: acceso a sala y retiro en Candy Bar. Cada uso queda
--     inhabilitado inmediatamente después de validarse.
--   * Código corto alfanumérico (8 caracteres, ej. K7F3-9QXM) para cargar a
--     mano si falla el lector. Se imprime en el PDF junto al QR.
--   * Función validar_qr: sólo empleados o administradores, con bloqueo de
--     fila para que dos lectores no validen el mismo QR a la vez, y registro
--     en la auditoría (quién, qué y cuándo).
--   * Función cambiar_rol_usuario: el admin asigna/quita el rol empleado.

-- ------------------------------------------------------------
-- 1) Columnas nuevas en compras
-- ------------------------------------------------------------
alter table public.compras add column if not exists codigo_corto text;
alter table public.compras add column if not exists entrada_validada_at timestamptz;
alter table public.compras add column if not exists entrada_validada_por uuid references public.usuarios (id) on delete set null;
alter table public.compras add column if not exists candy_entregado_at timestamptz;
alter table public.compras add column if not exists candy_entregado_por uuid references public.usuarios (id) on delete set null;

comment on column public.compras.qr_vigente is
  'Se mantiene por compatibilidad: pasa a false cuando se consumieron todos los usos del QR (sala y, si hay, Candy Bar). La validación usa entrada_validada_at / candy_entregado_at.';

-- ------------------------------------------------------------
-- 2) Código corto
-- ------------------------------------------------------------
-- Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L): 31^8 ≈ 850 mil millones
-- de combinaciones. Se guarda sin guion; el guion es sólo de presentación.
create or replace function public.generar_codigo_corto()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_alfabeto constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_codigo text;
  i integer;
begin
  loop
    v_bytes := gen_random_bytes(8);
    v_codigo := '';
    for i in 0..7 loop
      v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % length(v_alfabeto)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.compras where codigo_corto = v_codigo);
  end loop;
  return v_codigo;
end;
$$;

create or replace function public.asignar_codigo_corto()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.codigo_corto is null then
    new.codigo_corto := public.generar_codigo_corto();
  end if;
  return new;
end;
$$;

drop trigger if exists compras_codigo_corto on public.compras;
create trigger compras_codigo_corto
before insert on public.compras
for each row execute function public.asignar_codigo_corto();

-- Compras ya existentes.
update public.compras set codigo_corto = public.generar_codigo_corto() where codigo_corto is null;

alter table public.compras alter column codigo_corto set not null;
create unique index if not exists compras_codigo_corto_key on public.compras (codigo_corto);

-- ------------------------------------------------------------
-- 3) La compra devuelve también el código corto (para el PDF)
-- ------------------------------------------------------------
-- Misma función que en 20260930_candy_bar_en_compras.sql; sólo cambia el
-- objeto que devuelve.
create or replace function public.crear_compra_entradas(
  p_funcion_id uuid,
  p_butaca_ids uuid[],
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_funcion record;
  v_usuario_id uuid := auth.uid();
  v_fecha_nacimiento date;
  v_edad_minima integer := 0;
  v_precio_base numeric(10, 2);
  v_precio_vip numeric(10, 2);
  v_total numeric(10, 2);
  v_compra_id uuid;
  v_codigo_qr text := gen_random_uuid()::text;
  v_cantidad_butacas integer;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_cantidad_items_pedidos integer;
  v_cantidad_items_validos integer;
  v_combos_con_entrada integer;
  v_entradas jsonb;
  v_candy jsonb;
begin
  -- ---------- Butacas ----------
  if coalesce(cardinality(p_butaca_ids), 0) = 0 then
    raise exception 'Elegí al menos una butaca.';
  end if;

  if cardinality(p_butaca_ids) <> (
    select count(distinct asiento_id)
    from unnest(p_butaca_ids) as asiento(asiento_id)
  ) then
    raise exception 'No podés repetir una butaca en la misma compra.';
  end if;

  -- ---------- Función, preventa y edad ----------
  select f.id, f.sala_id, p.clasificacion, p.fecha_estreno, p.dias_preventa,
         p.precio_normal, p.precio_preventa
  into v_funcion
  from public.funciones f
  join public.peliculas p on p.id = f.pelicula_id
  where f.id = p_funcion_id and p.activa;

  if not found then
    raise exception 'La función no está disponible.';
  end if;

  if current_date < (v_funcion.fecha_estreno - v_funcion.dias_preventa) then
    raise exception 'La venta de esta película todavía no está habilitada.';
  end if;

  if current_date < v_funcion.fecha_estreno and v_funcion.precio_preventa is not null then
    v_precio_base := v_funcion.precio_preventa;
  else
    v_precio_base := v_funcion.precio_normal;
  end if;
  v_precio_vip := round(v_precio_base * 1.5, 2);

  if v_funcion.clasificacion = '+13' then
    v_edad_minima := 13;
  elsif v_funcion.clasificacion = '+18' then
    v_edad_minima := 18;
  end if;

  if v_usuario_id is not null and v_edad_minima > 0 then
    select fecha_nacimiento into v_fecha_nacimiento
    from public.usuarios
    where id = v_usuario_id;

    if v_fecha_nacimiento is null
      or date_part('year', age(current_date, v_fecha_nacimiento)) < v_edad_minima then
      raise exception 'No cumplís la edad mínima para esta película.';
    end if;
  end if;

  select count(*) into v_cantidad_butacas
  from public.butacas
  where sala_id = v_funcion.sala_id and id = any(p_butaca_ids);

  if v_cantidad_butacas <> cardinality(p_butaca_ids) then
    raise exception 'Una o más butacas no pertenecen a la sala de esta función.';
  end if;

  -- ---------- Candy Bar: validación de ítems ----------
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'Formato inválido de productos del Candy Bar.';
  end if;

  create temporary table if not exists tmp_candy_pedido (
    tipo text not null,
    item_id uuid not null,
    cantidad integer not null
  ) on commit drop;
  truncate tmp_candy_pedido;

  begin
    insert into tmp_candy_pedido (tipo, item_id, cantidad)
    select item ->> 'tipo',
           (item ->> 'id')::uuid,
           sum((item ->> 'cantidad')::integer)
    from jsonb_array_elements(v_items) as item
    group by item ->> 'tipo', (item ->> 'id')::uuid;
  exception
    when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
      raise exception 'Formato inválido de productos del Candy Bar.';
  end;

  if exists (select 1 from tmp_candy_pedido where tipo not in ('producto', 'combo')) then
    raise exception 'Formato inválido de productos del Candy Bar.';
  end if;

  if exists (select 1 from tmp_candy_pedido where cantidad < 1 or cantidad > 20) then
    raise exception 'Cada producto del Candy Bar admite entre 1 y 20 unidades por compra.';
  end if;

  select count(*) into v_cantidad_items_pedidos from tmp_candy_pedido;

  select count(*) into v_cantidad_items_validos
  from tmp_candy_pedido t
  where (t.tipo = 'producto' and exists (
          select 1 from public.candy_productos cp where cp.id = t.item_id and cp.activo))
     or (t.tipo = 'combo' and exists (
          select 1 from public.combos c where c.id = t.item_id and c.activo));

  if v_cantidad_items_validos <> v_cantidad_items_pedidos then
    raise exception 'Uno o más productos del Candy Bar ya no están disponibles. Actualizá la página.';
  end if;

  select coalesce(sum(t.cantidad), 0) into v_combos_con_entrada
  from tmp_candy_pedido t
  join public.combos c on c.id = t.item_id
  where t.tipo = 'combo' and c.incluye_entrada;

  if v_combos_con_entrada > v_cantidad_butacas then
    raise exception 'Elegiste % combo(s) con entrada pero sólo % butaca(s). Cada combo con entrada necesita una butaca.',
      v_combos_con_entrada, v_cantidad_butacas;
  end if;

  -- ---------- Alta de la compra ----------
  insert into public.compras (usuario_id, total, estado, codigo_qr)
  values (v_usuario_id, 0, 'confirmada', v_codigo_qr)
  returning id into v_compra_id;

  -- Las primeras N butacas (no VIP primero) quedan cubiertas por los combos
  -- con entrada: se cobra 0, o sólo el recargo VIP.
  insert into public.compra_entradas (compra_id, funcion_id, butaca_id, precio)
  select v_compra_id, p_funcion_id, b.id,
         case
           when b.orden <= v_combos_con_entrada then
             case when b.tipo = 'vip' then v_precio_vip - v_precio_base else 0 end
           else
             case when b.tipo = 'vip' then v_precio_vip else v_precio_base end
         end
  from (
    select bu.id, bu.tipo,
           row_number() over (order by (bu.tipo = 'vip'), bu.fila, bu.columna) as orden
    from public.butacas bu
    where bu.id = any(p_butaca_ids)
  ) b;

  insert into public.compra_candy_items (compra_id, candy_producto_id, combo_id, cantidad, precio_unitario)
  select v_compra_id,
         case when t.tipo = 'producto' then t.item_id end,
         case when t.tipo = 'combo' then t.item_id end,
         t.cantidad,
         coalesce(cp.precio, c.precio)
  from tmp_candy_pedido t
  left join public.candy_productos cp on t.tipo = 'producto' and cp.id = t.item_id
  left join public.combos c on t.tipo = 'combo' and c.id = t.item_id;

  select coalesce(sum(precio), 0) into v_total
  from public.compra_entradas where compra_id = v_compra_id;

  v_total := v_total + (
    select coalesce(sum(cantidad * precio_unitario), 0)
    from public.compra_candy_items where compra_id = v_compra_id
  );

  update public.compras set total = v_total where id = v_compra_id;

  -- ---------- Detalle para el comprobante ----------
  -- El front arma el PDF con estos datos (verificados en la base), no con
  -- los que calculó el navegador.
  select coalesce(jsonb_agg(jsonb_build_object(
           'butaca_id', b.id,
           'ubicacion', b.fila || '-' || b.columna,
           'tipo', b.tipo,
           'precio', ce.precio,
           'incluida_en_combo', ce.precio < case when b.tipo = 'vip' then v_precio_vip else v_precio_base end
         ) order by b.fila, b.columna), '[]'::jsonb)
  into v_entradas
  from public.compra_entradas ce
  join public.butacas b on b.id = ce.butaca_id
  where ce.compra_id = v_compra_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', case when i.combo_id is not null then 'combo' else 'producto' end,
           'id', coalesce(i.combo_id, i.candy_producto_id),
           'nombre', coalesce(c.nombre, cp.nombre),
           'cantidad', i.cantidad,
           'precio_unitario', i.precio_unitario,
           'incluye_entrada', coalesce(c.incluye_entrada, false)
         ) order by (i.combo_id is null), coalesce(c.nombre, cp.nombre)), '[]'::jsonb)
  into v_candy
  from public.compra_candy_items i
  left join public.combos c on c.id = i.combo_id
  left join public.candy_productos cp on cp.id = i.candy_producto_id
  where i.compra_id = v_compra_id;

  return jsonb_build_object(
    'compra_id', v_compra_id,
    'codigo_qr', v_codigo_qr,
    'codigo_corto', (select codigo_corto from public.compras where id = v_compra_id),
    'total', v_total,
    'entradas', v_entradas,
    'candy', v_candy
  );
exception
  when unique_violation then
    raise exception 'Una o más butacas ya fueron vendidas. Elegí otras y volvé a intentar.';
end;
$$;

revoke all on function public.crear_compra_entradas(uuid, uuid[], jsonb) from public;
grant execute on function public.crear_compra_entradas(uuid, uuid[], jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 4) Roles
-- ------------------------------------------------------------
create or replace function public.es_empleado_o_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and rol in ('empleado', 'administrador')
  );
$$;

-- El admin asigna el rol a un usuario ya registrado. No puede cambiarse su
-- propio rol (para no quedarse afuera del panel por error).
create or replace function public.cambiar_rol_usuario(p_usuario_id uuid, p_rol rol_usuario)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol_anterior rol_usuario;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar roles.';
  end if;

  if p_usuario_id = auth.uid() then
    raise exception 'No podés cambiar tu propio rol.';
  end if;

  select rol into v_rol_anterior from public.usuarios where id = p_usuario_id for update;
  if not found then
    raise exception 'El usuario no existe.';
  end if;

  if v_rol_anterior = p_rol then
    return;
  end if;

  update public.usuarios set rol = p_rol where id = p_usuario_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    auth.uid(), 'CAMBIO_ROL', 'usuarios', p_usuario_id,
    jsonb_build_object('rol_anterior', v_rol_anterior, 'rol_nuevo', p_rol)
  );
end;
$$;

revoke all on function public.es_empleado_o_admin() from public;
grant execute on function public.es_empleado_o_admin() to authenticated;
revoke all on function public.cambiar_rol_usuario(uuid, rol_usuario) from public;
grant execute on function public.cambiar_rol_usuario(uuid, rol_usuario) to authenticated;

-- ------------------------------------------------------------
-- 5) Validación de QR
-- ------------------------------------------------------------
-- p_codigo: el contenido del QR (UUID) o el código corto (con o sin guion,
--           mayúsculas o minúsculas).
-- p_tipo:   'sala' | 'candy'
--
-- Devuelve jsonb:
--   { ok: true,  tipo, codigo_corto, pelicula, ..., entradas[], candy[] }
--   { ok: false, motivo, mensaje, ... }
-- Los rechazos se DEVUELVEN (no se lanza excepción) para que el intento
-- quede igualmente registrado en la auditoría.
--
-- Reglas:
--   * Compra inexistente o cancelada -> rechazo.
--   * Cada uso (sala / candy) se consume una sola vez.
--   * Sala: sólo el día de la función y hasta que termina.
--   * Candy: sólo el día de la función y si la compra incluye productos.
--   Fechas en hora de Argentina (Supabase corre en UTC).
create or replace function public.validar_qr(p_codigo text, p_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text := trim(coalesce(p_codigo, ''));
  v_compra public.compras%rowtype;
  v_funcion record;
  v_ahora_local timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_entradas jsonb;
  v_candy jsonb;
  v_detalle jsonb;
  v_resultado jsonb;
  v_ya_usado_at timestamptz;
begin
  if not public.es_empleado_o_admin() then
    raise exception 'Solo un empleado puede validar códigos QR.';
  end if;

  if p_tipo not in ('sala', 'candy') then
    raise exception 'Tipo de validación inválido.';
  end if;

  -- Buscar por UUID (lector) o por código corto (carga manual). Se bloquea la
  -- fila hasta el fin de la transacción: una segunda validación simultánea
  -- espera y después ve el uso ya consumido.
  if v_codigo ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_compra from public.compras where codigo_qr = lower(v_codigo) for update;
  else
    v_codigo := upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'));
    select * into v_compra from public.compras where codigo_corto = v_codigo for update;
  end if;

  if not found then
    v_resultado := jsonb_build_object(
      'ok', false, 'motivo', 'no_existe',
      'mensaje', 'El código no corresponde a ninguna compra.'
    );
    insert into public.log_auditoria (usuario_id, accion, entidad, detalle)
    values (auth.uid(), 'QR_RECHAZADO', 'compras',
            jsonb_build_object('tipo', p_tipo, 'codigo', left(coalesce(p_codigo, ''), 60), 'motivo', 'no_existe'));
    return v_resultado;
  end if;

  -- Datos de la función (todas las entradas de una compra son de la misma).
  select f.fecha, f.hora_inicio, f.hora_fin, f.formato, f.idioma,
         p.nombre as pelicula, p.clasificacion, s.nombre as sala
  into v_funcion
  from public.compra_entradas ce
  join public.funciones f on f.id = ce.funcion_id
  join public.peliculas p on p.id = f.pelicula_id
  join public.salas s on s.id = f.sala_id
  where ce.compra_id = v_compra.id
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ubicacion', b.fila || '-' || b.columna,
           'tipo', b.tipo
         ) order by b.fila, b.columna), '[]'::jsonb)
  into v_entradas
  from public.compra_entradas ce
  join public.butacas b on b.id = ce.butaca_id
  where ce.compra_id = v_compra.id;

  -- Para los combos se detalla qué productos hay que entregar.
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', case when i.combo_id is not null then 'combo' else 'producto' end,
           'nombre', coalesce(c.nombre, cp.nombre),
           'cantidad', i.cantidad,
           'contenido', case when i.combo_id is null then '[]'::jsonb else (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'nombre', pr.nombre,
                      'cantidad', cpr.cantidad * i.cantidad
                    ) order by pr.nombre), '[]'::jsonb)
             from public.combo_productos cpr
             join public.candy_productos pr on pr.id = cpr.candy_producto_id
             where cpr.combo_id = i.combo_id
           ) end
         ) order by (i.combo_id is null), coalesce(c.nombre, cp.nombre)), '[]'::jsonb)
  into v_candy
  from public.compra_candy_items i
  left join public.combos c on c.id = i.combo_id
  left join public.candy_productos cp on cp.id = i.candy_producto_id
  where i.compra_id = v_compra.id;

  v_detalle := jsonb_build_object(
    'tipo', p_tipo,
    'compra_id', v_compra.id,
    'codigo_corto', v_compra.codigo_corto,
    'pelicula', v_funcion.pelicula,
    'clasificacion', v_funcion.clasificacion,
    'sala', v_funcion.sala,
    'fecha', v_funcion.fecha,
    'hora_inicio', v_funcion.hora_inicio,
    'hora_fin', v_funcion.hora_fin,
    'formato', v_funcion.formato,
    'idioma', v_funcion.idioma,
    'entradas', v_entradas,
    'candy', v_candy,
    'entrada_validada_at', v_compra.entrada_validada_at,
    'candy_entregado_at', v_compra.candy_entregado_at
  );

  -- ---------- Rechazos ----------
  if v_compra.estado <> 'confirmada' then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'cancelada', 'mensaje', 'La compra fue cancelada.');
  elsif v_funcion.fecha is null then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'sin_funcion', 'mensaje', 'La compra no tiene entradas asociadas.');
  elsif p_tipo = 'sala' and v_compra.entrada_validada_at is not null then
    v_ya_usado_at := v_compra.entrada_validada_at;
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'ya_utilizado',
      'mensaje', 'Estas entradas ya ingresaron a la sala el ' ||
                 to_char(v_ya_usado_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI') || '.');
  elsif p_tipo = 'candy' and jsonb_array_length(v_candy) = 0 then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'sin_candy', 'mensaje', 'Esta compra no incluye productos del Candy Bar.');
  elsif p_tipo = 'candy' and v_compra.candy_entregado_at is not null then
    v_ya_usado_at := v_compra.candy_entregado_at;
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'ya_utilizado',
      'mensaje', 'Los productos ya se entregaron el ' ||
                 to_char(v_ya_usado_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI') || '.');
  elsif v_funcion.fecha <> v_ahora_local::date then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false,
      'motivo', case when v_funcion.fecha < v_ahora_local::date then 'vencida' else 'otra_fecha' end,
      'mensaje', 'La función es el ' || to_char(v_funcion.fecha, 'DD/MM/YYYY') || ', no hoy.');
  elsif p_tipo = 'sala' and v_ahora_local::time > v_funcion.hora_fin then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'vencida', 'mensaje', 'La función ya terminó.');
  end if;

  if v_resultado is not null then
    insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
    values (auth.uid(), 'QR_RECHAZADO', 'compras', v_compra.id,
            jsonb_build_object('tipo', p_tipo, 'codigo_corto', v_compra.codigo_corto,
                               'motivo', v_resultado ->> 'motivo'));
    return v_resultado;
  end if;

  -- ---------- Validación: se consume el uso ----------
  if p_tipo = 'sala' then
    update public.compras
    set entrada_validada_at = now(),
        entrada_validada_por = auth.uid(),
        qr_vigente = (jsonb_array_length(v_candy) > 0 and candy_entregado_at is null)
    where id = v_compra.id;
  else
    update public.compras
    set candy_entregado_at = now(),
        candy_entregado_por = auth.uid(),
        qr_vigente = (entrada_validada_at is null)
    where id = v_compra.id;
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (auth.uid(),
          case when p_tipo = 'sala' then 'QR_VALIDADO_SALA' else 'QR_ENTREGA_CANDY' end,
          'compras', v_compra.id,
          jsonb_build_object('codigo_corto', v_compra.codigo_corto,
                             'entradas', jsonb_array_length(v_entradas),
                             'items_candy', jsonb_array_length(v_candy)));

  return v_detalle || jsonb_build_object(
    'ok', true,
    'motivo', 'validado',
    'mensaje', case when p_tipo = 'sala' then 'Acceso habilitado.' else 'Entregar los productos.' end,
    -- Al validar la sala se avisa si todavía tiene Candy Bar por retirar.
    'candy_pendiente', p_tipo = 'sala' and jsonb_array_length(v_candy) > 0 and v_compra.candy_entregado_at is null
  );
end;
$$;

revoke all on function public.validar_qr(text, text) from public;
grant execute on function public.validar_qr(text, text) to authenticated;
