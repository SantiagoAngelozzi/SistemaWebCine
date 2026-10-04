alter table public.resenas add column if not exists updated_at timestamptz;

alter table public.resenas drop constraint if exists resenas_comentario_breve;
alter table public.resenas
  add constraint resenas_comentario_breve check (comentario is null or char_length(comentario) <= 500);

create index if not exists resenas_pelicula_idx on public.resenas (pelicula_id, created_at desc);

create or replace function public.usuario_vio_pelicula(p_pelicula_id uuid, p_usuario_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.compras c
    join public.compra_entradas ce on ce.compra_id = c.id and ce.activa
    join public.funciones f on f.id = ce.funcion_id
    where c.usuario_id = p_usuario_id
      and c.estado <> 'cancelada'
      and f.pelicula_id = p_pelicula_id
      and (
        c.entrada_validada_at is not null
        or (f.fecha + f.hora_fin + case when f.hora_fin < f.hora_inicio then interval '1 day' else interval '0' end)
           <= (now() at time zone 'America/Argentina/Buenos_Aires')
      )
  );
$$;

revoke all on function public.usuario_vio_pelicula(uuid, uuid) from public, anon;
grant execute on function public.usuario_vio_pelicula(uuid, uuid) to authenticated;

drop policy if exists "resenas_insert_own" on public.resenas;
create policy "resenas_insert_own" on public.resenas
  for insert
  with check (usuario_id = auth.uid() and public.usuario_vio_pelicula(pelicula_id, auth.uid()));

drop policy if exists "resenas_update_own" on public.resenas;
create policy "resenas_update_own" on public.resenas
  for update
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid() and public.usuario_vio_pelicula(pelicula_id, auth.uid()));

create or replace function public.guardar_resena(
  p_pelicula_id uuid,
  p_calificacion integer,
  p_comentario text default null
)
returns public.resenas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_comentario text := nullif(btrim(coalesce(p_comentario, '')), '');
  v_resena public.resenas;
begin
  if v_usuario_id is null then
    raise exception 'Iniciá sesión para calificar películas.';
  end if;

  if p_calificacion is null or p_calificacion < 1 or p_calificacion > 5 then
    raise exception 'La calificación tiene que ser de 1 a 5 estrellas.';
  end if;

  if v_comentario is not null and char_length(v_comentario) > 500 then
    raise exception 'El comentario puede tener hasta 500 caracteres.';
  end if;

  if not exists (select 1 from public.peliculas where id = p_pelicula_id) then
    raise exception 'La película no existe.';
  end if;

  if not public.usuario_vio_pelicula(p_pelicula_id, v_usuario_id) then
    raise exception 'Sólo podés calificar películas que ya viste en el cine.';
  end if;

  insert into public.resenas (pelicula_id, usuario_id, calificacion, comentario)
  values (p_pelicula_id, v_usuario_id, p_calificacion, v_comentario)
  on conflict (pelicula_id, usuario_id) do update
    set calificacion = excluded.calificacion,
        comentario = excluded.comentario,
        updated_at = now()
  returning * into v_resena;

  return v_resena;
end;
$$;

revoke all on function public.guardar_resena(uuid, integer, text) from public, anon;
grant execute on function public.guardar_resena(uuid, integer, text) to authenticated;

create or replace function public.resenas_de_pelicula(p_pelicula_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_resultado jsonb;
begin
  select jsonb_build_object(
    'promedio', coalesce(round(avg(r.calificacion)::numeric, 1), 0),
    'cantidad', count(r.id),
    'distribucion', jsonb_build_array(
      count(*) filter (where r.calificacion = 1),
      count(*) filter (where r.calificacion = 2),
      count(*) filter (where r.calificacion = 3),
      count(*) filter (where r.calificacion = 4),
      count(*) filter (where r.calificacion = 5)
    )
  )
  into v_resultado
  from public.resenas r
  where r.pelicula_id = p_pelicula_id;

  v_resultado := v_resultado || jsonb_build_object(
    'resenas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'calificacion', r.calificacion,
          'comentario', r.comentario,
          'created_at', r.created_at,
          'editada', r.updated_at is not null,
          'autor', coalesce(
            nullif(btrim(coalesce(u.nombre, '') || ' ' || coalesce(left(u.apellido, 1) || '.', '')), ''),
            'Espectador'
          ),
          'es_mia', r.usuario_id = v_usuario_id
        )
        order by (r.usuario_id = v_usuario_id) desc, coalesce(r.updated_at, r.created_at) desc
      )
      from public.resenas r
      left join public.usuarios u on u.id = r.usuario_id
      where r.pelicula_id = p_pelicula_id
    ), '[]'::jsonb),
    'puede_resenar', v_usuario_id is not null and public.usuario_vio_pelicula(p_pelicula_id, v_usuario_id)
  );

  return v_resultado;
end;
$$;

revoke all on function public.resenas_de_pelicula(uuid) from public;
grant execute on function public.resenas_de_pelicula(uuid) to anon, authenticated;

create or replace function public.mis_peliculas()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with vistas as (
    select
      f.pelicula_id,
      c.id as compra_id,
      f.fecha,
      f.hora_inicio,
      f.formato,
      s.nombre as sala,
      c.entrada_validada_at
    from public.compras c
    join public.compra_entradas ce on ce.compra_id = c.id and ce.activa
    join public.funciones f on f.id = ce.funcion_id
    join public.salas s on s.id = f.sala_id
    where c.usuario_id = auth.uid()
      and c.estado <> 'cancelada'
      and (
        c.entrada_validada_at is not null
        or (f.fecha + f.hora_fin + case when f.hora_fin < f.hora_inicio then interval '1 day' else interval '0' end)
           <= (now() at time zone 'America/Argentina/Buenos_Aires')
      )
    group by f.pelicula_id, c.id, f.fecha, f.hora_inicio, f.formato, s.nombre, c.entrada_validada_at
  ),
  por_pelicula as (
    select
      v.pelicula_id,
      max(v.fecha + v.hora_inicio) as ultima_funcion,
      count(distinct v.compra_id) as veces,
      jsonb_agg(
        jsonb_build_object(
          'fecha', v.fecha,
          'hora_inicio', v.hora_inicio,
          'sala', v.sala,
          'formato', v.formato
        )
        order by v.fecha desc, v.hora_inicio desc
      ) as funciones
    from vistas v
    group by v.pelicula_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pelicula_id', p.id,
        'nombre', p.nombre,
        'imagen_url', p.imagen_url,
        'clasificacion', p.clasificacion,
        'duracion_minutos', p.duracion_minutos,
        'ultima_funcion', pp.ultima_funcion,
        'veces', pp.veces,
        'funciones', pp.funciones,
        'calificacion', r.calificacion,
        'comentario', r.comentario
      )
      order by pp.ultima_funcion desc
    ),
    '[]'::jsonb
  )
  from por_pelicula pp
  join public.peliculas p on p.id = pp.pelicula_id
  left join public.resenas r on r.pelicula_id = p.id and r.usuario_id = auth.uid();
$$;

revoke all on function public.mis_peliculas() from public, anon;
grant execute on function public.mis_peliculas() to authenticated;
