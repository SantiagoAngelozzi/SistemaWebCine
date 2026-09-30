-- Ejecutar UNA VEZ en Supabase SQL Editor, DESPUÉS de
-- 20260930_perfil_cancelacion_credito.sql.
--
-- Cupones y programa de puntos:
--   * Cupón de bienvenida automático en la primera compra (porcentaje
--     configurable por el admin; 20% por defecto).
--   * Cupones creados por el admin: generales o segmentados por rango de
--     edad (ej. mayores de 50), con vigencia y tope de usos.
--   * Un solo descuento por compra: si corresponden la bienvenida y un
--     cupón, se aplica el mayor.
--   * Puntos: 1 punto por cada $1 abonado con otros medios (no con crédito
--     en cuenta), sólo usuarios registrados. Intransferibles.
--   * Canje de puntos por entradas o productos del Candy Bar según la tabla
--     de recompensas que define el admin.
--   * Cancelar una compra revierte sus puntos y devuelve los canjeados.
--
-- Orden del cálculo de una compra:
--   entradas (combos y canjes cubren el precio base de una butaca)
--   + Candy Bar (los productos canjeados van a $0)
--   = subtotal  →  − descuento (%)  = total  →  − crédito  = a pagar
--   →  puntos ganados = parte entera de "a pagar".

-- ------------------------------------------------------------
-- 1) Esquema
-- ------------------------------------------------------------
alter table public.cupones add column if not exists edad_maxima integer;
alter table public.cupones drop constraint if exists cupones_porcentaje_chk;
alter table public.cupones
  add constraint cupones_porcentaje_chk check (porcentaje_descuento > 0 and porcentaje_descuento <= 100) not valid;
alter table public.cupones drop constraint if exists cupones_edades_chk;
alter table public.cupones
  add constraint cupones_edades_chk
  check (edad_minima is null or edad_maxima is null or edad_minima <= edad_maxima) not valid;

-- Un único cupón de bienvenida: su porcentaje es el que configura el admin.
create unique index if not exists cupones_un_solo_bienvenida
  on public.cupones (tipo) where tipo = 'bienvenida';

insert into public.cupones (codigo, tipo, porcentaje_descuento, activo)
values ('BIENVENIDA', 'bienvenida', 20, true)
on conflict do nothing;

alter table public.compras add column if not exists subtotal numeric(10, 2);
alter table public.compras add column if not exists descuento_porcentaje numeric(5, 2) not null default 0;
alter table public.compras add column if not exists descuento_monto numeric(10, 2) not null default 0;
alter table public.compras add column if not exists puntos_ganados integer not null default 0;
alter table public.compras add column if not exists puntos_canjeados integer not null default 0;

alter table public.compra_entradas add column if not exists canjeada_con_puntos boolean not null default false;
alter table public.compra_candy_items add column if not exists recompensa_id uuid references public.recompensas_puntos (id);

alter table public.recompensas_puntos drop constraint if exists recompensas_tipo_chk;
alter table public.recompensas_puntos
  add constraint recompensas_tipo_chk
  check ((otorga_entrada and candy_producto_id is null) or (not otorga_entrada and candy_producto_id is not null)) not valid;
alter table public.recompensas_puntos drop constraint if exists recompensas_costo_chk;
alter table public.recompensas_puntos
  add constraint recompensas_costo_chk check (costo_puntos > 0) not valid;

alter table public.canjes_puntos add column if not exists compra_id uuid references public.compras (id) on delete set null;
alter table public.canjes_puntos add column if not exists cantidad integer not null default 1;

-- Historial de puntos para el perfil: + por compra, − por canje, y las
-- reversiones al cancelar.
create table if not exists public.movimientos_puntos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  compra_id uuid references public.compras (id) on delete set null,
  puntos integer not null,
  motivo text not null check (motivo in ('compra', 'canje', 'anulacion_compra', 'devolucion_canje')),
  detalle text,
  created_at timestamptz not null default now()
);

alter table public.movimientos_puntos enable row level security;
drop policy if exists "movimientos_puntos_select_own_or_admin" on public.movimientos_puntos;
create policy "movimientos_puntos_select_own_or_admin" on public.movimientos_puntos
  for select using (usuario_id = auth.uid() or public.is_admin());

-- Los códigos de cupón no deben poder listarse desde el navegador: sólo el
-- admin los ve; el cliente los valida con consultar_descuento().
drop policy if exists "cupones_select_all" on public.cupones;

-- Usos de cupón y canjes sólo los escriben las funciones de compra.
drop policy if exists "cupon_usos_insert_own" on public.cupon_usos;
drop policy if exists "canjes_insert_own" on public.canjes_puntos;

-- ------------------------------------------------------------
-- 2) Protección de saldos (crédito y puntos)
-- ------------------------------------------------------------
-- El cliente no puede tocar su crédito ni sus puntos. Las funciones de
-- compra y cancelación los modifican marcando app.movimiento_saldo sólo
-- durante su propia transacción.
create or replace function public.proteger_campos_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saldo_autorizado boolean :=
    coalesce(current_setting('app.movimiento_saldo', true), 'off') = 'on'
    or coalesce(current_setting('app.movimiento_credito', true), 'off') = 'on';
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.id is distinct from old.id
      or new.email is distinct from old.email
      or new.rol is distinct from old.rol
      or (new.puntos is distinct from old.puntos and not v_saldo_autorizado)
      or (new.credito is distinct from old.credito and not v_saldo_autorizado) then
      raise exception 'No tenés permiso para modificar campos protegidos del perfil.';
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3) Descuento aplicable (bienvenida o cupón)
-- ------------------------------------------------------------
-- Uso interno: la llaman consultar_descuento (vista previa) y la compra.
-- Devuelve el mayor descuento válido y, si se ingresó un código que no
-- sirve, el motivo en error_cupon.
create or replace function public.resolver_descuento(p_usuario_id uuid, p_codigo text)
returns table (
  cupon_id uuid,
  codigo text,
  origen text,
  porcentaje numeric,
  porcentaje_bienvenida numeric,
  error_cupon text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_bienvenida public.cupones%rowtype;
  v_cupon public.cupones%rowtype;
  v_pct_bienvenida numeric := 0;
  v_pct_cupon numeric := 0;
  v_error text;
  v_nacimiento date;
  v_edad integer;
  v_usos integer;
begin
  if p_usuario_id is null then
    if v_codigo <> '' then
      v_error := 'Los cupones son para usuarios registrados. Iniciá sesión para usarlo.';
    end if;
    return query select null::uuid, null::text, null::text, 0::numeric, 0::numeric, v_error;
    return;
  end if;

  -- Bienvenida: activa y el usuario no tiene ninguna compra confirmada.
  select * into v_bienvenida from public.cupones where tipo = 'bienvenida' and activo limit 1;
  if found and not exists (
    select 1 from public.compras where usuario_id = p_usuario_id and estado = 'confirmada'
  ) then
    v_pct_bienvenida := v_bienvenida.porcentaje_descuento;
  end if;

  if v_codigo <> '' then
    select * into v_cupon from public.cupones where upper(codigo) = v_codigo and tipo <> 'bienvenida';

    if not found then
      v_error := 'El cupón no existe.';
    elsif not v_cupon.activo then
      v_error := 'El cupón no está activo.';
    elsif v_hoy < v_cupon.fecha_desde then
      v_error := 'El cupón todavía no está vigente.';
    elsif v_cupon.fecha_hasta is not null and v_hoy > v_cupon.fecha_hasta then
      v_error := 'El cupón está vencido.';
    else
      select count(*) into v_usos
      from public.cupon_usos cu
      join public.compras c on c.id = cu.compra_id and c.estado = 'confirmada'
      where cu.cupon_id = v_cupon.id;

      if v_cupon.usos_maximos is not null and v_usos >= v_cupon.usos_maximos then
        v_error := 'El cupón ya alcanzó su límite de usos.';
      elsif exists (
        select 1 from public.cupon_usos cu
        join public.compras c on c.id = cu.compra_id and c.estado = 'confirmada'
        where cu.cupon_id = v_cupon.id and cu.usuario_id = p_usuario_id
      ) then
        v_error := 'Ya usaste este cupón.';
      elsif v_cupon.tipo = 'segmentado_edad' then
        select fecha_nacimiento into v_nacimiento from public.usuarios where id = p_usuario_id;
        if v_nacimiento is null then
          v_error := 'Este cupón requiere tener cargada la fecha de nacimiento.';
        else
          v_edad := date_part('year', age(v_hoy, v_nacimiento));
          if (v_cupon.edad_minima is not null and v_edad < v_cupon.edad_minima)
            or (v_cupon.edad_maxima is not null and v_edad > v_cupon.edad_maxima) then
            v_error := 'Este cupón no corresponde a tu rango de edad.';
          end if;
        end if;
      end if;
    end if;

    if v_error is null then
      v_pct_cupon := v_cupon.porcentaje_descuento;
    end if;
  end if;

  if v_pct_cupon > 0 and v_pct_cupon >= v_pct_bienvenida then
    return query select v_cupon.id, v_cupon.codigo, 'cupon'::text, v_pct_cupon, v_pct_bienvenida, v_error;
  elsif v_pct_bienvenida > 0 then
    return query select v_bienvenida.id, v_bienvenida.codigo, 'bienvenida'::text, v_pct_bienvenida, v_pct_bienvenida, v_error;
  else
    return query select null::uuid, null::text, null::text, 0::numeric, 0::numeric, v_error;
  end if;
end;
$$;

revoke all on function public.resolver_descuento(uuid, text) from public, anon, authenticated;

-- Vista previa para la pantalla de compra y el perfil.
create or replace function public.consultar_descuento(p_codigo text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'origen', r.origen,
    'codigo', r.codigo,
    'porcentaje', r.porcentaje,
    'porcentaje_bienvenida', r.porcentaje_bienvenida,
    'error_cupon', r.error_cupon
  )
  from public.resolver_descuento(auth.uid(), p_codigo) r;
$$;

revoke all on function public.consultar_descuento(text) from public;
grant execute on function public.consultar_descuento(text) to anon, authenticated;

-- ------------------------------------------------------------
-- 4) Compra
-- ------------------------------------------------------------
drop function if exists public.crear_compra_entradas(uuid, uuid[], jsonb);
drop function if exists public.crear_compra_entradas(uuid, uuid[], jsonb, boolean);

-- p_items:   [{ "tipo": "producto" | "combo", "id": "<uuid>", "cantidad": n }]
-- p_canjes:  [{ "id": "<recompensa uuid>", "cantidad": n }]
create or replace function public.crear_compra_entradas(
  p_funcion_id uuid,
  p_butaca_ids uuid[],
  p_items jsonb default '[]'::jsonb,
  p_usar_credito boolean default false,
  p_codigo_cupon text default null,
  p_canjes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_funcion record;
  v_usuario_id uuid := auth.uid();
  v_usuario record;
  v_edad_minima integer := 0;
  v_precio_base numeric(10, 2);
  v_precio_vip numeric(10, 2);
  v_subtotal numeric(10, 2);
  v_descuento record;
  v_descuento_monto numeric(10, 2) := 0;
  v_total numeric(10, 2);
  v_credito_usado numeric(10, 2) := 0;
  v_a_pagar numeric(10, 2);
  v_puntos_ganados integer := 0;
  v_puntos_canje integer := 0;
  v_compra_id uuid;
  v_codigo_qr text := gen_random_uuid()::text;
  v_cantidad_butacas integer;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_canjes jsonb := coalesce(p_canjes, '[]'::jsonb);
  v_pedidos integer;
  v_validos integer;
  v_combos_con_entrada integer;
  v_canjes_entrada integer;
  v_entradas jsonb;
  v_candy jsonb;
begin
  -- ---------- Butacas ----------
  if coalesce(cardinality(p_butaca_ids), 0) = 0 then
    raise exception 'Elegí al menos una butaca.';
  end if;

  if cardinality(p_butaca_ids) <> (
    select count(distinct asiento_id) from unnest(p_butaca_ids) as asiento(asiento_id)
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

  if v_usuario_id is not null then
    -- Se bloquea la fila del usuario: crédito y puntos no pueden usarse dos
    -- veces en compras simultáneas.
    select id, fecha_nacimiento, credito, puntos into v_usuario
    from public.usuarios where id = v_usuario_id
    for update;

    -- Sólo se bloquea si se CONOCE la fecha de nacimiento y no alcanza.
    if v_edad_minima > 0 and v_usuario.fecha_nacimiento is not null
      and date_part('year', age(current_date, v_usuario.fecha_nacimiento)) < v_edad_minima then
      raise exception 'No cumplís la edad mínima para esta película.';
    end if;
  end if;

  select count(*) into v_cantidad_butacas
  from public.butacas
  where sala_id = v_funcion.sala_id and id = any(p_butaca_ids);

  if v_cantidad_butacas <> cardinality(p_butaca_ids) then
    raise exception 'Una o más butacas no pertenecen a la sala de esta función.';
  end if;

  -- ---------- Candy Bar ----------
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_canjes) <> 'array' then
    raise exception 'Formato inválido del pedido.';
  end if;

  create temporary table if not exists tmp_candy_pedido (
    tipo text not null,
    item_id uuid not null,
    cantidad integer not null
  ) on commit drop;
  truncate tmp_candy_pedido;

  create temporary table if not exists tmp_canje_pedido (
    recompensa_id uuid not null,
    cantidad integer not null
  ) on commit drop;
  truncate tmp_canje_pedido;

  begin
    insert into tmp_candy_pedido (tipo, item_id, cantidad)
    select item ->> 'tipo', (item ->> 'id')::uuid, sum((item ->> 'cantidad')::integer)
    from jsonb_array_elements(v_items) as item
    group by item ->> 'tipo', (item ->> 'id')::uuid;

    insert into tmp_canje_pedido (recompensa_id, cantidad)
    select (item ->> 'id')::uuid, sum((item ->> 'cantidad')::integer)
    from jsonb_array_elements(v_canjes) as item
    group by (item ->> 'id')::uuid;
  exception
    when invalid_text_representation or numeric_value_out_of_range or not_null_violation then
      raise exception 'Formato inválido del pedido.';
  end;

  if exists (select 1 from tmp_candy_pedido where tipo not in ('producto', 'combo')) then
    raise exception 'Formato inválido de productos del Candy Bar.';
  end if;

  if exists (select 1 from tmp_candy_pedido where cantidad < 1 or cantidad > 20)
    or exists (select 1 from tmp_canje_pedido where cantidad < 1 or cantidad > 20) then
    raise exception 'Cada producto admite entre 1 y 20 unidades por compra.';
  end if;

  select count(*) into v_pedidos from tmp_candy_pedido;
  select count(*) into v_validos
  from tmp_candy_pedido t
  where (t.tipo = 'producto' and exists (
          select 1 from public.candy_productos cp where cp.id = t.item_id and cp.activo))
     or (t.tipo = 'combo' and exists (
          select 1 from public.combos c where c.id = t.item_id and c.activo));

  if v_validos <> v_pedidos then
    raise exception 'Uno o más productos del Candy Bar ya no están disponibles. Actualizá la página.';
  end if;

  select coalesce(sum(t.cantidad), 0) into v_combos_con_entrada
  from tmp_candy_pedido t
  join public.combos c on c.id = t.item_id
  where t.tipo = 'combo' and c.incluye_entrada;

  -- ---------- Canjes de puntos ----------
  if exists (select 1 from tmp_canje_pedido) then
    if v_usuario_id is null then
      raise exception 'Los canjes de puntos son para usuarios registrados.';
    end if;

    select count(*) into v_pedidos from tmp_canje_pedido;
    select count(*) into v_validos
    from tmp_canje_pedido t
    join public.recompensas_puntos r on r.id = t.recompensa_id and r.activo
    left join public.candy_productos cp on cp.id = r.candy_producto_id
    where r.otorga_entrada or cp.activo;

    if v_validos <> v_pedidos then
      raise exception 'Una o más recompensas ya no están disponibles. Actualizá la página.';
    end if;

    select coalesce(sum(t.cantidad * r.costo_puntos), 0) into v_puntos_canje
    from tmp_canje_pedido t join public.recompensas_puntos r on r.id = t.recompensa_id;

    if v_puntos_canje > v_usuario.puntos then
      raise exception 'No te alcanzan los puntos: el canje cuesta % y tenés %.', v_puntos_canje, v_usuario.puntos;
    end if;
  end if;

  select coalesce(sum(t.cantidad), 0) into v_canjes_entrada
  from tmp_canje_pedido t
  join public.recompensas_puntos r on r.id = t.recompensa_id
  where r.otorga_entrada;

  if v_combos_con_entrada + v_canjes_entrada > v_cantidad_butacas then
    raise exception 'Tenés % entrada(s) cubiertas por combos o canjes pero sólo % butaca(s). Cada una necesita una butaca.',
      v_combos_con_entrada + v_canjes_entrada, v_cantidad_butacas;
  end if;

  -- ---------- Descuento (antes de crear la compra) ----------
  -- Se resuelve antes del insert: la bienvenida mira si el usuario ya tiene
  -- compras confirmadas, y la compra actual todavía no debe contar.
  select * into v_descuento from public.resolver_descuento(v_usuario_id, p_codigo_cupon);

  -- Un código ingresado que no sirve se informa (no se ignora en silencio).
  if coalesce(trim(p_codigo_cupon), '') <> '' and v_descuento.error_cupon is not null then
    raise exception '%', v_descuento.error_cupon;
  end if;

  -- ---------- Alta de la compra ----------
  insert into public.compras (usuario_id, total, estado, codigo_qr)
  values (v_usuario_id, 0, 'confirmada', v_codigo_qr)
  returning id into v_compra_id;

  -- Butacas ordenadas (no VIP primero): las primeras las cubren los combos
  -- con entrada, las siguientes los canjes de entrada. Una butaca cubierta
  -- cuesta 0, o sólo el recargo si es VIP.
  insert into public.compra_entradas
    (compra_id, funcion_id, butaca_id, precio, incluida_en_combo, canjeada_con_puntos)
  select v_compra_id, p_funcion_id, b.id,
         case
           when b.orden <= v_combos_con_entrada + v_canjes_entrada then
             case when b.tipo = 'vip' then v_precio_vip - v_precio_base else 0 end
           else
             case when b.tipo = 'vip' then v_precio_vip else v_precio_base end
         end,
         b.orden <= v_combos_con_entrada,
         b.orden > v_combos_con_entrada and b.orden <= v_combos_con_entrada + v_canjes_entrada
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

  -- Productos canjeados: van al Candy Bar a $0, marcados con la recompensa.
  insert into public.compra_candy_items (compra_id, candy_producto_id, cantidad, precio_unitario, recompensa_id)
  select v_compra_id, r.candy_producto_id, t.cantidad, 0, r.id
  from tmp_canje_pedido t
  join public.recompensas_puntos r on r.id = t.recompensa_id
  where not r.otorga_entrada;

  -- ---------- Totales ----------
  select coalesce(sum(precio), 0) into v_subtotal
  from public.compra_entradas where compra_id = v_compra_id;

  v_subtotal := v_subtotal + (
    select coalesce(sum(cantidad * precio_unitario), 0)
    from public.compra_candy_items where compra_id = v_compra_id
  );

  v_descuento_monto := round(v_subtotal * coalesce(v_descuento.porcentaje, 0) / 100, 2);
  v_total := v_subtotal - v_descuento_monto;

  -- ---------- Saldos del usuario: canje, crédito y puntos ----------
  if v_usuario_id is not null then
    perform set_config('app.movimiento_saldo', 'on', true);

    if v_puntos_canje > 0 then
      update public.usuarios set puntos = puntos - v_puntos_canje where id = v_usuario_id;

      insert into public.canjes_puntos (usuario_id, recompensa_id, puntos_utilizados, compra_id, cantidad)
      select v_usuario_id, r.id, t.cantidad * r.costo_puntos, v_compra_id, t.cantidad
      from tmp_canje_pedido t join public.recompensas_puntos r on r.id = t.recompensa_id;

      insert into public.movimientos_puntos (usuario_id, compra_id, puntos, motivo, detalle)
      values (v_usuario_id, v_compra_id, -v_puntos_canje, 'canje', (
        select string_agg(t.cantidad || 'x ' || r.nombre, ', ' order by r.nombre)
        from tmp_canje_pedido t join public.recompensas_puntos r on r.id = t.recompensa_id
      ));
    end if;

    if p_usar_credito then
      v_credito_usado := least(coalesce(v_usuario.credito, 0), v_total);
      if v_credito_usado > 0 then
        update public.usuarios set credito = credito - v_credito_usado where id = v_usuario_id;
        insert into public.movimientos_credito (usuario_id, compra_id, monto, motivo)
        values (v_usuario_id, v_compra_id, -v_credito_usado, 'uso_en_compra');
      end if;
    end if;

    v_a_pagar := v_total - v_credito_usado;

    -- 1 punto por cada $1 abonado con otros medios.
    v_puntos_ganados := floor(v_a_pagar);
    if v_puntos_ganados > 0 then
      update public.usuarios set puntos = puntos + v_puntos_ganados where id = v_usuario_id;
      insert into public.movimientos_puntos (usuario_id, compra_id, puntos, motivo)
      values (v_usuario_id, v_compra_id, v_puntos_ganados, 'compra');
    end if;

    if v_descuento.cupon_id is not null then
      insert into public.cupon_usos (cupon_id, usuario_id, compra_id)
      values (v_descuento.cupon_id, v_usuario_id, v_compra_id);
    end if;

    perform set_config('app.movimiento_saldo', 'off', true);
  else
    v_a_pagar := v_total;
  end if;

  update public.compras
  set subtotal = v_subtotal,
      cupon_id = v_descuento.cupon_id,
      descuento_porcentaje = coalesce(v_descuento.porcentaje, 0),
      descuento_monto = v_descuento_monto,
      total = v_total,
      credito_usado = v_credito_usado,
      metodo_pago = case
        when v_a_pagar = 0 and v_credito_usado > 0 then 'credito'
        when v_credito_usado > 0 then 'credito+otro'
        else 'otro'
      end,
      puntos_ganados = v_puntos_ganados,
      puntos_canjeados = v_puntos_canje
  where id = v_compra_id;

  -- ---------- Detalle para el comprobante ----------
  select coalesce(jsonb_agg(jsonb_build_object(
           'butaca_id', b.id,
           'ubicacion', b.fila || '-' || b.columna,
           'tipo', b.tipo,
           'precio', ce.precio,
           'incluida_en_combo', ce.incluida_en_combo,
           'canjeada_con_puntos', ce.canjeada_con_puntos
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
           'incluye_entrada', coalesce(c.incluye_entrada, false),
           'canje', i.recompensa_id is not null
         ) order by (i.combo_id is null), (i.recompensa_id is not null), coalesce(c.nombre, cp.nombre)), '[]'::jsonb)
  into v_candy
  from public.compra_candy_items i
  left join public.combos c on c.id = i.combo_id
  left join public.candy_productos cp on cp.id = i.candy_producto_id
  where i.compra_id = v_compra_id;

  return jsonb_build_object(
    'compra_id', v_compra_id,
    'codigo_qr', v_codigo_qr,
    'codigo_corto', (select codigo_corto from public.compras where id = v_compra_id),
    'subtotal', v_subtotal,
    'descuento_origen', v_descuento.origen,
    'descuento_codigo', v_descuento.codigo,
    'descuento_porcentaje', coalesce(v_descuento.porcentaje, 0),
    'descuento_monto', v_descuento_monto,
    'total', v_total,
    'credito_usado', v_credito_usado,
    'a_pagar', v_a_pagar,
    'puntos_ganados', v_puntos_ganados,
    'puntos_canjeados', v_puntos_canje,
    'entradas', v_entradas,
    'candy', v_candy
  );
exception
  when unique_violation then
    raise exception 'Una o más butacas ya fueron vendidas. Elegí otras y volvé a intentar.';
end;
$$;

revoke all on function public.crear_compra_entradas(uuid, uuid[], jsonb, boolean, text, jsonb) from public;
grant execute on function public.crear_compra_entradas(uuid, uuid[], jsonb, boolean, text, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- 5) Cancelación: además del crédito, revierte los puntos
-- ------------------------------------------------------------
-- Se devuelven los puntos canjeados y se descuentan los ganados. Si el
-- usuario ya gastó los puntos que le dio esta compra, no se puede cancelar
-- (si no, podría comprar, canjear los puntos y cancelar).
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
  v_puntos_actuales integer;
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

  select puntos into v_puntos_actuales from public.usuarios where id = v_usuario_id for update;

  if v_puntos_actuales + v_compra.puntos_canjeados - v_compra.puntos_ganados < 0 then
    raise exception 'No se puede cancelar: ya usaste los % puntos que sumaste con esta compra.', v_compra.puntos_ganados;
  end if;

  update public.compras
  set estado = 'cancelada',
      cancelada_at = now(),
      qr_vigente = false
  where id = v_compra.id;

  update public.compra_entradas set activa = false where compra_id = v_compra.id;

  perform set_config('app.movimiento_saldo', 'on', true);

  if v_compra.total > 0 then
    update public.usuarios set credito = credito + v_compra.total where id = v_usuario_id;
    insert into public.movimientos_credito (usuario_id, compra_id, monto, motivo)
    values (v_usuario_id, v_compra.id, v_compra.total, 'cancelacion');
  end if;

  if v_compra.puntos_canjeados > 0 or v_compra.puntos_ganados > 0 then
    update public.usuarios
    set puntos = puntos + v_compra.puntos_canjeados - v_compra.puntos_ganados
    where id = v_usuario_id;

    if v_compra.puntos_canjeados > 0 then
      insert into public.movimientos_puntos (usuario_id, compra_id, puntos, motivo)
      values (v_usuario_id, v_compra.id, v_compra.puntos_canjeados, 'devolucion_canje');
    end if;
    if v_compra.puntos_ganados > 0 then
      insert into public.movimientos_puntos (usuario_id, compra_id, puntos, motivo)
      values (v_usuario_id, v_compra.id, -v_compra.puntos_ganados, 'anulacion_compra');
    end if;
  end if;

  perform set_config('app.movimiento_saldo', 'off', true);

  select credito into v_credito_total from public.usuarios where id = v_usuario_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (v_usuario_id, 'COMPRA_CANCELADA', 'compras', v_compra.id,
          jsonb_build_object('codigo_corto', v_compra.codigo_corto,
                             'credito_otorgado', v_compra.total,
                             'puntos_revertidos', v_compra.puntos_ganados,
                             'puntos_devueltos', v_compra.puntos_canjeados));

  return jsonb_build_object(
    'compra_id', v_compra.id,
    'credito_otorgado', v_compra.total,
    'credito_total', v_credito_total,
    'puntos_revertidos', v_compra.puntos_ganados,
    'puntos_devueltos', v_compra.puntos_canjeados
  );
end;
$$;

revoke all on function public.cancelar_compra(uuid) from public;
grant execute on function public.cancelar_compra(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6) Auditoría de cambios en cupones y recompensas
-- ------------------------------------------------------------
drop trigger if exists auditar_cupones on public.cupones;
create trigger auditar_cupones
after insert or update or delete on public.cupones
for each row execute function public.registrar_auditoria();

drop trigger if exists auditar_recompensas on public.recompensas_puntos;
create trigger auditar_recompensas
after insert or update or delete on public.recompensas_puntos
for each row execute function public.registrar_auditoria();
