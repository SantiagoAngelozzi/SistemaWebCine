-- Ejecutar UNA VEZ en Supabase SQL Editor, DESPUÉS de
-- 20260929_corregir_seguridad_y_negocio.sql.
--
-- Candy Bar y combos:
--   * Admin: guardado atómico de combos (combo + productos en una sola
--     transacción) y validaciones de precios/cantidades en la base.
--   * Cliente: la compra de entradas ahora acepta productos y combos del
--     Candy Bar. Todos los precios se toman de la base, nunca del navegador,
--     y todo queda bajo el MISMO código QR de la compra.
--   * Auditoría de cambios de precios del Candy Bar y combos.

-- ------------------------------------------------------------
-- 1) Restricciones de integridad
-- ------------------------------------------------------------
-- NOT VALID: se aplican a filas nuevas/modificadas sin fallar si ya
-- existiera algún dato viejo inconsistente.

alter table public.candy_productos drop constraint if exists candy_productos_precio_chk;
alter table public.candy_productos
  add constraint candy_productos_precio_chk check (precio >= 0) not valid;

alter table public.combos drop constraint if exists combos_precio_chk;
alter table public.combos
  add constraint combos_precio_chk check (precio >= 0) not valid;

alter table public.combo_productos drop constraint if exists combo_productos_cantidad_chk;
alter table public.combo_productos
  add constraint combo_productos_cantidad_chk check (cantidad > 0) not valid;

alter table public.compra_candy_items drop constraint if exists compra_candy_items_cantidad_chk;
alter table public.compra_candy_items
  add constraint compra_candy_items_cantidad_chk check (cantidad > 0) not valid;

-- Cada ítem vendido es un producto suelto O un combo, nunca ambos ni ninguno.
alter table public.compra_candy_items drop constraint if exists compra_candy_items_producto_o_combo_chk;
alter table public.compra_candy_items
  add constraint compra_candy_items_producto_o_combo_chk
  check ((candy_producto_id is null) <> (combo_id is null)) not valid;


-- ------------------------------------------------------------
-- 2) Admin: alta/edición de combo en una sola transacción
-- ------------------------------------------------------------
-- Antes el front hacía update del combo + delete de items + insert de items
-- en 3 llamadas separadas: si fallaba la última, el combo quedaba sin
-- productos. Ahora todo ocurre dentro de esta función.
--
-- p_items: [{ "candy_producto_id": "<uuid>", "cantidad": 2 }, ...]
create or replace function public.guardar_combo(
  p_combo_id uuid,
  p_nombre text,
  p_precio numeric,
  p_incluye_entrada boolean,
  p_activo boolean,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_combo_id uuid := p_combo_id;
  v_cantidad_items integer;
  v_productos_validos integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar combos.';
  end if;

  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'El combo necesita un nombre.';
  end if;

  if p_precio is null or p_precio < 0 then
    raise exception 'El precio del combo no puede ser negativo.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Elegí al menos un producto para el combo.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item
    where coalesce((item ->> 'cantidad')::integer, 0) < 1
  ) then
    raise exception 'Las cantidades de los productos del combo deben ser mayores a 0.';
  end if;

  select count(distinct (item ->> 'candy_producto_id')::uuid)
  into v_cantidad_items
  from jsonb_array_elements(p_items) as item;

  if v_cantidad_items <> jsonb_array_length(p_items) then
    raise exception 'No repitas un producto dentro del combo; usá la cantidad.';
  end if;

  select count(*)
  into v_productos_validos
  from public.candy_productos cp
  where cp.id in (
    select (item ->> 'candy_producto_id')::uuid from jsonb_array_elements(p_items) as item
  );

  if v_productos_validos <> v_cantidad_items then
    raise exception 'Uno o más productos del combo ya no existen.';
  end if;

  if v_combo_id is null then
    insert into public.combos (nombre, precio, incluye_entrada, activo)
    values (trim(p_nombre), p_precio, p_incluye_entrada, p_activo)
    returning id into v_combo_id;
  else
    update public.combos
    set nombre = trim(p_nombre),
        precio = p_precio,
        incluye_entrada = p_incluye_entrada,
        activo = p_activo
    where id = v_combo_id;

    if not found then
      raise exception 'El combo que querés editar ya no existe.';
    end if;

    delete from public.combo_productos where combo_id = v_combo_id;
  end if;

  insert into public.combo_productos (combo_id, candy_producto_id, cantidad)
  select v_combo_id,
         (item ->> 'candy_producto_id')::uuid,
         (item ->> 'cantidad')::integer
  from jsonb_array_elements(p_items) as item;

  return v_combo_id;
end;
$$;

revoke all on function public.guardar_combo(uuid, text, numeric, boolean, boolean, jsonb) from public;
grant execute on function public.guardar_combo(uuid, text, numeric, boolean, boolean, jsonb) to authenticated;


-- ------------------------------------------------------------
-- 3) Cliente: compra de entradas + Candy Bar bajo un mismo QR
-- ------------------------------------------------------------
-- Reemplaza a crear_compra_entradas(uuid, uuid[]). Se mantiene el nombre
-- y se agrega un tercer parámetro opcional con los ítems del Candy Bar:
--
-- p_items: [{ "tipo": "producto" | "combo", "id": "<uuid>", "cantidad": 2 }, ...]
--
-- Reglas de combos que incluyen entrada ("Entrada + Pochoclo + Bebida"):
--   * Cada combo con entrada cubre UNA de las butacas elegidas, así que no
--     puede haber más combos con entrada que butacas.
--   * El combo cubre el precio base de la entrada (el de la función, con
--     preventa si corresponde). Si la butaca cubierta es VIP, se sigue
--     cobrando sólo el recargo VIP, que ya se informa antes de pagar.
--   * Se cubren primero las butacas no VIP.
drop function if exists public.crear_compra_entradas(uuid, uuid[]);

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
-- 4) Auditoría de cambios de precios del Candy Bar
-- ------------------------------------------------------------
drop trigger if exists auditar_candy_productos on public.candy_productos;
create trigger auditar_candy_productos
after insert or update or delete on public.candy_productos
for each row execute function public.registrar_auditoria();

drop trigger if exists auditar_combos on public.combos;
create trigger auditar_combos
after insert or update or delete on public.combos
for each row execute function public.registrar_auditoria();
