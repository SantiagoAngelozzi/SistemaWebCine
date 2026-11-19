create table if not exists public.lista_espera (
  id uuid primary key default gen_random_uuid(),
  funcion_id uuid not null references public.funciones (id) on delete cascade,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  estado text not null default 'esperando'
    check (estado in ('esperando', 'notificado', 'compro', 'expirado', 'salio', 'cancelada')),
  butaca_reservada_id uuid references public.butacas (id),
  notificado_at timestamptz,
  expira_at timestamptz,
  created_at timestamptz not null default now(),
  unique (funcion_id, usuario_id)
);

create index if not exists lista_espera_funcion_estado_idx
  on public.lista_espera (funcion_id, estado, created_at);

alter table public.lista_espera enable row level security;

drop policy if exists "lista_espera_select_own_or_staff" on public.lista_espera;
create policy "lista_espera_select_own_or_staff" on public.lista_espera
  for select using (usuario_id = auth.uid() or public.tiene_permiso('salas_funciones'));

create or replace function public.funcion_agotada(p_funcion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(*) from public.butacas b
    join public.funciones f on f.sala_id = b.sala_id
    where f.id = p_funcion_id
  ) <= (
    (select count(*) from public.compra_entradas ce where ce.funcion_id = p_funcion_id and ce.activa)
    + (select count(*) from public.lista_espera le
       where le.funcion_id = p_funcion_id and le.estado = 'notificado' and le.expira_at > now())
  );
$$;

revoke all on function public.funcion_agotada(uuid) from public;
grant execute on function public.funcion_agotada(uuid) to anon, authenticated;

create or replace function public.asignar_butaca_liberada(p_funcion_id uuid, p_butaca_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_funcion record;
  v_turno record;
  v_ubicacion text;
begin
  select f.estado, f.fecha, f.hora_inicio, p.nombre as pelicula
  into v_funcion
  from public.funciones f
  join public.peliculas p on p.id = f.pelicula_id
  where f.id = p_funcion_id;

  if not found or v_funcion.estado <> 'activa'
     or v_funcion.fecha + v_funcion.hora_inicio <= public.ahora_argentina() then
    return false;
  end if;

  if exists (
    select 1 from public.compra_entradas
    where funcion_id = p_funcion_id and butaca_id = p_butaca_id and activa
  ) or exists (
    select 1 from public.lista_espera
    where funcion_id = p_funcion_id and butaca_reservada_id = p_butaca_id
      and estado = 'notificado' and expira_at > now()
  ) then
    return false;
  end if;

  select * into v_turno
  from public.lista_espera
  where funcion_id = p_funcion_id and estado = 'esperando'
  order by created_at, id
  limit 1
  for update skip locked;

  if not found then
    return false;
  end if;

  update public.lista_espera
  set estado = 'notificado',
      butaca_reservada_id = p_butaca_id,
      notificado_at = now(),
      expira_at = now() + interval '15 minutes'
  where id = v_turno.id;

  select fila || '-' || columna into v_ubicacion from public.butacas where id = p_butaca_id;

  perform public.crear_notificacion(
    v_turno.usuario_id,
    'lista_espera',
    '¡Se liberó una butaca!',
    'Te reservamos la butaca ' || coalesce(v_ubicacion, '') || ' para "' || v_funcion.pelicula || '" del ' ||
      to_char(v_funcion.fecha, 'DD/MM') || ' a las ' || to_char(v_funcion.hora_inicio, 'HH24:MI') ||
      '. Tenés 15 minutos para comprarla; después pasa a la siguiente persona.',
    '/funcion/' || p_funcion_id || '/butacas'
  );

  return true;
end;
$$;

revoke all on function public.asignar_butaca_liberada(uuid, uuid) from public, anon, authenticated;

create or replace function public.procesar_lista_espera(p_funcion_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vencido record;
  v_cantidad integer := 0;
begin
  for v_vencido in
    select le.id, le.funcion_id, le.usuario_id, le.butaca_reservada_id, p.nombre as pelicula
    from public.lista_espera le
    join public.funciones f on f.id = le.funcion_id
    join public.peliculas p on p.id = f.pelicula_id
    where le.estado = 'notificado'
      and le.expira_at <= now()
      and (p_funcion_id is null or le.funcion_id = p_funcion_id)
    order by le.expira_at
    for update of le skip locked
  loop
    update public.lista_espera set estado = 'expirado' where id = v_vencido.id;

    perform public.crear_notificacion(
      v_vencido.usuario_id,
      'lista_espera',
      'Se venció tu turno',
      'Pasaron los 15 minutos y la butaca de "' || v_vencido.pelicula ||
        '" pasó a la siguiente persona de la lista. Si querés, podés volver a anotarte.',
      '/perfil?tab=espera'
    );

    if v_vencido.butaca_reservada_id is not null then
      perform public.asignar_butaca_liberada(v_vencido.funcion_id, v_vencido.butaca_reservada_id);
    end if;

    v_cantidad := v_cantidad + 1;
  end loop;

  return v_cantidad;
end;
$$;

revoke all on function public.procesar_lista_espera(uuid) from public, anon;
grant execute on function public.procesar_lista_espera(uuid) to authenticated;

create or replace function public.al_liberarse_butaca()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.activa and not new.activa then
    perform public.asignar_butaca_liberada(new.funcion_id, new.butaca_id);
  end if;
  return new;
end;
$$;

drop trigger if exists compra_entradas_asignar_lista_espera on public.compra_entradas;
create trigger compra_entradas_asignar_lista_espera
after update of activa on public.compra_entradas
for each row execute function public.al_liberarse_butaca();

create or replace function public.proteger_butaca_reservada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comprador uuid;
begin
  perform public.procesar_lista_espera(new.funcion_id);

  select usuario_id into v_comprador from public.compras where id = new.compra_id;

  if exists (
    select 1 from public.lista_espera
    where funcion_id = new.funcion_id
      and butaca_reservada_id = new.butaca_id
      and estado = 'notificado'
      and expira_at > now()
      and usuario_id is distinct from v_comprador
  ) then
    raise exception 'Una o más butacas están reservadas para la lista de espera. Elegí otras.';
  end if;

  return new;
end;
$$;

drop trigger if exists compra_entradas_proteger_reserva on public.compra_entradas;
create trigger compra_entradas_proteger_reserva
before insert on public.compra_entradas
for each row execute function public.proteger_butaca_reservada();

create or replace function public.marcar_compra_lista_espera()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comprador uuid;
  v_turno record;
begin
  select usuario_id into v_comprador from public.compras where id = new.compra_id;
  if v_comprador is null then
    return null;
  end if;

  select * into v_turno
  from public.lista_espera
  where funcion_id = new.funcion_id
    and usuario_id = v_comprador
    and estado in ('esperando', 'notificado')
  for update;

  if not found then
    return null;
  end if;

  update public.lista_espera set estado = 'compro' where id = v_turno.id;

  if v_turno.estado = 'notificado'
     and v_turno.butaca_reservada_id is not null
     and not exists (
       select 1 from public.compra_entradas
       where funcion_id = new.funcion_id and butaca_id = v_turno.butaca_reservada_id and activa
     ) then
    perform public.asignar_butaca_liberada(new.funcion_id, v_turno.butaca_reservada_id);
  end if;

  return null;
end;
$$;

drop trigger if exists compra_entradas_marcar_lista_espera on public.compra_entradas;
create constraint trigger compra_entradas_marcar_lista_espera
after insert on public.compra_entradas
deferrable initially deferred
for each row execute function public.marcar_compra_lista_espera();

create or replace function public.cerrar_lista_espera_funcion_cancelada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turno record;
  v_pelicula text;
begin
  if new.estado <> 'cancelada' or old.estado = 'cancelada' then
    return new;
  end if;

  select nombre into v_pelicula from public.peliculas where id = new.pelicula_id;

  for v_turno in
    update public.lista_espera
    set estado = 'cancelada'
    where funcion_id = new.id and estado in ('esperando', 'notificado')
    returning usuario_id
  loop
    perform public.crear_notificacion(
      v_turno.usuario_id,
      'funcion_cancelada',
      'Se canceló una función de tu lista de espera',
      'El cine canceló la función de "' || coalesce(v_pelicula, '') || '" del ' ||
        to_char(new.fecha, 'DD/MM') || ' a las ' || to_char(new.hora_inicio, 'HH24:MI') ||
        '. Te sacamos de la lista de espera: elegí otra función.',
      '/pelicula/' || new.pelicula_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists funciones_cerrar_lista_espera on public.funciones;
create trigger funciones_cerrar_lista_espera
after update of estado on public.funciones
for each row execute function public.cerrar_lista_espera_funcion_cancelada();

create or replace function public.anotarse_lista_espera(p_funcion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario record;
  v_funcion record;
  v_existente public.lista_espera%rowtype;
  v_edad_minima integer := 0;
  v_posicion integer;
begin
  if auth.uid() is null then
    raise exception 'Iniciá sesión para anotarte en la lista de espera.';
  end if;

  select id, rol, fecha_nacimiento into v_usuario from public.usuarios where id = auth.uid();
  if v_usuario.rol <> 'cliente' then
    raise exception 'La lista de espera es para clientes.';
  end if;

  select f.id, f.estado, f.fecha, f.hora_inicio, p.clasificacion
  into v_funcion
  from public.funciones f
  join public.peliculas p on p.id = f.pelicula_id
  where f.id = p_funcion_id and p.activa;

  if not found then
    raise exception 'La función no existe.';
  end if;

  if v_funcion.estado <> 'activa' then
    raise exception 'La función fue cancelada.';
  end if;

  if v_funcion.fecha + v_funcion.hora_inicio <= public.ahora_argentina() then
    raise exception 'La función ya comenzó.';
  end if;

  if v_funcion.clasificacion = '+13' then
    v_edad_minima := 13;
  elsif v_funcion.clasificacion = '+18' then
    v_edad_minima := 18;
  end if;

  if v_edad_minima > 0 and v_usuario.fecha_nacimiento is not null
     and date_part('year', age(current_date, v_usuario.fecha_nacimiento)) < v_edad_minima then
    raise exception 'No cumplís la edad mínima para esta película.';
  end if;

  perform public.procesar_lista_espera(p_funcion_id);

  select * into v_existente
  from public.lista_espera
  where funcion_id = p_funcion_id and usuario_id = auth.uid()
  for update;

  if found and v_existente.estado in ('esperando', 'notificado') then
    raise exception 'Ya estás en la lista de espera de esta función.';
  end if;

  if not public.funcion_agotada(p_funcion_id) then
    raise exception 'Todavía hay butacas libres: podés comprar directamente.';
  end if;

  if found then
    update public.lista_espera
    set estado = 'esperando',
        butaca_reservada_id = null,
        notificado_at = null,
        expira_at = null,
        created_at = now()
    where id = v_existente.id;
  else
    insert into public.lista_espera (funcion_id, usuario_id) values (p_funcion_id, auth.uid());
  end if;

  select count(*) into v_posicion
  from public.lista_espera
  where funcion_id = p_funcion_id
    and estado = 'esperando'
    and created_at <= (select created_at from public.lista_espera where funcion_id = p_funcion_id and usuario_id = auth.uid());

  return jsonb_build_object('posicion', v_posicion);
end;
$$;

revoke all on function public.anotarse_lista_espera(uuid) from public, anon;
grant execute on function public.anotarse_lista_espera(uuid) to authenticated;

create or replace function public.salir_lista_espera(p_funcion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turno public.lista_espera%rowtype;
begin
  select * into v_turno
  from public.lista_espera
  where funcion_id = p_funcion_id and usuario_id = auth.uid() and estado in ('esperando', 'notificado')
  for update;

  if not found then
    raise exception 'No estás en la lista de espera de esta función.';
  end if;

  update public.lista_espera set estado = 'salio' where id = v_turno.id;

  if v_turno.estado = 'notificado' and v_turno.butaca_reservada_id is not null then
    perform public.asignar_butaca_liberada(p_funcion_id, v_turno.butaca_reservada_id);
  end if;
end;
$$;

revoke all on function public.salir_lista_espera(uuid) from public, anon;
grant execute on function public.salir_lista_espera(uuid) to authenticated;

create or replace function public.estado_lista_espera(p_funcion_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_resultado jsonb := '[]'::jsonb;
begin
  foreach v_id in array coalesce(p_funcion_ids, '{}'::uuid[]) loop
    perform public.procesar_lista_espera(v_id);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'funcion_id', f.id,
    'agotada', public.funcion_agotada(f.id),
    'en_espera', (
      select count(*) from public.lista_espera le
      where le.funcion_id = f.id and le.estado = 'esperando'
    ),
    'mi_estado', mio.estado,
    'mi_posicion', case when mio.estado = 'esperando' then (
      select count(*) from public.lista_espera le
      where le.funcion_id = f.id and le.estado = 'esperando' and le.created_at <= mio.created_at
    ) end,
    'mi_expira_at', case when mio.estado = 'notificado' then mio.expira_at end
  )), '[]'::jsonb)
  into v_resultado
  from public.funciones f
  left join public.lista_espera mio
    on mio.funcion_id = f.id and mio.usuario_id = auth.uid() and mio.estado in ('esperando', 'notificado')
  where f.id = any(p_funcion_ids);

  return v_resultado;
end;
$$;

revoke all on function public.estado_lista_espera(uuid[]) from public;
grant execute on function public.estado_lista_espera(uuid[]) to anon, authenticated;

create or replace function public.reservas_lista_espera(p_funcion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.procesar_lista_espera(p_funcion_id);

  return jsonb_build_object(
    'reservadas', coalesce((
      select jsonb_agg(le.butaca_reservada_id)
      from public.lista_espera le
      where le.funcion_id = p_funcion_id
        and le.estado = 'notificado'
        and le.expira_at > now()
        and le.usuario_id is distinct from auth.uid()
    ), '[]'::jsonb),
    'mia', (
      select jsonb_build_object(
        'butaca_id', le.butaca_reservada_id,
        'ubicacion', b.fila || '-' || b.columna,
        'expira_at', le.expira_at
      )
      from public.lista_espera le
      join public.butacas b on b.id = le.butaca_reservada_id
      where le.funcion_id = p_funcion_id
        and le.usuario_id = auth.uid()
        and le.estado = 'notificado'
        and le.expira_at > now()
    )
  );
end;
$$;

revoke all on function public.reservas_lista_espera(uuid) from public;
grant execute on function public.reservas_lista_espera(uuid) to anon, authenticated;

create or replace function public.mis_listas_espera()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  perform public.procesar_lista_espera(le.funcion_id)
  from public.lista_espera le
  where le.usuario_id = auth.uid() and le.estado = 'notificado';

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', le.id,
      'funcion_id', le.funcion_id,
      'pelicula_id', p.id,
      'pelicula', p.nombre,
      'imagen_url', p.imagen_url,
      'sala', s.nombre,
      'fecha', f.fecha,
      'hora_inicio', f.hora_inicio,
      'formato', f.formato,
      'estado', le.estado,
      'posicion', case when le.estado = 'esperando' then (
        select count(*) from public.lista_espera otro
        where otro.funcion_id = le.funcion_id and otro.estado = 'esperando' and otro.created_at <= le.created_at
      ) end,
      'expira_at', case when le.estado = 'notificado' then le.expira_at end,
      'butaca', case when le.estado = 'notificado' then b.fila || '-' || b.columna end,
      'anotado_at', le.created_at
    ) order by f.fecha desc, f.hora_inicio desc)
    from public.lista_espera le
    join public.funciones f on f.id = le.funcion_id
    join public.peliculas p on p.id = f.pelicula_id
    join public.salas s on s.id = f.sala_id
    left join public.butacas b on b.id = le.butaca_reservada_id
    where le.usuario_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.mis_listas_espera() from public, anon;
grant execute on function public.mis_listas_espera() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'procesar-lista-espera';
    perform cron.schedule('procesar-lista-espera', '* * * * *', 'select public.procesar_lista_espera()');
  end if;
end;
$$;
