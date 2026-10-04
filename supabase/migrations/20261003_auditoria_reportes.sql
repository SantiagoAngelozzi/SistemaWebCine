create or replace function public.log_auditoria_inmutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'El registro de auditoría es inmutable: no se puede modificar ni borrar.';
end;
$$;

drop trigger if exists log_auditoria_sin_cambios on public.log_auditoria;
create trigger log_auditoria_sin_cambios
before update or delete on public.log_auditoria
for each row execute function public.log_auditoria_inmutable();

drop trigger if exists log_auditoria_sin_truncate on public.log_auditoria;
create trigger log_auditoria_sin_truncate
before truncate on public.log_auditoria
for each statement execute function public.log_auditoria_inmutable();

drop policy if exists "log_auditoria_admin_all" on public.log_auditoria;
drop policy if exists "log_auditoria_select_admin" on public.log_auditoria;
create policy "log_auditoria_select_admin" on public.log_auditoria
  for select using (public.is_admin());

create index if not exists log_auditoria_fecha_idx on public.log_auditoria (created_at desc);

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registro jsonb;
  v_anterior jsonb;
  v_cambios jsonb := '{}'::jsonb;
  v_clave text;
  v_etiqueta text;
  v_detalle jsonb;
begin
  if tg_op = 'DELETE' then
    v_registro := to_jsonb(old);
  else
    v_registro := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    v_anterior := to_jsonb(old);
    for v_clave in select jsonb_object_keys(v_registro) loop
      if v_registro -> v_clave is distinct from v_anterior -> v_clave then
        v_cambios := v_cambios || jsonb_build_object(
          v_clave, jsonb_build_object('antes', v_anterior -> v_clave, 'despues', v_registro -> v_clave)
        );
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then
      return new;
    end if;
  end if;

  if tg_table_name = 'funciones' then
    select p.nombre || ' — ' || s.nombre || ', ' || (v_registro ->> 'fecha') || ' ' || left(v_registro ->> 'hora_inicio', 5)
      into v_etiqueta
    from public.peliculas p, public.salas s
    where p.id = (v_registro ->> 'pelicula_id')::uuid
      and s.id = (v_registro ->> 'sala_id')::uuid;
    v_etiqueta := coalesce(v_etiqueta, 'Función ' || (v_registro ->> 'fecha'));
  else
    v_etiqueta := coalesce(v_registro ->> 'nombre', v_registro ->> 'codigo');
  end if;

  v_detalle := jsonb_build_object('etiqueta', v_etiqueta, 'registro', v_registro);
  if tg_op = 'UPDATE' then
    v_detalle := v_detalle || jsonb_build_object('cambios', v_cambios);
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (auth.uid(), tg_op, tg_table_name, (v_registro ->> 'id')::uuid, v_detalle);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists auditar_salas on public.salas;
create trigger auditar_salas
after insert or update or delete on public.salas
for each row execute function public.registrar_auditoria();

drop trigger if exists auditar_candy_categorias on public.candy_categorias;
create trigger auditar_candy_categorias
after insert or update or delete on public.candy_categorias
for each row execute function public.registrar_auditoria();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'log_auditoria'
  ) then
    alter publication supabase_realtime add table public.log_auditoria;
  end if;
end;
$$;

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
  if not public.is_admin() then
    raise exception 'Sólo el administrador puede ver los reportes.';
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
