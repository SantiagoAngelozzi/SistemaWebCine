create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  created_at timestamptz not null default now(),
  constraint roles_nombre_chk check (char_length(trim(nombre)) between 2 and 60)
);

create unique index if not exists roles_nombre_key on public.roles (lower(trim(nombre)));

create table if not exists public.rol_permisos (
  rol_id uuid not null references public.roles (id) on delete cascade,
  seccion text not null check (
    seccion in ('peliculas', 'salas_funciones', 'candy', 'cupones', 'reportes', 'auditoria', 'propuestas')
  ),
  primary key (rol_id, seccion)
);

alter table public.usuarios
  add column if not exists rol_personalizado_id uuid references public.roles (id) on delete set null;

alter table public.roles enable row level security;
alter table public.rol_permisos enable row level security;

drop policy if exists "roles_select_autenticados" on public.roles;
create policy "roles_select_autenticados" on public.roles
  for select to authenticated using (true);
drop policy if exists "roles_admin_write" on public.roles;
create policy "roles_admin_write" on public.roles
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "rol_permisos_select_autenticados" on public.rol_permisos;
create policy "rol_permisos_select_autenticados" on public.rol_permisos
  for select to authenticated using (true);
drop policy if exists "rol_permisos_admin_write" on public.rol_permisos;
create policy "rol_permisos_admin_write" on public.rol_permisos
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.tiene_permiso(p_seccion text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.usuarios u
    join public.rol_permisos rp on rp.rol_id = u.rol_personalizado_id
    where u.id = auth.uid()
      and u.rol = 'cliente'
      and rp.seccion = p_seccion
  );
$$;

revoke all on function public.tiene_permiso(text) from public;
grant execute on function public.tiene_permiso(text) to anon, authenticated;

create or replace function public.mis_permisos()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_usuario record;
begin
  if auth.uid() is null then
    return jsonb_build_object('es_admin', false, 'rol', null, 'secciones', '[]'::jsonb);
  end if;

  select u.rol, r.nombre as rol_nombre
  into v_usuario
  from public.usuarios u
  left join public.roles r on r.id = u.rol_personalizado_id
  where u.id = auth.uid();

  if v_usuario.rol = 'administrador' then
    return jsonb_build_object(
      'es_admin', true,
      'rol', 'Administrador',
      'secciones', '["peliculas","salas_funciones","candy","cupones","reportes","auditoria","propuestas","empleados","roles"]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'es_admin', false,
    'rol', case when v_usuario.rol = 'cliente' then v_usuario.rol_nombre end,
    'secciones', coalesce((
      select jsonb_agg(rp.seccion order by rp.seccion)
      from public.usuarios u
      join public.rol_permisos rp on rp.rol_id = u.rol_personalizado_id
      where u.id = auth.uid() and u.rol = 'cliente'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.mis_permisos() from public;
grant execute on function public.mis_permisos() to anon, authenticated;

create or replace function public.guardar_rol(
  p_rol_id uuid,
  p_nombre text,
  p_descripcion text,
  p_secciones text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol_id uuid := p_rol_id;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede gestionar roles.';
  end if;

  if coalesce(cardinality(p_secciones), 0) = 0 then
    raise exception 'El rol tiene que dar acceso al menos a una sección.';
  end if;

  if v_rol_id is null then
    insert into public.roles (nombre, descripcion)
    values (trim(p_nombre), nullif(trim(coalesce(p_descripcion, '')), ''))
    returning id into v_rol_id;
  else
    update public.roles
    set nombre = trim(p_nombre),
        descripcion = nullif(trim(coalesce(p_descripcion, '')), '')
    where id = v_rol_id;

    if not found then
      raise exception 'El rol no existe.';
    end if;

    delete from public.rol_permisos where rol_id = v_rol_id;
  end if;

  insert into public.rol_permisos (rol_id, seccion)
  select distinct v_rol_id, s from unnest(p_secciones) as s;

  return v_rol_id;
exception
  when unique_violation then
    raise exception 'Ya existe un rol con ese nombre.';
  when check_violation then
    raise exception 'Revisá el nombre del rol (2 a 60 caracteres) y las secciones elegidas.';
end;
$$;

revoke all on function public.guardar_rol(uuid, text, text, text[]) from public, anon;
grant execute on function public.guardar_rol(uuid, text, text, text[]) to authenticated;

create or replace function public.asignar_rol_personalizado(p_usuario_id uuid, p_rol_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario record;
  v_rol_anterior text;
  v_rol_nuevo text;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede asignar roles.';
  end if;

  select u.id, u.rol, u.rol_personalizado_id into v_usuario
  from public.usuarios u
  where u.id = p_usuario_id
  for update;

  if not found then
    raise exception 'El usuario no existe.';
  end if;

  if v_usuario.rol <> 'cliente' then
    raise exception 'Los roles personalizados se asignan sólo a usuarios con rol cliente.';
  end if;

  if p_rol_id is not null and not exists (select 1 from public.roles where id = p_rol_id) then
    raise exception 'El rol no existe.';
  end if;

  if v_usuario.rol_personalizado_id is not distinct from p_rol_id then
    return;
  end if;

  select nombre into v_rol_anterior from public.roles where id = v_usuario.rol_personalizado_id;
  select nombre into v_rol_nuevo from public.roles where id = p_rol_id;

  update public.usuarios set rol_personalizado_id = p_rol_id where id = p_usuario_id;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    auth.uid(), 'ROL_ASIGNADO', 'usuarios', p_usuario_id,
    jsonb_build_object('rol_anterior', coalesce(v_rol_anterior, 'sin rol'), 'rol_nuevo', coalesce(v_rol_nuevo, 'sin rol'))
  );
end;
$$;

revoke all on function public.asignar_rol_personalizado(uuid, uuid) from public, anon;
grant execute on function public.asignar_rol_personalizado(uuid, uuid) to authenticated;

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
      or new.rol_personalizado_id is distinct from old.rol_personalizado_id
      or (new.puntos is distinct from old.puntos and not v_saldo_autorizado)
      or (new.credito is distinct from old.credito and not v_saldo_autorizado) then
      raise exception 'No tenés permiso para modificar campos protegidos del perfil.';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "generos_admin_write" on public.generos;
create policy "generos_admin_write" on public.generos
  for all using (public.tiene_permiso('peliculas')) with check (public.tiene_permiso('peliculas'));

drop policy if exists "peliculas_admin_write" on public.peliculas;
create policy "peliculas_admin_write" on public.peliculas
  for all using (public.tiene_permiso('peliculas')) with check (public.tiene_permiso('peliculas'));

drop policy if exists "pelicula_generos_admin_write" on public.pelicula_generos;
create policy "pelicula_generos_admin_write" on public.pelicula_generos
  for all using (public.tiene_permiso('peliculas')) with check (public.tiene_permiso('peliculas'));

drop policy if exists "pelicula_formatos_admin_write" on public.pelicula_formatos;
create policy "pelicula_formatos_admin_write" on public.pelicula_formatos
  for all using (public.tiene_permiso('peliculas')) with check (public.tiene_permiso('peliculas'));

drop policy if exists "salas_admin_write" on public.salas;
create policy "salas_admin_write" on public.salas
  for all using (public.tiene_permiso('salas_funciones')) with check (public.tiene_permiso('salas_funciones'));

drop policy if exists "butacas_admin_write" on public.butacas;
create policy "butacas_admin_write" on public.butacas
  for all using (public.tiene_permiso('salas_funciones')) with check (public.tiene_permiso('salas_funciones'));

drop policy if exists "funciones_admin_write" on public.funciones;
create policy "funciones_admin_write" on public.funciones
  for all using (public.tiene_permiso('salas_funciones')) with check (public.tiene_permiso('salas_funciones'));

drop policy if exists "candy_categorias_admin_write" on public.candy_categorias;
create policy "candy_categorias_admin_write" on public.candy_categorias
  for all using (public.tiene_permiso('candy')) with check (public.tiene_permiso('candy'));

drop policy if exists "candy_productos_admin_write" on public.candy_productos;
create policy "candy_productos_admin_write" on public.candy_productos
  for all using (public.tiene_permiso('candy')) with check (public.tiene_permiso('candy'));

drop policy if exists "combos_admin_write" on public.combos;
create policy "combos_admin_write" on public.combos
  for all using (public.tiene_permiso('candy')) with check (public.tiene_permiso('candy'));

drop policy if exists "combo_productos_admin_write" on public.combo_productos;
create policy "combo_productos_admin_write" on public.combo_productos
  for all using (public.tiene_permiso('candy')) with check (public.tiene_permiso('candy'));

drop policy if exists "cupones_admin_write" on public.cupones;
create policy "cupones_admin_write" on public.cupones
  for all using (public.tiene_permiso('cupones')) with check (public.tiene_permiso('cupones'));

drop policy if exists "recompensas_admin_write" on public.recompensas_puntos;
create policy "recompensas_admin_write" on public.recompensas_puntos
  for all using (public.tiene_permiso('cupones')) with check (public.tiene_permiso('cupones'));

drop policy if exists "cupon_usos_select_staff" on public.cupon_usos;
create policy "cupon_usos_select_staff" on public.cupon_usos
  for select using (public.tiene_permiso('cupones'));

drop policy if exists "compras_select_staff" on public.compras;
create policy "compras_select_staff" on public.compras
  for select using (public.tiene_permiso('cupones'));

drop policy if exists "log_auditoria_select_admin" on public.log_auditoria;
create policy "log_auditoria_select_admin" on public.log_auditoria
  for select using (public.tiene_permiso('auditoria'));

drop policy if exists "usuarios_select_staff" on public.usuarios;
create policy "usuarios_select_staff" on public.usuarios
  for select using (public.tiene_permiso('auditoria') or public.tiene_permiso('propuestas'));

drop trigger if exists auditar_roles on public.roles;
create trigger auditar_roles
after insert or update or delete on public.roles
for each row execute function public.registrar_auditoria();

create or replace function public.eliminar_funcion(p_funcion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendidas integer;
  v_canceladas integer;
begin
  if not public.tiene_permiso('salas_funciones') then
    raise exception 'No tenés permiso para eliminar funciones.';
  end if;

  if not exists (select 1 from public.funciones where id = p_funcion_id) then
    raise exception 'La función no existe (quizás ya se eliminó).';
  end if;

  select count(*) filter (where activa), count(*) filter (where not activa)
    into v_vendidas, v_canceladas
  from public.compra_entradas
  where funcion_id = p_funcion_id;

  if v_vendidas > 0 then
    raise exception 'No se puede eliminar: la función tiene % entrada(s) vendida(s). Las compras forman parte del historial y de los reportes.', v_vendidas;
  end if;

  if v_canceladas > 0 then
    raise exception 'No se puede eliminar: la función tiene % entrada(s) de compras canceladas, que siguen en el historial (crédito otorgado).', v_canceladas;
  end if;

  delete from public.funciones where id = p_funcion_id;
end;
$$;

revoke all on function public.eliminar_funcion(uuid) from public;
grant execute on function public.eliminar_funcion(uuid) to authenticated;

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
  if not public.tiene_permiso('candy') then
    raise exception 'No tenés permiso para gestionar combos.';
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

create or replace function public.reporte_facturacion(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'America/Argentina/Buenos_Aires';
  v_resultado jsonb;
begin
  if not public.tiene_permiso('reportes') then
    raise exception 'No tenés permiso para ver los reportes.';
  end if;

  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'El rango de fechas no es válido.';
  end if;

  if p_hasta - p_desde > 366 then
    raise exception 'El rango puede ser de hasta un año.';
  end if;

  with
  compras_validas as (
    select
      c.id,
      (c.created_at at time zone v_tz)::date as dia,
      c.total,
      coalesce(c.subtotal, c.total + c.descuento_monto) as subtotal,
      c.descuento_monto,
      c.credito_usado
    from public.compras c
    where c.estado <> 'cancelada'
      and (c.created_at at time zone v_tz)::date between least(p_desde, p_hasta - 29) and p_hasta
  ),
  en_rango as (
    select * from compras_validas where dia between p_desde and p_hasta
  ),
  entradas as (
    select cv.dia, ce.precio, f.pelicula_id
    from compras_validas cv
    join public.compra_entradas ce on ce.compra_id = cv.id and ce.activa
    join public.funciones f on f.id = ce.funcion_id
  ),
  candy as (
    select cv.dia, ci.candy_producto_id, ci.combo_id, ci.cantidad, ci.precio_unitario
    from en_rango cv
    join public.compra_candy_items ci on ci.compra_id = cv.id
  ),
  dias as (
    select d::date as dia from generate_series(p_desde, p_hasta, interval '1 day') d
  ),
  por_dia as (
    select
      d.dia,
      coalesce(cmp.compras, 0) as compras,
      coalesce(ent.entradas, 0) as entradas,
      coalesce(cmp.subtotal, 0) as subtotal,
      coalesce(cmp.descuentos, 0) as descuentos,
      coalesce(cmp.facturacion, 0) as facturacion,
      coalesce(cmp.credito, 0) as credito,
      coalesce(cmp.facturacion, 0) - coalesce(cmp.credito, 0) as cobrado,
      coalesce(cnd.candy, 0) as candy,
      coalesce(cnc.canceladas, 0) as canceladas
    from dias d
    left join (
      select dia, count(*) as compras, sum(subtotal) as subtotal, sum(descuento_monto) as descuentos,
             sum(total) as facturacion, sum(credito_usado) as credito
      from en_rango group by dia
    ) cmp on cmp.dia = d.dia
    left join (select dia, count(*) as entradas from entradas group by dia) ent on ent.dia = d.dia
    left join (select dia, sum(cantidad * precio_unitario) as candy from candy group by dia) cnd on cnd.dia = d.dia
    left join (
      select (c.created_at at time zone v_tz)::date as dia, count(*) as canceladas
      from public.compras c
      where c.estado = 'cancelada'
        and (c.created_at at time zone v_tz)::date between p_desde and p_hasta
      group by 1
    ) cnc on cnc.dia = d.dia
  ),
  unidades_producto as (
    select candy_producto_id as producto_id, cantidad as unidades, cantidad * precio_unitario as recaudacion
    from candy where candy_producto_id is not null
    union all
    select cp.candy_producto_id, c.cantidad * cp.cantidad, 0
    from candy c
    join public.combo_productos cp on cp.combo_id = c.combo_id
    where c.combo_id is not null
  ),
  ranking_productos as (
    select p.nombre, sum(u.unidades) as unidades, sum(u.recaudacion) as recaudacion
    from unidades_producto u
    join public.candy_productos p on p.id = u.producto_id
    group by p.id, p.nombre
    order by sum(u.unidades) desc, p.nombre
    limit 10
  ),
  ranking_combos as (
    select cb.nombre, sum(c.cantidad) as unidades, sum(c.cantidad * c.precio_unitario) as recaudacion
    from candy c
    join public.combos cb on cb.id = c.combo_id
    group by cb.id, cb.nombre
    order by sum(c.cantidad) desc, cb.nombre
    limit 5
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'generado', now(),
    'resumen', (
      select jsonb_build_object(
        'compras', coalesce(sum(compras), 0),
        'entradas', coalesce(sum(entradas), 0),
        'subtotal', coalesce(sum(subtotal), 0),
        'descuentos', coalesce(sum(descuentos), 0),
        'facturacion', coalesce(sum(facturacion), 0),
        'credito', coalesce(sum(credito), 0),
        'cobrado', coalesce(sum(cobrado), 0),
        'candy', coalesce(sum(candy), 0),
        'canceladas', coalesce(sum(canceladas), 0),
        'ticket_promedio', case when sum(compras) > 0 then round(sum(facturacion) / sum(compras), 2) else 0 end
      )
      from por_dia
    ),
    'por_dia', (
      select jsonb_agg(to_jsonb(pd) order by pd.dia) from por_dia pd
    ),
    'peliculas_semana', coalesce((
      select jsonb_agg(x order by x.entradas desc, x.nombre)
      from (
        select p.nombre, count(*) as entradas, sum(e.precio) as recaudacion
        from entradas e join public.peliculas p on p.id = e.pelicula_id
        where e.dia between p_hasta - 6 and p_hasta
        group by p.id, p.nombre
        order by count(*) desc, p.nombre
        limit 10
      ) x
    ), '[]'::jsonb),
    'peliculas_mes', coalesce((
      select jsonb_agg(x order by x.entradas desc, x.nombre)
      from (
        select p.nombre, count(*) as entradas, sum(e.precio) as recaudacion
        from entradas e join public.peliculas p on p.id = e.pelicula_id
        where e.dia between p_hasta - 29 and p_hasta
        group by p.id, p.nombre
        order by count(*) desc, p.nombre
        limit 10
      ) x
    ), '[]'::jsonb),
    'productos', coalesce((select jsonb_agg(to_jsonb(r) order by r.unidades desc, r.nombre) from ranking_productos r), '[]'::jsonb),
    'combos', coalesce((select jsonb_agg(to_jsonb(r) order by r.unidades desc, r.nombre) from ranking_combos r), '[]'::jsonb)
  )
  into v_resultado;

  return v_resultado;
end;
$$;

revoke all on function public.reporte_facturacion(date, date) from public, anon;
grant execute on function public.reporte_facturacion(date, date) to authenticated;
