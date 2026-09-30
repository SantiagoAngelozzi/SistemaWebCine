-- Ejecutar UNA VEZ en Supabase SQL Editor, DESPUÉS de
-- 20260930_empleado_validacion_qr.sql.
--
-- Perfil, cancelación hasta 2 h antes y crédito en cuenta:
--   * Sólo usuarios registrados cancelan (desde "Mis compras"). Se acredita
--     el total en su cuenta; no hay devolución de dinero.
--   * Al cancelar, las butacas vuelven a estar disponibles (la entrada queda
--     como historial con activa = false).
--   * El crédito se puede usar en compras futuras, combinado con otro medio.
--   * Movimientos de crédito para el historial del perfil.
--   * Regla de edad: sólo se bloquea al registrado cuya fecha de nacimiento
--     se conoce y no alcanza la mínima.

-- ------------------------------------------------------------
-- 1) Esquema
-- ------------------------------------------------------------
alter table public.compras add column if not exists cancelada_at timestamptz;

-- Entradas: activa = false cuando la compra se cancela. La butaca vuelve a
-- estar libre, pero la fila queda como historial.
alter table public.compra_entradas add column if not exists activa boolean not null default true;
alter table public.compra_entradas add column if not exists incluida_en_combo boolean not null default false;

-- La restricción de doble venta pasa a aplicarse sólo a entradas activas.
alter table public.compra_entradas drop constraint if exists compra_entradas_funcion_id_butaca_id_key;
drop index if exists public.compra_entradas_butaca_activa_key;
create unique index compra_entradas_butaca_activa_key
  on public.compra_entradas (funcion_id, butaca_id)
  where activa;

-- Historial de crédito: + al cancelar, − al usarlo en una compra.
create table if not exists public.movimientos_credito (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  compra_id uuid references public.compras (id) on delete set null,
  monto numeric(10, 2) not null,
  motivo text not null check (motivo in ('cancelacion', 'uso_en_compra')),
  created_at timestamptz not null default now()
);

alter table public.movimientos_credito enable row level security;

drop policy if exists "movimientos_credito_select_own_or_admin" on public.movimientos_credito;
create policy "movimientos_credito_select_own_or_admin" on public.movimientos_credito
  for select using (usuario_id = auth.uid() or public.is_admin());
-- Sin políticas de insert/update/delete: sólo lo escriben las funciones.

-- Las entradas canceladas se liberan en vivo en otros mapas (UPDATE por
-- Realtime). La tabla ya está en la publicación supabase_realtime.

-- ------------------------------------------------------------
-- 2) Protección de crédito
-- ------------------------------------------------------------
-- El trigger impide que un cliente cambie su crédito. Las funciones de
-- compra y cancelación lo modifican marcando la variable de sesión
-- app.movimiento_credito sólo durante su propia transacción.
create or replace function public.proteger_campos_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.rol is distinct from old.rol
      or new.puntos is distinct from old.puntos
      or (new.credito is distinct from old.credito
          and coalesce(current_setting('app.movimiento_credito', true), 'off') <> 'on') then
      raise exception 'No tenés permiso para modificar campos protegidos del perfil.';
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) Compra: crédito, edad y marca de entrada incluida en combo
-- ------------------------------------------------------------
drop function if exists public.crear_compra_entradas(uuid, uuid[], jsonb);

create or replace function public.crear_compra_entradas(
  p_funcion_id uuid,
  p_butaca_ids uuid[],
  p_items jsonb default '[]'::jsonb,
  p_usar_credito boolean default false
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
  v_credito_disponible numeric(10, 2);
  v_credito_usado numeric(10, 2) := 0;
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

    -- Sólo se bloquea si se CONOCE la fecha de nacimiento y no alcanza la
    -- edad mínima. Anónimos (y cuentas sin fecha cargada) compran igual: la
    -- entrada lleva impresa la advertencia de ir con un adulto responsable.
    if v_fecha_nacimiento is not null
      and date_part('year', age(current_date, v_fecha_nacimiento)) < v_edad_minima then
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
  insert into public.compra_entradas (compra_id, funcion_id, butaca_id, precio, incluida_en_combo)
  select v_compra_id, p_funcion_id, b.id,
         case
           when b.orden <= v_combos_con_entrada then
             case when b.tipo = 'vip' then v_precio_vip - v_precio_base else 0 end
           else
             case when b.tipo = 'vip' then v_precio_vip else v_precio_base end
         end,
         b.orden <= v_combos_con_entrada
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

  -- ---------- Crédito en cuenta (combinable con otros medios) ----------
  -- Sólo usuarios registrados. Se usa como máximo el total de la compra; el
  -- resto se abona con otro medio de pago.
  if p_usar_credito and v_usuario_id is not null then
    select credito into v_credito_disponible
    from public.usuarios where id = v_usuario_id
    for update;

    v_credito_usado := least(coalesce(v_credito_disponible, 0), v_total);

    if v_credito_usado > 0 then
      perform set_config('app.movimiento_credito', 'on', true);
      update public.usuarios set credito = credito - v_credito_usado where id = v_usuario_id;
      perform set_config('app.movimiento_credito', 'off', true);

      insert into public.movimientos_credito (usuario_id, compra_id, monto, motivo)
      values (v_usuario_id, v_compra_id, -v_credito_usado, 'uso_en_compra');
    end if;
  end if;

  update public.compras
  set total = v_total,
      credito_usado = v_credito_usado,
      metodo_pago = case
        when v_credito_usado = 0 then 'otro'
        when v_credito_usado >= v_total then 'credito'
        else 'credito+otro'
      end
  where id = v_compra_id;

  -- ---------- Detalle para el comprobante ----------
  -- El front arma el PDF con estos datos (verificados en la base), no con
  -- los que calculó el navegador.
  select coalesce(jsonb_agg(jsonb_build_object(
           'butaca_id', b.id,
           'ubicacion', b.fila || '-' || b.columna,
           'tipo', b.tipo,
           'precio', ce.precio,
           'incluida_en_combo', ce.incluida_en_combo
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
    'credito_usado', v_credito_usado,
    'a_pagar', v_total - v_credito_usado,
    'entradas', v_entradas,
    'candy', v_candy
  );
exception
  when unique_violation then
    raise exception 'Una o más butacas ya fueron vendidas. Elegí otras y volvé a intentar.';
end;
$$;

revoke all on function public.crear_compra_entradas(uuid, uuid[], jsonb, boolean) from public;
grant execute on function public.crear_compra_entradas(uuid, uuid[], jsonb, boolean) to anon, authenticated;

-- ------------------------------------------------------------
-- 4) Cancelación
-- ------------------------------------------------------------
-- Reglas:
--   * Sólo el dueño de la compra (usuario registrado).
--   * Compra confirmada y sin usar (ni ingreso a sala ni retiro de Candy Bar).
--   * Hasta 2 horas antes del inicio de la función (hora de Argentina).
--   * Se acredita el total de la compra (incluye el crédito que se haya usado
--     para pagarla) y se liberan las butacas.
create or replace function public.cancelar_compra(p_compra_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_compra public.compras%rowtype;
  v_inicio timestamp;
  v_ahora_local timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_credito_total numeric(10, 2);
begin
  if v_usuario_id is null then
    raise exception 'Iniciá sesión para cancelar una compra.';
  end if;

  select * into v_compra
  from public.compras
  where id = p_compra_id and usuario_id = v_usuario_id
  for update;

  if not found then
    raise exception 'La compra no existe o no es tuya.';
  end if;

  if v_compra.estado <> 'confirmada' then
    raise exception 'La compra ya estaba cancelada.';
  end if;

  if v_compra.entrada_validada_at is not null or v_compra.candy_entregado_at is not null then
    raise exception 'No se puede cancelar: la compra ya se usó.';
  end if;

  select min(f.fecha + f.hora_inicio) into v_inicio
  from public.compra_entradas ce
  join public.funciones f on f.id = ce.funcion_id
  where ce.compra_id = v_compra.id;

  if v_inicio is null then
    raise exception 'La compra no tiene una función asociada.';
  end if;

  if v_ahora_local > v_inicio - interval '2 hours' then
    raise exception 'Sólo se puede cancelar hasta 2 horas antes de la función.';
  end if;

  update public.compras
  set estado = 'cancelada',
      cancelada_at = now(),
      qr_vigente = false
  where id = v_compra.id;

  -- Libera las butacas (dispara el UPDATE que escuchan los mapas en vivo).
  update public.compra_entradas set activa = false where compra_id = v_compra.id;

  if v_compra.total > 0 then
    perform set_config('app.movimiento_credito', 'on', true);
    update public.usuarios set credito = credito + v_compra.total where id = v_usuario_id;
    perform set_config('app.movimiento_credito', 'off', true);

    insert into public.movimientos_credito (usuario_id, compra_id, monto, motivo)
    values (v_usuario_id, v_compra.id, v_compra.total, 'cancelacion');
  end if;

  select credito into v_credito_total from public.usuarios where id = v_usuario_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (v_usuario_id, 'COMPRA_CANCELADA', 'compras', v_compra.id,
          jsonb_build_object('codigo_corto', v_compra.codigo_corto, 'credito_otorgado', v_compra.total));

  return jsonb_build_object(
    'compra_id', v_compra.id,
    'credito_otorgado', v_compra.total,
    'credito_total', v_credito_total
  );
end;
$$;

revoke all on function public.cancelar_compra(uuid) from public;
grant execute on function public.cancelar_compra(uuid) to authenticated;
