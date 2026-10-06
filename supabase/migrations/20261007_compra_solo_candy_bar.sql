create or replace function public.crear_compra_candy(
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
  v_usuario_id uuid := auth.uid();
  v_usuario record;
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
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_canjes jsonb := coalesce(p_canjes, '[]'::jsonb);
  v_pedidos integer;
  v_validos integer;
  v_candy jsonb;
begin
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_canjes) <> 'array' then
    raise exception 'Formato inválido del pedido.';
  end if;

  if v_usuario_id is not null then
    select id, credito, puntos into v_usuario
    from public.usuarios where id = v_usuario_id
    for update;
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

  if not exists (select 1 from tmp_candy_pedido) and not exists (select 1 from tmp_canje_pedido) then
    raise exception 'Elegí al menos un producto del Candy Bar.';
  end if;

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

  if exists (
    select 1 from tmp_candy_pedido t
    join public.combos c on c.id = t.item_id
    where t.tipo = 'combo' and c.incluye_entrada
  ) then
    raise exception 'Los combos que incluyen entrada se compran junto con las butacas, desde la cartelera.';
  end if;

  if exists (select 1 from tmp_canje_pedido) then
    if v_usuario_id is null then
      raise exception 'Los canjes de puntos son para usuarios registrados.';
    end if;

    select count(*) into v_pedidos from tmp_canje_pedido;
    select count(*) into v_validos
    from tmp_canje_pedido t
    join public.recompensas_puntos r on r.id = t.recompensa_id and r.activo
    join public.candy_productos cp on cp.id = r.candy_producto_id and cp.activo
    where not r.otorga_entrada;

    if v_validos <> v_pedidos then
      raise exception 'Sólo podés canjear productos del Candy Bar. Las entradas se canjean al elegir butacas.';
    end if;

    select coalesce(sum(t.cantidad * r.costo_puntos), 0) into v_puntos_canje
    from tmp_canje_pedido t join public.recompensas_puntos r on r.id = t.recompensa_id;

    if v_puntos_canje > v_usuario.puntos then
      raise exception 'No te alcanzan los puntos: el canje cuesta % y tenés %.', v_puntos_canje, v_usuario.puntos;
    end if;
  end if;

  select * into v_descuento from public.resolver_descuento(v_usuario_id, p_codigo_cupon);

  if coalesce(trim(p_codigo_cupon), '') <> '' and v_descuento.error_cupon is not null then
    raise exception '%', v_descuento.error_cupon;
  end if;

  insert into public.compras (usuario_id, total, estado, codigo_qr)
  values (v_usuario_id, 0, 'confirmada', v_codigo_qr)
  returning id into v_compra_id;

  insert into public.compra_candy_items (compra_id, candy_producto_id, combo_id, cantidad, precio_unitario)
  select v_compra_id,
         case when t.tipo = 'producto' then t.item_id end,
         case when t.tipo = 'combo' then t.item_id end,
         t.cantidad,
         coalesce(cp.precio, c.precio)
  from tmp_candy_pedido t
  left join public.candy_productos cp on t.tipo = 'producto' and cp.id = t.item_id
  left join public.combos c on t.tipo = 'combo' and c.id = t.item_id;

  insert into public.compra_candy_items (compra_id, candy_producto_id, cantidad, precio_unitario, recompensa_id)
  select v_compra_id, r.candy_producto_id, t.cantidad, 0, r.id
  from tmp_canje_pedido t
  join public.recompensas_puntos r on r.id = t.recompensa_id;

  select coalesce(sum(cantidad * precio_unitario), 0) into v_subtotal
  from public.compra_candy_items where compra_id = v_compra_id;

  v_descuento_monto := round(v_subtotal * coalesce(v_descuento.porcentaje, 0) / 100, 2);
  v_total := v_subtotal - v_descuento_monto;

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

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', case when i.combo_id is not null then 'combo' else 'producto' end,
           'id', coalesce(i.combo_id, i.candy_producto_id),
           'nombre', coalesce(c.nombre, cp.nombre),
           'cantidad', i.cantidad,
           'precio_unitario', i.precio_unitario,
           'incluye_entrada', false,
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
    'entradas', '[]'::jsonb,
    'candy', v_candy
  );
end;
$$;

revoke all on function public.crear_compra_candy(jsonb, boolean, text, jsonb) from public;
grant execute on function public.crear_compra_candy(jsonb, boolean, text, jsonb) to anon, authenticated;

create or replace function public.validar_qr(p_codigo text, p_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text := trim(coalesce(p_codigo, ''));
  v_compra public.compras%rowtype;
  v_funcion record;
  v_ahora_local timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_entradas jsonb;
  v_candy jsonb;
  v_detalle jsonb;
  v_resultado jsonb;
  v_ya_usado_at timestamptz;
  v_solo_candy boolean;
  v_fecha_compra date;
begin
  if not public.es_empleado_o_admin() then
    raise exception 'Solo un empleado puede validar códigos QR.';
  end if;

  if p_tipo not in ('sala', 'candy') then
    raise exception 'Tipo de validación inválido.';
  end if;

  if v_codigo ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_compra from public.compras where codigo_qr = lower(v_codigo) for update;
  else
    v_codigo := upper(regexp_replace(v_codigo, '[^A-Za-z0-9]', '', 'g'));
    select * into v_compra from public.compras where codigo_corto = v_codigo for update;
  end if;

  if not found then
    v_resultado := jsonb_build_object(
      'ok', false, 'motivo', 'no_existe',
      'mensaje', 'El código no corresponde a ninguna compra.'
    );
    insert into public.log_auditoria (usuario_id, accion, entidad, detalle)
    values (auth.uid(), 'QR_RECHAZADO', 'compras',
            jsonb_build_object('tipo', p_tipo, 'codigo', left(coalesce(p_codigo, ''), 60), 'motivo', 'no_existe'));
    return v_resultado;
  end if;

  select f.fecha, f.hora_inicio, f.hora_fin, f.formato, f.idioma,
         p.nombre as pelicula, p.clasificacion, s.nombre as sala
  into v_funcion
  from public.compra_entradas ce
  join public.funciones f on f.id = ce.funcion_id
  join public.peliculas p on p.id = f.pelicula_id
  join public.salas s on s.id = f.sala_id
  where ce.compra_id = v_compra.id
  limit 1;

  v_solo_candy := v_funcion.fecha is null;
  v_fecha_compra := (v_compra.created_at at time zone 'America/Argentina/Buenos_Aires')::date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ubicacion', b.fila || '-' || b.columna,
           'tipo', b.tipo
         ) order by b.fila, b.columna), '[]'::jsonb)
  into v_entradas
  from public.compra_entradas ce
  join public.butacas b on b.id = ce.butaca_id
  where ce.compra_id = v_compra.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', case when i.combo_id is not null then 'combo' else 'producto' end,
           'nombre', coalesce(c.nombre, cp.nombre),
           'cantidad', i.cantidad,
           'contenido', case when i.combo_id is null then '[]'::jsonb else (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'nombre', pr.nombre,
                      'cantidad', cpr.cantidad * i.cantidad
                    ) order by pr.nombre), '[]'::jsonb)
             from public.combo_productos cpr
             join public.candy_productos pr on pr.id = cpr.candy_producto_id
             where cpr.combo_id = i.combo_id
           ) end
         ) order by (i.combo_id is null), coalesce(c.nombre, cp.nombre)), '[]'::jsonb)
  into v_candy
  from public.compra_candy_items i
  left join public.combos c on c.id = i.combo_id
  left join public.candy_productos cp on cp.id = i.candy_producto_id
  where i.compra_id = v_compra.id;

  v_detalle := jsonb_build_object(
    'tipo', p_tipo,
    'compra_id', v_compra.id,
    'codigo_corto', v_compra.codigo_corto,
    'pelicula', v_funcion.pelicula,
    'clasificacion', v_funcion.clasificacion,
    'sala', v_funcion.sala,
    'fecha', v_funcion.fecha,
    'hora_inicio', v_funcion.hora_inicio,
    'hora_fin', v_funcion.hora_fin,
    'formato', v_funcion.formato,
    'idioma', v_funcion.idioma,
    'entradas', v_entradas,
    'candy', v_candy,
    'entrada_validada_at', v_compra.entrada_validada_at,
    'candy_entregado_at', v_compra.candy_entregado_at,
    'solo_candy', v_solo_candy,
    'fecha_compra', v_fecha_compra
  );

  if v_compra.estado <> 'confirmada' then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'cancelada', 'mensaje', 'La compra fue cancelada.');
  elsif v_solo_candy and p_tipo = 'sala' then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'sin_funcion',
      'mensaje', 'Esta compra es sólo de Candy Bar: no tiene entradas para la sala.');
  elsif p_tipo = 'sala' and v_compra.entrada_validada_at is not null then
    v_ya_usado_at := v_compra.entrada_validada_at;
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'ya_utilizado',
      'mensaje', 'Estas entradas ya ingresaron a la sala el ' ||
                 to_char(v_ya_usado_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI') || '.');
  elsif p_tipo = 'candy' and jsonb_array_length(v_candy) = 0 then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'sin_candy', 'mensaje', 'Esta compra no incluye productos del Candy Bar.');
  elsif p_tipo = 'candy' and v_compra.candy_entregado_at is not null then
    v_ya_usado_at := v_compra.candy_entregado_at;
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'ya_utilizado',
      'mensaje', 'Los productos ya se entregaron el ' ||
                 to_char(v_ya_usado_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM "a las" HH24:MI') || '.');
  elsif v_solo_candy and v_fecha_compra <> v_ahora_local::date then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'vencida',
      'mensaje', 'El pedido era para retirar el ' || to_char(v_fecha_compra, 'DD/MM/YYYY') || ', el día de la compra.');
  elsif not v_solo_candy and v_funcion.fecha <> v_ahora_local::date then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false,
      'motivo', case when v_funcion.fecha < v_ahora_local::date then 'vencida' else 'otra_fecha' end,
      'mensaje', 'La función es el ' || to_char(v_funcion.fecha, 'DD/MM/YYYY') || ', no hoy.');
  elsif p_tipo = 'sala' and v_ahora_local::time > v_funcion.hora_fin then
    v_resultado := v_detalle || jsonb_build_object(
      'ok', false, 'motivo', 'vencida', 'mensaje', 'La función ya terminó.');
  end if;

  if v_resultado is not null then
    insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
    values (auth.uid(), 'QR_RECHAZADO', 'compras', v_compra.id,
            jsonb_build_object('tipo', p_tipo, 'codigo_corto', v_compra.codigo_corto,
                               'motivo', v_resultado ->> 'motivo'));
    return v_resultado;
  end if;

  if p_tipo = 'sala' then
    update public.compras
    set entrada_validada_at = now(),
        entrada_validada_por = auth.uid(),
        qr_vigente = (jsonb_array_length(v_candy) > 0 and candy_entregado_at is null)
    where id = v_compra.id;
  else
    update public.compras
    set candy_entregado_at = now(),
        candy_entregado_por = auth.uid(),
        qr_vigente = (entrada_validada_at is null and not v_solo_candy)
    where id = v_compra.id;
  end if;

  insert into public.log_auditoria (usuario_id, accion, entidad, entidad_id, detalle)
  values (auth.uid(),
          case when p_tipo = 'sala' then 'QR_VALIDADO_SALA' else 'QR_ENTREGA_CANDY' end,
          'compras', v_compra.id,
          jsonb_build_object('codigo_corto', v_compra.codigo_corto,
                             'entradas', jsonb_array_length(v_entradas),
                             'items_candy', jsonb_array_length(v_candy)));

  return v_detalle || jsonb_build_object(
    'ok', true,
    'motivo', 'validado',
    'mensaje', case when p_tipo = 'sala' then 'Acceso habilitado.' else 'Entregar los productos.' end,
    'candy_pendiente', p_tipo = 'sala' and jsonb_array_length(v_candy) > 0 and v_compra.candy_entregado_at is null
  );
end;
$$;

revoke all on function public.validar_qr(text, text) from public;
grant execute on function public.validar_qr(text, text) to authenticated;

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
    if not exists (select 1 from public.compra_candy_items where compra_id = v_compra.id) then
      raise exception 'La compra no tiene una función asociada.';
    end if;
  elsif v_ahora_local > v_inicio - interval '2 hours' then
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
