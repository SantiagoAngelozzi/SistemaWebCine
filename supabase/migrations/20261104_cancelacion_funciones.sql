alter table public.funciones
  add column if not exists estado text not null default 'activa';
alter table public.funciones drop constraint if exists funciones_estado_chk;
alter table public.funciones
  add constraint funciones_estado_chk check (estado in ('activa', 'cancelada'));
alter table public.funciones add column if not exists cancelada_at timestamptz;
alter table public.funciones add column if not exists cancelada_por uuid references public.usuarios (id);
alter table public.funciones add column if not exists motivo_cancelacion text;

alter table public.compras add column if not exists cancelada_por_cine boolean not null default false;

alter table public.movimientos_credito drop constraint if exists movimientos_credito_motivo_check;
alter table public.movimientos_credito
  add constraint movimientos_credito_motivo_check
  check (motivo in ('cancelacion', 'uso_en_compra', 'cancelacion_funcion'));

create or replace function public.validar_funcion_vigente_para_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio timestamp;
  v_estado text;
begin
  select f.fecha + f.hora_inicio, f.estado into v_inicio, v_estado
  from public.funciones f
  where f.id = new.funcion_id;

  if v_estado = 'cancelada' then
    raise exception 'Esta función fue cancelada por el cine: elegí otra función.';
  end if;

  if not public.solicitud_desde_la_app() then
    return new;
  end if;

  if v_inicio is not null and v_inicio <= public.ahora_argentina() then
    raise exception 'Esta función ya comenzó: no se pueden comprar entradas.';
  end if;

  return new;
end;
$$;

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
  if not public.tiene_permiso('salas_funciones') then
    raise exception 'No tenés permiso para programar funciones.';
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

  perform pg_advisory_xact_lock(hashtextextended(p_fecha::text, 0));

  select s.id
  into v_sala_id
  from public.salas s
  where not exists (
    select 1
    from public.funciones f
    where f.sala_id = s.id
      and f.fecha = p_fecha
      and f.estado = 'activa'
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

create or replace function public.resumen_cancelacion_funcion(p_funcion_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if not public.tiene_permiso('salas_funciones') then
    raise exception 'No tenés permiso para cancelar funciones.';
  end if;

  select jsonb_build_object(
    'compras', count(*),
    'entradas', coalesce(sum(c.entradas), 0),
    'credito_a_devolver', coalesce(sum(c.total) filter (where c.usuario_id is not null), 0),
    'compras_sin_cuenta', count(*) filter (where c.usuario_id is null)
  )
  into v_resultado
  from (
    select co.id, co.usuario_id, co.total, count(ce.id) as entradas
    from public.compras co
    join public.compra_entradas ce on ce.compra_id = co.id
    where ce.funcion_id = p_funcion_id
      and ce.activa
      and co.estado = 'confirmada'
    group by co.id, co.usuario_id, co.total
  ) c;

  return v_resultado;
end;
$$;

revoke all on function public.resumen_cancelacion_funcion(uuid) from public, anon;
grant execute on function public.resumen_cancelacion_funcion(uuid) to authenticated;

create or replace function public.cancelar_funcion(p_funcion_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_funcion record;
  v_compra record;
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_compras integer := 0;
  v_sin_cuenta integer := 0;
  v_entradas integer := 0;
  v_credito numeric(10, 2) := 0;
  v_fecha_texto text;
begin
  if not public.tiene_permiso('salas_funciones') then
    raise exception 'No tenés permiso para cancelar funciones.';
  end if;

  select f.id, f.estado, f.fecha, f.hora_inicio, p.id as pelicula_id, p.nombre as pelicula
  into v_funcion
  from public.funciones f
  join public.peliculas p on p.id = f.pelicula_id
  where f.id = p_funcion_id
  for update of f;

  if not found then
    raise exception 'La función no existe.';
  end if;

  if v_funcion.estado = 'cancelada' then
    raise exception 'La función ya estaba cancelada.';
  end if;

  if v_funcion.fecha + v_funcion.hora_inicio <= public.ahora_argentina() then
    raise exception 'La función ya comenzó: no se puede cancelar.';
  end if;

  v_fecha_texto := to_char(v_funcion.fecha, 'DD/MM') || ' a las ' || to_char(v_funcion.hora_inicio, 'HH24:MI');

  update public.funciones
  set estado = 'cancelada',
      cancelada_at = now(),
      cancelada_por = auth.uid(),
      motivo_cancelacion = v_motivo
  where id = p_funcion_id;

  perform set_config('app.movimiento_saldo', 'on', true);

  for v_compra in
    select co.*
    from public.compras co
    where co.estado = 'confirmada'
      and exists (
        select 1 from public.compra_entradas ce
        where ce.compra_id = co.id and ce.funcion_id = p_funcion_id and ce.activa
      )
    order by co.created_at
    for update of co
  loop
    v_compras := v_compras + 1;

    update public.compras
    set estado = 'cancelada',
        cancelada_at = now(),
        qr_vigente = false,
        cancelada_por_cine = true
    where id = v_compra.id;

    if v_compra.usuario_id is null then
      v_sin_cuenta := v_sin_cuenta + 1;
      continue;
    end if;

    if v_compra.total > 0 then
      update public.usuarios set credito = credito + v_compra.total where id = v_compra.usuario_id;
      insert into public.movimientos_credito (usuario_id, compra_id, monto, motivo)
      values (v_compra.usuario_id, v_compra.id, v_compra.total, 'cancelacion_funcion');
      v_credito := v_credito + v_compra.total;
    end if;

    if v_compra.puntos_canjeados > 0 or v_compra.puntos_ganados > 0 then
      update public.usuarios
      set puntos = greatest(0, puntos + v_compra.puntos_canjeados - v_compra.puntos_ganados)
      where id = v_compra.usuario_id;

      if v_compra.puntos_canjeados > 0 then
        insert into public.movimientos_puntos (usuario_id, compra_id, puntos, motivo)
        values (v_compra.usuario_id, v_compra.id, v_compra.puntos_canjeados, 'devolucion_canje');
      end if;
      if v_compra.puntos_ganados > 0 then
        insert into public.movimientos_puntos (usuario_id, compra_id, puntos, motivo)
        values (v_compra.usuario_id, v_compra.id, -v_compra.puntos_ganados, 'anulacion_compra');
      end if;
    end if;

    perform public.crear_notificacion(
      v_compra.usuario_id,
      'funcion_cancelada',
      'Se canceló tu función',
      'El cine canceló la función de "' || v_funcion.pelicula || '" del ' || v_fecha_texto ||
        coalesce(' (' || v_motivo || ')', '') || '. Te acreditamos $' || v_compra.total ||
        ' en tu cuenta (incluye el Candy Bar). Elegí otra función y usalo para reubicarte.',
      '/reubicacion/' || v_compra.id
    );
  end loop;

  perform set_config('app.movimiento_saldo', 'off', true);

  update public.compra_entradas
  set activa = false
  where funcion_id = p_funcion_id and activa;
  get diagnostics v_entradas = row_count;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (
    auth.uid(), 'FUNCION_CANCELADA', 'funciones', p_funcion_id,
    jsonb_build_object(
      'etiqueta', v_funcion.pelicula || ', ' || v_fecha_texto,
      'motivo', v_motivo,
      'compras', v_compras,
      'entradas', v_entradas,
      'credito_devuelto', v_credito,
      'compras_sin_cuenta', v_sin_cuenta
    )
  );

  return jsonb_build_object(
    'funcion_id', p_funcion_id,
    'compras', v_compras,
    'entradas', v_entradas,
    'credito_devuelto', v_credito,
    'compras_sin_cuenta', v_sin_cuenta
  );
end;
$$;

revoke all on function public.cancelar_funcion(uuid, text) from public, anon;
grant execute on function public.cancelar_funcion(uuid, text) to authenticated;
