create extension if not exists "pgcrypto";

create type rol_usuario as enum ('cliente', 'empleado', 'administrador');
create type idioma_pelicula as enum ('castellano', 'subtitulada');
create type clasificacion_edad as enum ('ATP', '+13', '+18');
create type formato_proyeccion as enum ('2D', '3D', '4D', '5D');
create type tipo_butaca as enum ('estandar', 'accesible', 'vip');
create type estado_compra as enum ('confirmada', 'cancelada');
create type tipo_cupon as enum ('bienvenida', 'segmentado_edad', 'general');

create table public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  nombre text,
  apellido text,
  fecha_nacimiento date,
  tipo_sangre text,
  color_ojos text,
  dias_vacaciones integer,
  rol rol_usuario not null default 'cliente',
  puntos integer not null default 0,
  credito numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.usuarios enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.usuarios
    where id = auth.uid() and rol = 'administrador'
  );
$$;

create policy "usuarios_select_own_or_admin" on public.usuarios
  for select using (auth.uid() = id or public.is_admin());

create policy "usuarios_update_own" on public.usuarios
  for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.usuarios (id, email, nombre, apellido, fecha_nacimiento, tipo_sangre, color_ojos, dias_vacaciones)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'nombre',
    new.raw_user_meta_data ->> 'apellido',
    nullif(new.raw_user_meta_data ->> 'fechaNacimiento', '')::date,
    new.raw_user_meta_data ->> 'tipoSangre',
    new.raw_user_meta_data ->> 'colorOjos',
    nullif(new.raw_user_meta_data ->> 'diasVacaciones', '')::integer
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.usuarios (id, email)
select id, email from auth.users
on conflict (id) do nothing;

create table public.generos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table public.peliculas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  sinopsis text,
  imagen_url text,
  duracion_minutos integer not null,
  idioma idioma_pelicula not null default 'castellano',
  clasificacion clasificacion_edad not null default 'ATP',
  fecha_estreno date not null,
  precio_normal numeric(10, 2) not null,
  precio_preventa numeric(10, 2),
  dias_preventa integer not null default 7,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pelicula_generos (
  pelicula_id uuid references public.peliculas (id) on delete cascade,
  genero_id uuid references public.generos (id) on delete cascade,
  primary key (pelicula_id, genero_id)
);

create table public.pelicula_formatos (
  pelicula_id uuid references public.peliculas (id) on delete cascade,
  formato formato_proyeccion not null,
  primary key (pelicula_id, formato)
);

alter table public.generos enable row level security;
alter table public.peliculas enable row level security;
alter table public.pelicula_generos enable row level security;
alter table public.pelicula_formatos enable row level security;

create policy "generos_select_all" on public.generos for select using (true);
create policy "generos_admin_write" on public.generos for all using (public.is_admin()) with check (public.is_admin());

create policy "peliculas_select_all" on public.peliculas for select using (true);
create policy "peliculas_admin_write" on public.peliculas for all using (public.is_admin()) with check (public.is_admin());

create policy "pelicula_generos_select_all" on public.pelicula_generos for select using (true);
create policy "pelicula_generos_admin_write" on public.pelicula_generos for all using (public.is_admin()) with check (public.is_admin());

create policy "pelicula_formatos_select_all" on public.pelicula_formatos for select using (true);
create policy "pelicula_formatos_admin_write" on public.pelicula_formatos for all using (public.is_admin()) with check (public.is_admin());

create table public.salas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table public.butacas (
  id uuid primary key default gen_random_uuid(),
  sala_id uuid not null references public.salas (id) on delete cascade,
  fila text not null,
  columna integer not null,
  tipo tipo_butaca not null default 'estandar',
  unique (sala_id, fila, columna)
);

create table public.funciones (
  id uuid primary key default gen_random_uuid(),
  pelicula_id uuid not null references public.peliculas (id) on delete cascade,
  sala_id uuid not null references public.salas (id) on delete restrict,
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  formato formato_proyeccion not null,
  idioma idioma_pelicula not null,
  created_by uuid references public.usuarios (id),
  created_at timestamptz not null default now()
);

alter table public.salas enable row level security;
alter table public.butacas enable row level security;
alter table public.funciones enable row level security;

create policy "salas_select_all" on public.salas for select using (true);
create policy "salas_admin_write" on public.salas for all using (public.is_admin()) with check (public.is_admin());

create policy "butacas_select_all" on public.butacas for select using (true);
create policy "butacas_admin_write" on public.butacas for all using (public.is_admin()) with check (public.is_admin());

create policy "funciones_select_all" on public.funciones for select using (true);
create policy "funciones_admin_write" on public.funciones for all using (public.is_admin()) with check (public.is_admin());

create table public.candy_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

create table public.candy_productos (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid references public.candy_categorias (id) on delete set null,
  nombre text not null,
  precio numeric(10, 2) not null,
  imagen_url text,
  activo boolean not null default true
);

create table public.combos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  precio numeric(10, 2) not null,
  incluye_entrada boolean not null default true,
  activo boolean not null default true
);

create table public.combo_productos (
  combo_id uuid references public.combos (id) on delete cascade,
  candy_producto_id uuid references public.candy_productos (id) on delete cascade,
  cantidad integer not null default 1,
  primary key (combo_id, candy_producto_id)
);

create table public.cupones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo tipo_cupon not null default 'general',
  porcentaje_descuento numeric(5, 2) not null,
  edad_minima integer,
  activo boolean not null default true,
  fecha_desde date not null default current_date,
  fecha_hasta date,
  usos_maximos integer
);

create table public.cupon_usos (
  id uuid primary key default gen_random_uuid(),
  cupon_id uuid not null references public.cupones (id) on delete cascade,
  usuario_id uuid references public.usuarios (id) on delete set null,
  compra_id uuid,
  created_at timestamptz not null default now()
);

create table public.recompensas_puntos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  costo_puntos integer not null,
  candy_producto_id uuid references public.candy_productos (id),
  otorga_entrada boolean not null default false,
  activo boolean not null default true
);

create table public.canjes_puntos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  recompensa_id uuid not null references public.recompensas_puntos (id),
  puntos_utilizados integer not null,
  created_at timestamptz not null default now()
);

alter table public.candy_categorias enable row level security;
alter table public.candy_productos enable row level security;
alter table public.combos enable row level security;
alter table public.combo_productos enable row level security;
alter table public.cupones enable row level security;
alter table public.cupon_usos enable row level security;
alter table public.recompensas_puntos enable row level security;
alter table public.canjes_puntos enable row level security;

create policy "candy_categorias_select_all" on public.candy_categorias for select using (true);
create policy "candy_categorias_admin_write" on public.candy_categorias for all using (public.is_admin()) with check (public.is_admin());

create policy "candy_productos_select_all" on public.candy_productos for select using (true);
create policy "candy_productos_admin_write" on public.candy_productos for all using (public.is_admin()) with check (public.is_admin());

create policy "combos_select_all" on public.combos for select using (true);
create policy "combos_admin_write" on public.combos for all using (public.is_admin()) with check (public.is_admin());

create policy "combo_productos_select_all" on public.combo_productos for select using (true);
create policy "combo_productos_admin_write" on public.combo_productos for all using (public.is_admin()) with check (public.is_admin());

create policy "cupones_select_all" on public.cupones for select using (true);
create policy "cupones_admin_write" on public.cupones for all using (public.is_admin()) with check (public.is_admin());

create policy "cupon_usos_select_own_or_admin" on public.cupon_usos
  for select using (usuario_id = auth.uid() or public.is_admin());
create policy "cupon_usos_insert_own" on public.cupon_usos
  for insert with check (usuario_id = auth.uid() or public.is_admin());

create policy "recompensas_select_all" on public.recompensas_puntos for select using (true);
create policy "recompensas_admin_write" on public.recompensas_puntos for all using (public.is_admin()) with check (public.is_admin());

create policy "canjes_select_own_or_admin" on public.canjes_puntos
  for select using (usuario_id = auth.uid() or public.is_admin());
create policy "canjes_insert_own" on public.canjes_puntos
  for insert with check (usuario_id = auth.uid());

create table public.compras (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios (id) on delete set null,
  cupon_id uuid references public.cupones (id),
  credito_usado numeric(10, 2) not null default 0,
  metodo_pago text,
  total numeric(10, 2) not null default 0,
  estado estado_compra not null default 'confirmada',
  codigo_qr text not null unique,
  qr_vigente boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.compra_entradas (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras (id) on delete cascade,
  funcion_id uuid not null references public.funciones (id),
  butaca_id uuid not null references public.butacas (id),
  precio numeric(10, 2) not null,
  unique (funcion_id, butaca_id)
);

create table public.compra_candy_items (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null references public.compras (id) on delete cascade,
  candy_producto_id uuid references public.candy_productos (id),
  combo_id uuid references public.combos (id),
  cantidad integer not null default 1,
  precio_unitario numeric(10, 2) not null
);

alter table public.cupon_usos
  add constraint cupon_usos_compra_fk foreign key (compra_id) references public.compras (id) on delete set null;

alter table public.compras enable row level security;
alter table public.compra_entradas enable row level security;
alter table public.compra_candy_items enable row level security;

create policy "compras_select_own_or_admin" on public.compras
  for select using (usuario_id = auth.uid() or usuario_id is null or public.is_admin());
create policy "compras_insert_own_or_anon" on public.compras
  for insert with check (usuario_id = auth.uid() or usuario_id is null);
create policy "compras_update_own_or_admin" on public.compras
  for update using (usuario_id = auth.uid() or public.is_admin());

create policy "compra_entradas_select_via_compra" on public.compra_entradas
  for select using (
    exists (
      select 1 from public.compras c
      where c.id = compra_id and (c.usuario_id = auth.uid() or c.usuario_id is null or public.is_admin())
    )
  );
create policy "compra_entradas_insert_via_compra" on public.compra_entradas
  for insert with check (
    exists (
      select 1 from public.compras c
      where c.id = compra_id and (c.usuario_id = auth.uid() or c.usuario_id is null)
    )
  );

create policy "compra_candy_items_select_via_compra" on public.compra_candy_items
  for select using (
    exists (
      select 1 from public.compras c
      where c.id = compra_id and (c.usuario_id = auth.uid() or c.usuario_id is null or public.is_admin())
    )
  );
create policy "compra_candy_items_insert_via_compra" on public.compra_candy_items
  for insert with check (
    exists (
      select 1 from public.compras c
      where c.id = compra_id and (c.usuario_id = auth.uid() or c.usuario_id is null)
    )
  );

create table public.resenas (
  id uuid primary key default gen_random_uuid(),
  pelicula_id uuid not null references public.peliculas (id) on delete cascade,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  calificacion integer not null check (calificacion between 1 and 5),
  comentario text,
  created_at timestamptz not null default now(),
  unique (pelicula_id, usuario_id)
);

create table public.alertas_estreno (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  pelicula_id uuid not null references public.peliculas (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (usuario_id, pelicula_id)
);

alter table public.resenas enable row level security;
alter table public.alertas_estreno enable row level security;

create policy "resenas_select_all" on public.resenas for select using (true);
create policy "resenas_insert_own" on public.resenas for insert with check (usuario_id = auth.uid());
create policy "resenas_update_own" on public.resenas for update using (usuario_id = auth.uid());
create policy "resenas_delete_own_or_admin" on public.resenas for delete using (usuario_id = auth.uid() or public.is_admin());

create policy "alertas_select_own" on public.alertas_estreno for select using (usuario_id = auth.uid());
create policy "alertas_insert_own" on public.alertas_estreno for insert with check (usuario_id = auth.uid());
create policy "alertas_delete_own" on public.alertas_estreno for delete using (usuario_id = auth.uid());

create table public.log_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios (id),
  accion text not null,
  entidad text,
  entidad_id uuid,
  detalle jsonb,
  created_at timestamptz not null default now()
);

alter table public.log_auditoria enable row level security;

create policy "log_auditoria_admin_all" on public.log_auditoria
  for all using (public.is_admin()) with check (public.is_admin());
