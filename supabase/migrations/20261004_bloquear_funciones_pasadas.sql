create or replace function public.solicitud_desde_la_app()
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    nullif(current_setting('request.jwt.claim.role', true), '')
  ) is not null;
$$;

create or replace function public.ahora_argentina()
returns timestamp
language sql
stable
as $$
  select now() at time zone 'America/Argentina/Buenos_Aires';
$$;

create or replace function public.validar_funcion_vigente_para_venta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio timestamp;
begin
  if not public.solicitud_desde_la_app() then
    return new;
  end if;

  select f.fecha + f.hora_inicio into v_inicio
  from public.funciones f
  where f.id = new.funcion_id;

  if v_inicio is not null and v_inicio <= public.ahora_argentina() then
    raise exception 'Esta función ya comenzó: no se pueden comprar entradas.';
  end if;

  return new;
end;
$$;

drop trigger if exists compra_entradas_funcion_vigente on public.compra_entradas;
create trigger compra_entradas_funcion_vigente
before insert on public.compra_entradas
for each row execute function public.validar_funcion_vigente_para_venta();

create or replace function public.validar_funcion_futura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.solicitud_desde_la_app() then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.fecha = old.fecha
     and new.hora_inicio = old.hora_inicio then
    return new;
  end if;

  if new.fecha + new.hora_inicio <= public.ahora_argentina() then
    raise exception 'No se pueden programar funciones en una fecha u hora que ya pasó.';
  end if;

  return new;
end;
$$;

drop trigger if exists funciones_no_en_el_pasado on public.funciones;
create trigger funciones_no_en_el_pasado
before insert or update of fecha, hora_inicio on public.funciones
for each row execute function public.validar_funcion_futura();
