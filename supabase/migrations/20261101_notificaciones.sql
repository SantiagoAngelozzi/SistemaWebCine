create table if not exists public.notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  tipo text not null check (tipo in ('lista_espera', 'funcion_cancelada', 'propuesta')),
  titulo text not null,
  mensaje text not null,
  link text,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notificaciones_usuario_fecha_idx
  on public.notificaciones (usuario_id, created_at desc);

alter table public.notificaciones enable row level security;

drop policy if exists "notificaciones_select_own" on public.notificaciones;
create policy "notificaciones_select_own" on public.notificaciones
  for select using (usuario_id = auth.uid());

create or replace function public.crear_notificacion(
  p_usuario_id uuid,
  p_tipo text,
  p_titulo text,
  p_mensaje text,
  p_link text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_usuario_id is null then
    return null;
  end if;

  insert into public.notificaciones (usuario_id, tipo, titulo, mensaje, link)
  values (p_usuario_id, p_tipo, p_titulo, p_mensaje, p_link)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.crear_notificacion(uuid, text, text, text, text) from public, anon, authenticated;

create or replace function public.marcar_notificaciones_leidas(p_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cantidad integer;
begin
  if auth.uid() is null then
    raise exception 'Iniciá sesión para ver tus notificaciones.';
  end if;

  update public.notificaciones
  set leida = true
  where usuario_id = auth.uid()
    and not leida
    and (p_id is null or id = p_id);

  get diagnostics v_cantidad = row_count;
  return v_cantidad;
end;
$$;

revoke all on function public.marcar_notificaciones_leidas(uuid) from public, anon;
grant execute on function public.marcar_notificaciones_leidas(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end;
$$;
