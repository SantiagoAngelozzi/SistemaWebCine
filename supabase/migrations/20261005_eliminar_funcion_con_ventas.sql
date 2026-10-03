-- ============================================================
-- Eliminar funciones: mensaje claro cuando tiene entradas vendidas
-- ------------------------------------------------------------
-- Una función con compras no se puede borrar: compra_entradas apunta
-- a ella (clave foránea) y borrarla rompería el historial de compras,
-- los reportes y "Mis Películas". Antes la base devolvía un error
-- técnico de clave foránea; ahora explica el motivo.
--
-- Se ejecuta después de 20261004_bloquear_funciones_pasadas.sql. Es idempotente.
-- ============================================================

create or replace function public.eliminar_funcion(p_funcion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendidas integer;
  v_canceladas integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar funciones.';
  end if;

  if not exists (select 1 from public.funciones where id = p_funcion_id) then
    raise exception 'La función no existe (quizás ya se eliminó).';
  end if;

  select count(*) filter (where activa), count(*) filter (where not activa)
    into v_vendidas, v_canceladas
  from public.compra_entradas
  where funcion_id = p_funcion_id;

  if v_vendidas > 0 then
    raise exception 'No se puede eliminar: la función tiene % entrada(s) vendida(s). Las compras forman parte del historial y de los reportes.', v_vendidas;
  end if;

  if v_canceladas > 0 then
    raise exception 'No se puede eliminar: la función tiene % entrada(s) de compras canceladas, que siguen en el historial (crédito otorgado).', v_canceladas;
  end if;

  delete from public.funciones where id = p_funcion_id;
end;
$$;

revoke all on function public.eliminar_funcion(uuid) from public;
grant execute on function public.eliminar_funcion(uuid) to authenticated;
