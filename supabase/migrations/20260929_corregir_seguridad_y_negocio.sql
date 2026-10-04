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
      or new.credito is distinct from old.credito then
      raise exception 'No tenés permiso para modificar campos protegidos del perfil.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists usuarios_proteger_campos on public.usuarios;
create trigger usuarios_proteger_campos
before update on public.usuarios
for each row execute function public.proteger_campos_usuario();

create or replace function public.crear_funcion_automatica(
  p_pelicula_id uuid,
  p_fecha date,
  p_hora_inicio time,
  p_formato formato_proyeccion,
  p_idioma idioma_pelicula
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pelicula record;
  v_sala_id uuid;
  v_hora_fin time;
  v_funcion_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede programar funciones.';
  end if;

  select id, duracion_minutos, precio_normal
  into v_pelicula
  from public.peliculas
  where id = p_pelicula_id;

  if not found then
    raise exception 'Película no encontrada.';
  end if;

  v_hora_fin := p_hora_inicio + make_interval(mins => v_pelicula.duracion_minutos);
  if v_hora_fin < p_hora_inicio then
    raise exception 'No se admiten funciones que finalicen al día siguiente.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_fecha::text, 0));

  select s.id
  into v_sala_id
  from public.salas s
  where not exists (
    select 1
    from public.funciones f
    where f.sala_id = s.id
      and f.fecha = p_fecha
      and (p_hora_inicio - interval '30 minutes') < f.hora_fin
      and f.hora_inicio < (v_hora_fin + interval '30 minutes')
  )
  order by s.nombre
  limit 1;

  if v_sala_id is null then
    raise exception 'No hay ninguna sala libre en ese horario respetando los 30 min de limpieza.';
  end if;

  insert into public.funciones (
    pelicula_id, sala_id, fecha, hora_inicio, hora_fin, formato, idioma, precio, created_by
  )
  values (
    p_pelicula_id, v_sala_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_formato, p_idioma, v_pelicula.precio_normal, auth.uid()
  )
  returning id into v_funcion_id;

  return v_funcion_id;
end;
$$;

create or replace function public.eliminar_funcion(p_funcion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar funciones.';
  end if;
  delete from public.funciones where id = p_funcion_id;
end;
$$;

drop policy if exists "funciones_admin_write" on public.funciones;
revoke all on function public.crear_funcion_automatica(uuid, date, time, formato_proyeccion, idioma_pelicula) from public;
revoke all on function public.eliminar_funcion(uuid) from public;
grant execute on function public.crear_funcion_automatica(uuid, date, time, formato_proyeccion, idioma_pelicula) to authenticated;
grant execute on function public.eliminar_funcion(uuid) to authenticated;

create or replace function public.crear_compra_entradas(
  p_funcion_id uuid,
  p_butaca_ids uuid[]
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
  v_total numeric(10, 2);
  v_compra_id uuid;
  v_codigo_qr text := gen_random_uuid()::text;
  v_cantidad_butacas integer;
begin
  if coalesce(cardinality(p_butaca_ids), 0) = 0 then
    raise exception 'Elegí al menos una butaca.';
  end if;

  if cardinality(p_butaca_ids) <> (
    select count(distinct asiento_id)
    from unnest(p_butaca_ids) as asiento(asiento_id)
  ) then
    raise exception 'No podés repetir una butaca en la misma compra.';
  end if;

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

  select coalesce(sum(case when tipo = 'vip' then v_precio_base * 1.5 else v_precio_base end), 0)
  into v_total
  from public.butacas
  where id = any(p_butaca_ids);

  insert into public.compras (usuario_id, total, estado, codigo_qr)
  values (v_usuario_id, v_total, 'confirmada', v_codigo_qr)
  returning id into v_compra_id;

  insert into public.compra_entradas (compra_id, funcion_id, butaca_id, precio)
  select v_compra_id, p_funcion_id, b.id,
         case when b.tipo = 'vip' then v_precio_base * 1.5 else v_precio_base end
  from public.butacas b
  where b.id = any(p_butaca_ids);

  return jsonb_build_object('compra_id', v_compra_id, 'codigo_qr', v_codigo_qr, 'total', v_total);
exception
  when unique_violation then
    raise exception 'Una o más butacas ya fueron vendidas. Elegí otras y volvé a intentar.';
end;
$$;

drop policy if exists "compras_select_own_or_admin" on public.compras;
drop policy if exists "compras_insert_own_or_anon" on public.compras;
drop policy if exists "compras_update_own_or_admin" on public.compras;
create policy "compras_select_own_or_admin" on public.compras
  for select using (usuario_id = auth.uid() or public.is_admin());

drop policy if exists "compra_entradas_select_via_compra" on public.compra_entradas;
drop policy if exists "compra_entradas_insert_via_compra" on public.compra_entradas;
create policy "compra_entradas_select_via_compra" on public.compra_entradas
  for select using (
    exists (
      select 1 from public.compras c
      where c.id = compra_id and (c.usuario_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "compra_entradas_select_ocupacion_publica" on public.compra_entradas;
create policy "compra_entradas_select_ocupacion_publica" on public.compra_entradas
  for select using (true);

drop policy if exists "compra_candy_items_select_via_compra" on public.compra_candy_items;
drop policy if exists "compra_candy_items_insert_via_compra" on public.compra_candy_items;
create policy "compra_candy_items_select_via_compra" on public.compra_candy_items
  for select using (
    exists (
      select 1 from public.compras c
      where c.id = compra_id and (c.usuario_id = auth.uid() or public.is_admin())
    )
  );

revoke all on function public.crear_compra_entradas(uuid, uuid[]) from public;
grant execute on function public.crear_compra_entradas(uuid, uuid[]) to anon, authenticated;

create or replace function public.obtener_peliculas_mas_vendidas(p_limite integer default 3)
returns table (pelicula_id uuid, entradas_vendidas bigint)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, count(c.id) as entradas_vendidas
  from public.peliculas p
  left join public.funciones f on f.pelicula_id = p.id
  left join public.compra_entradas ce on ce.funcion_id = f.id
  left join public.compras c on c.id = ce.compra_id and c.estado = 'confirmada'
  where p.activa
  group by p.id
  order by count(c.id) desc, p.created_at desc
  limit greatest(p_limite, 0);
$$;

revoke all on function public.obtener_peliculas_mas_vendidas(integer) from public;
grant execute on function public.obtener_peliculas_mas_vendidas(integer) to anon, authenticated;

drop policy if exists "log_auditoria_admin_all" on public.log_auditoria;
drop policy if exists "log_auditoria_select_admin" on public.log_auditoria;
create policy "log_auditoria_select_admin" on public.log_auditoria
  for select using (public.is_admin());

create or replace function public.registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_detalle jsonb;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_detalle := to_jsonb(old);
  else
    v_id := new.id;
    v_detalle := to_jsonb(new);
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (auth.uid(), tg_op, tg_table_name, v_id, v_detalle);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists auditar_peliculas on public.peliculas;
create trigger auditar_peliculas
after insert or update or delete on public.peliculas
for each row execute function public.registrar_auditoria();

drop trigger if exists auditar_funciones on public.funciones;
create trigger auditar_funciones
after insert or update or delete on public.funciones
for each row execute function public.registrar_auditoria();

do $$
begin
  alter publication supabase_realtime add table public.compra_entradas;
exception when duplicate_object then
  null;
end;
$$;
