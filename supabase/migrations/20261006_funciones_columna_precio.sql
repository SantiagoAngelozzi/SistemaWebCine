-- ============================================================
-- Funciones sin precio propio: el precio vive sólo en la película
-- ------------------------------------------------------------
-- Se decidió que el precio esté en un solo lugar (peliculas.precio_normal
-- y precio_preventa) porque tener además funciones.precio hacía que un
-- precio pisara al otro. La columna ya se había quitado de la base, pero
-- crear_funcion_automatica seguía intentando guardarla y fallaba con:
--   column "precio" of relation "funciones" does not exist
--
-- Esta migración:
--   1. Quita la columna si todavía existe (deja todas las bases iguales).
--   2. Vuelve a crear crear_funcion_automatica sin esa columna.
-- El precio de cada entrada lo calcula la compra con el precio vigente
-- de la película (preventa o normal) más el recargo VIP.
--
-- Se ejecuta después de 20261005_eliminar_funcion_con_ventas.sql. Es idempotente.
-- ============================================================

alter table public.funciones drop column if exists precio;

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

  select id, duracion_minutos
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

  -- Serializa las asignaciones de un mismo día entre administradores.
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
    pelicula_id, sala_id, fecha, hora_inicio, hora_fin, formato, idioma, created_by
  )
  values (
    p_pelicula_id, v_sala_id, p_fecha, p_hora_inicio, v_hora_fin,
    p_formato, p_idioma, auth.uid()
  )
  returning id into v_funcion_id;

  return v_funcion_id;
end;
$$;

revoke all on function public.crear_funcion_automatica(uuid, date, time, formato_proyeccion, idioma_pelicula) from public;
grant execute on function public.crear_funcion_automatica(uuid, date, time, formato_proyeccion, idioma_pelicula) to authenticated;
