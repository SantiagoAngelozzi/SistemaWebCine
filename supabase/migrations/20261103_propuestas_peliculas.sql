create table if not exists public.propuestas_peliculas (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null default auth.uid() references public.usuarios (id) on delete cascade,
  titulo text not null,
  descripcion text not null,
  motivo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  pelicula_id uuid references public.peliculas (id) on delete set null,
  resuelta_por uuid references public.usuarios (id),
  resuelta_at timestamptz,
  created_at timestamptz not null default now(),
  constraint propuestas_titulo_chk check (char_length(trim(titulo)) between 2 and 120),
  constraint propuestas_descripcion_chk check (char_length(trim(descripcion)) between 10 and 1000),
  constraint propuestas_motivo_chk check (char_length(trim(motivo)) between 10 and 500)
);

create unique index if not exists propuestas_una_pendiente_por_usuario
  on public.propuestas_peliculas (usuario_id)
  where estado = 'pendiente';

alter table public.propuestas_peliculas enable row level security;

drop policy if exists "propuestas_select_own_or_staff" on public.propuestas_peliculas;
create policy "propuestas_select_own_or_staff" on public.propuestas_peliculas
  for select using (usuario_id = auth.uid() or public.tiene_permiso('propuestas'));

drop policy if exists "propuestas_insert_own" on public.propuestas_peliculas;
create policy "propuestas_insert_own" on public.propuestas_peliculas
  for insert to authenticated
  with check (
    usuario_id = auth.uid()
    and estado = 'pendiente'
    and pelicula_id is null
    and resuelta_por is null
    and resuelta_at is null
  );

create or replace function public.validar_propuesta_nueva()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.titulo := trim(new.titulo);
  new.descripcion := trim(new.descripcion);
  new.motivo := trim(new.motivo);

  if exists (
    select 1 from public.peliculas p
    where p.activa and lower(trim(p.nombre)) = lower(new.titulo)
  ) then
    raise exception '"%" ya está en la cartelera: proponé una película que no tengamos.', new.titulo;
  end if;

  if exists (
    select 1 from public.propuestas_peliculas pp
    where pp.usuario_id = new.usuario_id and pp.estado = 'pendiente'
  ) then
    raise exception 'Ya tenés una propuesta pendiente. Esperá a que la revisen para mandar otra.';
  end if;

  return new;
end;
$$;

drop trigger if exists propuestas_validar_nueva on public.propuestas_peliculas;
create trigger propuestas_validar_nueva
before insert on public.propuestas_peliculas
for each row execute function public.validar_propuesta_nueva();

create or replace function public.resolver_propuesta(
  p_propuesta_id uuid,
  p_estado text,
  p_pelicula_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_propuesta public.propuestas_peliculas%rowtype;
begin
  if not public.tiene_permiso('propuestas') then
    raise exception 'No tenés permiso para resolver propuestas.';
  end if;

  if p_estado not in ('aceptada', 'rechazada') then
    raise exception 'La propuesta sólo se puede aceptar o rechazar.';
  end if;

  select * into v_propuesta
  from public.propuestas_peliculas
  where id = p_propuesta_id
  for update;

  if not found then
    raise exception 'La propuesta no existe.';
  end if;

  if v_propuesta.estado <> 'pendiente' then
    raise exception 'La propuesta ya fue resuelta.';
  end if;

  if p_estado = 'aceptada' and (
    p_pelicula_id is null or not exists (select 1 from public.peliculas where id = p_pelicula_id)
  ) then
    raise exception 'Para aceptar la propuesta primero hay que crear la película.';
  end if;

  update public.propuestas_peliculas
  set estado = p_estado,
      pelicula_id = case when p_estado = 'aceptada' then p_pelicula_id end,
      resuelta_por = auth.uid(),
      resuelta_at = now()
  where id = p_propuesta_id;

  perform public.crear_notificacion(
    v_propuesta.usuario_id,
    'propuesta',
    case when p_estado = 'aceptada' then '¡Aceptamos tu propuesta!' else 'Revisamos tu propuesta' end,
    case
      when p_estado = 'aceptada' then
        '"' || v_propuesta.titulo || '" se suma a CineQuilmes. Ya podés proponer otra película.'
      else
        'Esta vez no vamos a sumar "' || v_propuesta.titulo || '". Podés proponer otra película cuando quieras.'
    end,
    case when p_estado = 'aceptada' then '/pelicula/' || p_pelicula_id else '/proponer-pelicula' end
  );
end;
$$;

revoke all on function public.resolver_propuesta(uuid, text, uuid) from public, anon;
grant execute on function public.resolver_propuesta(uuid, text, uuid) to authenticated;

drop trigger if exists auditar_propuestas_peliculas on public.propuestas_peliculas;
create trigger auditar_propuestas_peliculas
after insert or update or delete on public.propuestas_peliculas
for each row execute function public.registrar_auditoria();
