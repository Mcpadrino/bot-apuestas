-- Esquema de la base de datos de Bitácora de apuestas (Supabase / Postgres)
-- Generado automáticamente. Córrelo completo en el SQL Editor de tu proyecto nuevo de Supabase.

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists privado;
revoke all on schema privado from anon, authenticated;

create sequence if not exists public.opiniones_id_seq;

create table if not exists privado.avisos (
  usuario text not null,
  clave text not null,
  creado timestamp with time zone default now(),
  constraint avisos_pkey PRIMARY KEY (usuario, clave)
);
alter table privado.avisos enable row level security;

create table if not exists privado.enlaces (
  codigo text not null,
  chat_id text not null,
  expira timestamp with time zone not null default (now() + '00:15:00'::interval),
  constraint enlaces_pkey PRIMARY KEY (codigo)
);
alter table privado.enlaces enable row level security;

create table if not exists privado.esperas (
  chat_id text not null,
  senal_id bigint not null,
  expira timestamp with time zone not null,
  constraint esperas_pkey PRIMARY KEY (chat_id)
);
alter table privado.esperas enable row level security;

create table if not exists privado.invitaciones (
  codigo text not null,
  usos_max integer not null default 1,
  usos integer not null default 0,
  expira timestamp with time zone not null,
  nota text,
  creado timestamp with time zone not null default now(),
  constraint invitaciones_pkey PRIMARY KEY (codigo)
);
alter table privado.invitaciones enable row level security;

create table if not exists privado.secretos (
  nombre text not null,
  valor text not null,
  constraint secretos_pkey PRIMARY KEY (nombre)
);
alter table privado.secretos enable row level security;

create table if not exists privado.sesiones (
  token_hash text not null,
  chat_id text not null,
  expira timestamp with time zone not null default (now() + '30 days'::interval),
  constraint sesiones_pkey PRIMARY KEY (token_hash)
);
alter table privado.sesiones enable row level security;

create table if not exists public.apuestas (
  id bigint generated always as identity,
  creada timestamp with time zone not null default now(),
  partido text not null default ''::text,
  seleccion text not null,
  casa text not null default ''::text,
  cuota numeric not null,
  prob numeric,
  monto numeric not null,
  resultado text not null default 'pendiente'::text,
  cerrada timestamp with time zone,
  usuario text not null,
  cartera text not null default 'bot'::text,
  marcador text,
  logo text,
  evento text,
  descartados text[] not null default '{}'::text[],
  liga text,
  liga_logo text,
  prob_cierre numeric,
  clv numeric,
  clv_revisado boolean not null default false,
  constraint apuestas_cartera_check CHECK ((cartera = ANY (ARRAY['bot'::text, 'libre'::text]))),
  constraint apuestas_cuota_check CHECK ((cuota > (1)::numeric)),
  constraint apuestas_monto_check CHECK ((monto > (0)::numeric)),
  constraint apuestas_pkey PRIMARY KEY (id),
  constraint apuestas_prob_check CHECK (((prob IS NULL) OR ((prob > (0)::numeric) AND (prob < (1)::numeric)))),
  constraint apuestas_resultado_check CHECK ((resultado = ANY (ARRAY['pendiente'::text, 'gana'::text, 'pierde'::text, 'nula'::text])))
);
alter table public.apuestas enable row level security;

create table if not exists public.archivo (
  evento text not null,
  ruta text not null,
  liga text,
  deporte text,
  fecha timestamp with time zone not null,
  local text,
  visita text,
  local_completo text,
  visita_completo text,
  logo_local text,
  logo_visita text,
  goles_local numeric,
  goles_visita numeric,
  res text,
  busca text,
  guardado timestamp with time zone default now(),
  constraint archivo_pkey PRIMARY KEY (evento)
);
alter table public.archivo enable row level security;

create table if not exists public.config (
  clave text not null,
  valor text not null,
  constraint config_pkey PRIMARY KEY (clave)
);
alter table public.config enable row level security;

create table if not exists public.cotizaciones (
  id bigint generated always as identity,
  usuario text not null,
  evento text not null,
  mercado text not null,
  seleccion text not null,
  partido text,
  deporte text,
  inicio timestamp with time zone,
  casa text not null,
  cuota numeric not null,
  prob numeric,
  minima numeric,
  creada timestamp with time zone not null default now(),
  constraint cotizaciones_pkey PRIMARY KEY (id),
  constraint cotizaciones_usuario_evento_mercado_seleccion_casa_key UNIQUE (usuario, evento, mercado, seleccion, casa)
);
alter table public.cotizaciones enable row level security;

create table if not exists public.estado_sistema (
  clave text not null,
  valor jsonb,
  actualizado timestamp with time zone not null default now(),
  constraint estado_sistema_pkey PRIMARY KEY (clave)
);
alter table public.estado_sistema enable row level security;

create table if not exists public.logros (
  usuario text not null,
  logro text not null,
  creada timestamp with time zone not null default now(),
  constraint logros_pkey PRIMARY KEY (usuario, logro)
);
alter table public.logros enable row level security;

create table if not exists public.mascota (
  usuario text not null,
  nombre text not null default 'Momio'::text,
  items jsonb not null default '[]'::jsonb,
  puestos jsonb not null default '[]'::jsonb,
  comida timestamp with time zone not null default now(),
  creada timestamp with time zone not null default now(),
  especie text not null default 'perro'::text,
  especie_elegida boolean not null default false,
  constraint mascota_pkey PRIMARY KEY (usuario)
);
alter table public.mascota enable row level security;

create table if not exists public.monedas (
  id bigint generated always as identity,
  usuario text not null,
  concepto text not null,
  monto numeric not null,
  puntos integer,
  creada timestamp with time zone not null default now(),
  constraint monedas_pkey PRIMARY KEY (id)
);
alter table public.monedas enable row level security;

create table if not exists public.movimientos (
  id bigint generated always as identity,
  usuario text not null,
  tipo text not null,
  monto numeric not null,
  nota text,
  anulado boolean not null default false,
  creada timestamp with time zone not null default now(),
  cartera text not null default 'bot'::text,
  constraint movimientos_cartera_check CHECK ((cartera = ANY (ARRAY['bot'::text, 'libre'::text]))),
  constraint movimientos_monto_check CHECK ((monto > (0)::numeric)),
  constraint movimientos_pkey PRIMARY KEY (id),
  constraint movimientos_tipo_check CHECK ((tipo = ANY (ARRAY['retiro'::text, 'deposito'::text])))
);
alter table public.movimientos enable row level security;

create table if not exists public.opiniones (
  id bigint not null default nextval('public.opiniones_id_seq'::regclass),
  usuario text not null,
  tipo text not null default 'idea'::text,
  estrellas integer,
  texto text not null,
  seccion text,
  estado text not null default 'nueva'::text,
  respuesta text,
  votos text[] not null default '{}'::text[],
  creado timestamp with time zone not null default now(),
  actualizado timestamp with time zone not null default now(),
  constraint opiniones_estado_check CHECK ((estado = ANY (ARRAY['nueva'::text, 'vista'::text, 'en_proceso'::text, 'hecha'::text, 'no'::text]))),
  constraint opiniones_estrellas_check CHECK (((estrellas >= 1) AND (estrellas <= 5))),
  constraint opiniones_pkey PRIMARY KEY (id),
  constraint opiniones_tipo_check CHECK ((tipo = ANY (ARRAY['idea'::text, 'error'::text, 'opinion'::text])))
);
alter table public.opiniones enable row level security;

create table if not exists public.practica (
  id bigint generated always as identity,
  usuario text not null,
  tipo text not null,
  monto numeric not null,
  cuota numeric not null,
  estado text not null default 'pendiente'::text,
  ganancia numeric,
  oculta boolean not null default false,
  creada timestamp with time zone not null default now(),
  cerrada timestamp with time zone,
  torneo date,
  constraint practica_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'gana'::text, 'pierde'::text, 'nula'::text]))),
  constraint practica_monto_check CHECK ((monto > (0)::numeric)),
  constraint practica_pkey PRIMARY KEY (id),
  constraint practica_tipo_check CHECK ((tipo = ANY (ARRAY['simple'::text, 'parlay'::text])))
);
alter table public.practica enable row level security;

create table if not exists public.practica_piernas (
  id bigint generated always as identity,
  practica_id bigint not null,
  senal_id bigint,
  evento text,
  partido text not null,
  deporte text not null default ''::text,
  inicio timestamp with time zone,
  mercado text not null,
  seleccion text not null,
  cuota numeric not null,
  resultado text not null default 'pendiente'::text,
  marcador text,
  constraint practica_piernas_pkey PRIMARY KEY (id),
  constraint practica_piernas_resultado_check CHECK ((resultado = ANY (ARRAY['pendiente'::text, 'gana'::text, 'pierde'::text, 'nula'::text])))
);
alter table public.practica_piernas enable row level security;

create table if not exists public.pronosticos (
  evento text not null,
  ruta text not null,
  liga text,
  deporte text not null,
  inicio timestamp with time zone not null,
  local text,
  visita text,
  logo_local text,
  logo_visita text,
  modelo text,
  p_local numeric,
  p_empate numeric,
  p_visita numeric,
  datos jsonb not null default '{}'::jsonb,
  mercado jsonb,
  res text,
  marcador text,
  creada timestamp with time zone not null default now(),
  actualizada timestamp with time zone not null default now(),
  constraint pronosticos_pkey PRIMARY KEY (evento)
);
alter table public.pronosticos enable row level security;

create table if not exists public.publicaciones (
  id bigint generated always as identity,
  usuario text not null,
  texto text not null default ''::text,
  link text,
  imagen text,
  creada timestamp with time zone not null default now(),
  expira timestamp with time zone not null default (now() + '48:00:00'::interval),
  activa boolean not null default true,
  constraint publicaciones_pkey PRIMARY KEY (id)
);
alter table public.publicaciones enable row level security;

create table if not exists public.quiniela_picks (
  usuario text not null,
  evento text not null,
  liga text not null default 'soccer/mex.1'::text,
  partido text not null default ''::text,
  inicio timestamp with time zone not null,
  pick text not null,
  creada timestamp with time zone not null default now(),
  constraint quiniela_picks_pick_check CHECK ((pick = ANY (ARRAY['L'::text, 'E'::text, 'V'::text]))),
  constraint quiniela_picks_pkey PRIMARY KEY (usuario, evento)
);
alter table public.quiniela_picks enable row level security;

create table if not exists public.quiniela_res (
  evento text not null,
  res text not null,
  marcador text,
  guardado timestamp with time zone default now(),
  constraint quiniela_res_pkey PRIMARY KEY (evento),
  constraint quiniela_res_res_check CHECK ((res = ANY (ARRAY['L'::text, 'E'::text, 'V'::text])))
);
alter table public.quiniela_res enable row level security;

create table if not exists public.reacciones (
  publicacion_id bigint not null,
  usuario text not null,
  emoji text not null,
  activa boolean not null default true,
  constraint reacciones_emoji_check CHECK ((emoji = ANY (ARRAY['🔥'::text, '👍'::text, '😂'::text]))),
  constraint reacciones_pkey PRIMARY KEY (publicacion_id, usuario, emoji)
);
alter table public.reacciones enable row level security;

create table if not exists public.retos (
  id bigint generated always as identity,
  retador text not null,
  rival text not null,
  evento text not null,
  liga text not null,
  partido text not null,
  inicio timestamp with time zone not null,
  local text not null,
  visita text not null,
  logo_local text,
  logo_visita text,
  lado text not null,
  premio text not null default ''::text,
  estado text not null default 'pendiente'::text,
  ganador text,
  marcador text,
  creada timestamp with time zone not null default now(),
  constraint retos_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aceptado'::text, 'rechazado'::text, 'terminado'::text, 'cancelado'::text]))),
  constraint retos_lado_check CHECK ((lado = ANY (ARRAY['local'::text, 'visita'::text]))),
  constraint retos_pkey PRIMARY KEY (id)
);
alter table public.retos enable row level security;

create table if not exists public.senales (
  id bigint generated always as identity,
  lote text not null,
  evento text not null,
  partido text not null,
  deporte text not null default ''::text,
  inicio timestamp with time zone,
  mercado text not null,
  seleccion text not null,
  prob numeric,
  minima numeric,
  creada timestamp with time zone not null default now(),
  pin numeric,
  constraint senales_pkey PRIMARY KEY (id)
);
alter table public.senales enable row level security;

create table if not exists public.uso (
  dia date not null,
  usuario text not null,
  seccion text not null,
  n integer not null default 1,
  constraint uso_pkey PRIMARY KEY (dia, usuario, seccion)
);
alter table public.uso enable row level security;

create table if not exists public.usuarios (
  chat_id text not null,
  nombre text not null default ''::text,
  banca_inicial numeric not null default 200,
  activo boolean not null default true,
  creado timestamp with time zone not null default now(),
  usuario_web text,
  pass_hash text,
  fallos integer not null default 0,
  bloqueo timestamp with time zone,
  limite_semanal numeric,
  equipo_fav jsonb,
  practica_banca numeric not null default 1000,
  tema jsonb,
  terminos jsonb,
  avisos jsonb,
  ultima_vez timestamp with time zone,
  constraint usuarios_banca_inicial_check CHECK ((banca_inicial > (0)::numeric)),
  constraint usuarios_limite_semanal_check CHECK (((limite_semanal IS NULL) OR (limite_semanal > (0)::numeric))),
  constraint usuarios_pkey PRIMARY KEY (chat_id),
  constraint usuarios_usuario_web_key UNIQUE (usuario_web)
);
alter table public.usuarios enable row level security;

create table if not exists public.votos (
  usuario text not null,
  evento text not null,
  mercado text not null,
  seleccion text not null,
  voto text,
  partido text,
  inicio timestamp with time zone,
  creada timestamp with time zone not null default now(),
  constraint votos_pkey PRIMARY KEY (usuario, evento, mercado, seleccion)
);
alter table public.votos enable row level security;

CREATE INDEX IF NOT EXISTS apuestas_usuario_resultado_idx ON public.apuestas USING btree (usuario, resultado);
CREATE INDEX IF NOT EXISTS archivo_fecha ON public.archivo USING btree (fecha DESC);
CREATE INDEX IF NOT EXISTS archivo_ruta ON public.archivo USING btree (ruta, fecha DESC);
CREATE INDEX IF NOT EXISTS practica_torneo ON public.practica USING btree (torneo) WHERE (torneo IS NOT NULL);
CREATE INDEX IF NOT EXISTS publicaciones_activas ON public.publicaciones USING btree (activa, creada);
CREATE INDEX IF NOT EXISTS senales_lote_evento ON public.senales USING btree (lote, evento);

-- ======================= funciones (toda la lógica vive aquí)

CREATE OR REPLACE FUNCTION privado.disparar(p_workflow text, p_inputs jsonb DEFAULT '{}'::jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_token text; v_id bigint;
begin
  select valor into v_token from privado.secretos where nombre = 'github';
  if v_token is null then return null; end if;
  select net.http_post(
    url := 'https://api.github.com/repos/Mcpadrino/bot-apuestas/actions/workflows/' || p_workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', p_inputs),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Accept', 'application/vnd.github+json',
                                  'User-Agent', 'despertador-bot-apuestas', 'X-GitHub-Api-Version', '2022-11-28', 'Content-Type', 'application/json')
  ) into v_id;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION privado.esquema_sql()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare out text := ''; rec record;
begin
  out := E'-- Esquema de la base de datos de Bitácora de apuestas (Supabase / Postgres)\n-- Generado automáticamente. Córrelo completo en el SQL Editor de tu proyecto nuevo de Supabase.\n\n'
      || E'create extension if not exists pgcrypto;\ncreate extension if not exists pg_cron;\ncreate extension if not exists pg_net;\n\n'
      || E'create schema if not exists privado;\nrevoke all on schema privado from anon, authenticated;\n\n';
  for rec in select sequence_schema s, sequence_name n from information_schema.sequences where sequence_schema in ('public','privado') loop
    out := out || format(E'create sequence if not exists %I.%I;\n', rec.s, rec.n);
  end loop;
  out := out || E'\n';
  -- tablas
  for rec in
    with t as (select c.oid, n.nspname s, c.relname r from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where c.relkind='r' and n.nspname in ('public','privado')),
    cols as (select t.oid, t.s, t.r, string_agg(format('  %I %s%s%s%s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod),
               case a.attidentity when 'a' then ' generated always as identity' when 'd' then ' generated by default as identity' else '' end,
               case when a.attnotnull and a.attidentity = '' then ' not null' else '' end,
               coalesce(' default ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')), E',\n' order by a.attnum) cs
             from t join pg_catalog.pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
             left join pg_catalog.pg_attrdef d on d.adrelid=t.oid and d.adnum=a.attnum group by t.oid, t.s, t.r),
    cons as (select conrelid, string_agg(format(E',\n  constraint %I %s', conname, pg_catalog.pg_get_constraintdef(oid)), '' order by conname) cc
               from pg_catalog.pg_constraint where contype in ('p','u','c') group by conrelid)
    select format(E'create table if not exists %I.%I (\n%s%s\n);\nalter table %I.%I enable row level security;\n\n', s, r, cs, coalesce(cc, ''), s, r) ddl
      from cols left join cons on cons.conrelid = cols.oid order by s, r
  loop out := out || rec.ddl; end loop;
  -- índices que no son llave
  for rec in select i.indexdef || ';' d from pg_catalog.pg_indexes i
            where i.schemaname in ('public','privado')
              and not exists (select 1 from pg_catalog.pg_constraint c where c.conname = i.indexname)
            order by 1 loop
    out := out || replace(rec.d, 'CREATE INDEX', 'CREATE INDEX IF NOT EXISTS') || E'\n';
  end loop;
  out := out || E'\n-- ======================= funciones (toda la lógica vive aquí)\n\n';
  for rec in select pg_catalog.pg_get_functiondef(p.oid) d from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public','privado') and p.prokind = 'f' order by n.nspname, p.proname loop
    out := out || rec.d || E';\n\n';
  end loop;
  out := out || E'-- ======================= permisos: el navegador NO entra directo a las tablas, todo pasa por las funciones\n'
      || E'revoke all on all tables in schema public from anon, authenticated;\n'
      || E'revoke all on all tables in schema privado from anon, authenticated;\n\n'
      || E'-- ======================= secretos (CAMBIA los valores)\n'
      || E'-- "bot": una clave larga inventada por ti; va también en Vercel como BOT_CLAVE.\n'
      || E'-- "github": un token de GitHub (fine-grained, permiso Actions: write en tu repo) para disparar los procesos a su hora.\n'
      || E'insert into privado.secretos (nombre, valor) values (''bot'', ''CAMBIA-ESTO-POR-UNA-CLAVE-LARGA''), (''github'', ''CAMBIA-ESTO-POR-TU-TOKEN-DE-GITHUB'')\n  on conflict (nombre) do nothing;\n\n'
      || E'-- ======================= horarios (UTC). Antes edita privado.disparar con TU usuario/repositorio de GitHub.\n';
  for rec in select jobname, schedule, command from cron.job order by jobname loop
    out := out || format(E'select cron.schedule(%L, %L, %L);\n', rec.jobname, rec.schedule, rec.command);
  end loop;
  return out;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_cod text; v_inv privado.invitaciones; v_nombre text; v_chat text; v_res jsonb;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then raise exception 'no autorizado'; end if;

  -- ===== uso (cualquier usuario con sesión; la API pasa su chat_id)
  if p_accion = 'uso' then
    insert into public.uso(dia, usuario, seccion) values ((now() at time zone 'America/Mexico_City')::date, v_u, left(coalesce(p_datos->>'seccion','?'), 30))
    on conflict (dia, usuario, seccion) do update set n = public.uso.n + 1;
    update public.usuarios set ultima_vez = now() where chat_id = v_u;
    return '{}'::jsonb;

  -- ===== avisos a la medida (cada usuario los suyos)
  elsif p_accion = 'avisos_get' then
    return coalesce((select avisos from public.usuarios where chat_id = v_u), '{}'::jsonb);
  elsif p_accion = 'momio_set' then
    update public.usuarios set avisos = coalesce(avisos, '{}'::jsonb) || jsonb_build_object('momio', case when p_datos->>'momio' = 'decimal' then 'decimal' else 'americano' end) where chat_id = v_u;
    return jsonb_build_object('ok', true);
  elsif p_accion = 'avisos_set' then
    update public.usuarios set avisos = (p_datos->'avisos') || coalesce(jsonb_build_object('momio', avisos->'momio') - 'x', '{}'::jsonb) where chat_id = v_u;
    return jsonb_build_object('ok', true);

  -- ===== registro con código (sin Telegram)
  elsif p_accion = 'registro' then
    v_cod := upper(trim(coalesce(p_datos->>'codigo','')));
    select * into v_inv from privado.invitaciones where codigo = v_cod for update;
    if v_inv.codigo is null or v_inv.expira < now() or v_inv.usos >= v_inv.usos_max then
      return jsonb_build_object('error', 'Ese código no existe, ya venció o ya se usó.');
    end if;
    v_nombre := lower(trim(coalesce(p_datos->>'nombre_web','')));
    if v_nombre !~ '^[a-z0-9_.]{3,20}$' then return jsonb_build_object('error', 'El usuario debe tener de 3 a 20 letras, números, punto o guion bajo.'); end if;
    if length(coalesce(p_datos->>'pass','')) < 6 then return jsonb_build_object('error', 'La contraseña debe tener al menos 6 caracteres.'); end if;
    if exists(select 1 from public.usuarios where usuario_web = v_nombre) then return jsonb_build_object('error', 'Ese usuario ya está ocupado. Elige otro.'); end if;
    if length(trim(coalesce(p_datos->>'nombre',''))) < 2 then return jsonb_build_object('error', 'Escribe tu nombre.'); end if;
    v_chat := 'w' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 10);
    insert into public.usuarios(chat_id, nombre, banca_inicial, activo, usuario_web, pass_hash, terminos)
    values (v_chat, left(trim(p_datos->>'nombre'), 40), 200, true, v_nombre,
            extensions.crypt(p_datos->>'pass', extensions.gen_salt('bf')),
            jsonb_build_object('v', p_datos->>'v', 'fecha', now(), 'medio', 'registro'));
    update privado.invitaciones set usos = usos + 1 where codigo = v_cod;
    return jsonb_build_object('ok', true, 'chat_id', v_chat);

  -- ===== solo dueño (lo valida la API)
  elsif p_accion = 'invitar' then
    v_cod := upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 6));
    insert into privado.invitaciones(codigo, usos_max, expira, nota)
    values (v_cod, greatest(1, least(coalesce((p_datos->>'usos')::int, 1), 100)),
            now() + make_interval(days => greatest(1, least(coalesce((p_datos->>'dias')::int, 7), 60))), left(p_datos->>'nota', 60))
    returning * into v_inv;
    return to_jsonb(v_inv);
  elsif p_accion = 'invitacion_cerrar' then
    update privado.invitaciones set expira = now() where codigo = upper(p_datos->>'codigo');
    return jsonb_build_object('ok', true);
  elsif p_accion = 'estado_set' then
    insert into public.estado_sistema(clave, valor, actualizado) values (p_datos->>'clave', p_datos->'valor', now())
    on conflict (clave) do update set valor = excluded.valor, actualizado = now();
    return jsonb_build_object('ok', true);
  elsif p_accion = 'usuario_activo' then
    update public.usuarios set activo = coalesce((p_datos->>'activo')::boolean, activo) where chat_id = p_datos->>'chat_id';
    update privado.sesiones set expira = now() where chat_id = p_datos->>'chat_id' and not coalesce((p_datos->>'activo')::boolean, true);
    return jsonb_build_object('ok', true);
  elsif p_accion = 'panel' then
    return jsonb_build_object(
      'usuarios', coalesce((select jsonb_agg(jsonb_build_object(
          'chat_id', x.chat_id, 'nombre', x.nombre, 'activo', x.activo, 'web', x.usuario_web is not null,
          'solo_web', x.chat_id like 'w%', 'creado', x.creado, 'ultima_vez', x.ultima_vez,
          'terminos', x.terminos->>'fecha',
          'apuestas', (select count(*) from public.apuestas a where a.usuario = x.chat_id),
          'apuestas_7d', (select count(*) from public.apuestas a where a.usuario = x.chat_id and a.creada > now() - interval '7 days'))
          order by x.ultima_vez desc nulls last) from public.usuarios x), '[]'::jsonb),
      'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('chat_id', split_part(a.clave, ':', 2), 'fecha', a.creado) order by a.creado desc)
          from privado.avisos a where a.clave like 'solicitud:%' and a.creado > now() - interval '30 days'
            and not exists(select 1 from public.usuarios u where u.chat_id = split_part(a.clave, ':', 2) and u.activo)), '[]'::jsonb),
      'invitaciones', coalesce((select jsonb_agg(to_jsonb(i) order by i.creado desc) from privado.invitaciones i where i.expira > now() - interval '7 days'), '[]'::jsonb),
      'opiniones_nuevas', (select count(*) from public.opiniones where estado = 'nueva'),
      'estado', coalesce((select jsonb_object_agg(clave, jsonb_build_object('valor', valor, 'actualizado', actualizado)) from public.estado_sistema), '{}'::jsonb),
      'uso_dias', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'usuarios', u, 'vistas', v) order by dia) from (
          select dia, count(distinct usuario) u, sum(n) v from public.uso where dia > current_date - 14 group by dia) d), '[]'::jsonb),
      'uso_secciones', coalesce((select jsonb_agg(jsonb_build_object('seccion', seccion, 'vistas', v, 'usuarios', u) order by v desc) from (
          select seccion, sum(n) v, count(distinct usuario) u from public.uso where dia > current_date - 14 group by seccion) s), '[]'::jsonb),
      'senales_hoy', (select count(*) from public.senales where creada > now() - interval '24 hours'),
      'apuestas_hoy', (select count(*) from public.apuestas where creada > now() - interval '24 hours'));
  end if;
  raise exception 'acción desconocida';
end $function$
;

CREATE OR REPLACE FUNCTION public.bot(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ok boolean;
  v_u text := p_datos->>'usuario';
  v_row public.apuestas;
  v_res jsonb;
begin
  select exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) into v_ok;
  if not v_ok then raise exception 'no autorizado'; end if;

  -- usuarios (el control de quién es dueño se hace en el bot)
  if p_accion = 'usuario' then
    select to_jsonb(x) into v_res from public.usuarios x where chat_id = v_u and activo;
    return coalesce(v_res, 'null'::jsonb);
  elsif p_accion = 'usuarios' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'chat_id', x.chat_id, 'nombre', x.nombre, 'avisos', x.avisos, 'banca_inicial', x.banca_inicial + public.neto_mov(x.chat_id),
             'banca_actual', x.banca_inicial + public.neto_mov(x.chat_id) + coalesce((
                select sum(case a.resultado when 'gana' then a.monto*(a.cuota-1) when 'pierde' then -a.monto else 0 end)
                  from public.apuestas a where a.usuario = x.chat_id and a.cartera = 'bot'), 0))
             order by x.creado), '[]'::jsonb)
      into v_res from public.usuarios x where x.activo and x.chat_id not like 'w%';
    return v_res;
  elsif p_accion = 'agregar' then
    insert into public.usuarios (chat_id, nombre, banca_inicial)
    values (v_u, coalesce(p_datos->>'nombre', ''), coalesce((p_datos->>'banca')::numeric, 200))
    on conflict (chat_id) do update set activo = true, nombre = excluded.nombre
    returning to_jsonb(usuarios.*) into v_res;
    return v_res;
  elsif p_accion = 'quitar' then
    update public.usuarios set activo = false where chat_id = v_u returning to_jsonb(usuarios.*) into v_res;
    return coalesce(v_res, 'null'::jsonb);
  end if;

  if v_u is null or not exists(select 1 from public.usuarios where chat_id = v_u and activo) then
    raise exception 'usuario sin acceso';
  end if;

  if p_accion = 'registrar' then
    insert into public.apuestas (usuario, cartera, partido, seleccion, casa, cuota, prob, monto)
    values (v_u, coalesce(nullif(p_datos->>'cartera', ''), 'bot'), coalesce(p_datos->>'partido', ''),
            p_datos->>'seleccion', coalesce(p_datos->>'casa', ''), (p_datos->>'cuota')::numeric,
            nullif(p_datos->>'prob', '')::numeric, (p_datos->>'monto')::numeric)
    returning * into v_row;
    return to_jsonb(v_row);

  elsif p_accion = 'cerrar' then
    update public.apuestas
       set resultado = p_datos->>'resultado',
           cerrada = case when p_datos->>'resultado' = 'pendiente' then null else now() end
     where id = (p_datos->>'id')::bigint and usuario = v_u
    returning * into v_row;
    return to_jsonb(v_row);

  elsif p_accion = 'borrar' then
    delete from public.apuestas where id = (p_datos->>'id')::bigint and usuario = v_u returning * into v_row;
    return to_jsonb(v_row);

  elsif p_accion = 'pendientes' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.creada), '[]'::jsonb) into v_res
      from public.apuestas a where a.usuario = v_u and a.resultado = 'pendiente';
    return v_res;

  elsif p_accion = 'resumen' then
    select jsonb_build_object(
      'banca_inicial', (select banca_inicial + public.neto_mov(chat_id) from public.usuarios where chat_id = v_u),
      'bot', (select jsonb_build_object(
          'cerradas', count(*) filter (where resultado <> 'pendiente'),
          'pendientes', count(*) filter (where resultado = 'pendiente'),
          'en_juego', coalesce(sum(monto) filter (where resultado = 'pendiente'), 0),
          'ganadas', count(*) filter (where resultado = 'gana'),
          'perdidas', count(*) filter (where resultado = 'pierde'),
          'apostado', coalesce(sum(monto) filter (where resultado <> 'pendiente'), 0),
          'ganancia', coalesce(sum(case resultado when 'gana' then monto*(cuota-1) when 'pierde' then -monto else 0 end), 0),
          'esperada', coalesce(sum(case when resultado <> 'pendiente' and prob is not null then monto*(prob*cuota-1) else 0 end), 0))
        from public.apuestas where usuario = v_u and cartera = 'bot'),
      'libre', (select jsonb_build_object(
          'cerradas', count(*) filter (where resultado <> 'pendiente'),
          'pendientes', count(*) filter (where resultado = 'pendiente'),
          'en_juego', coalesce(sum(monto) filter (where resultado = 'pendiente'), 0),
          'ganadas', count(*) filter (where resultado = 'gana'),
          'perdidas', count(*) filter (where resultado = 'pierde'),
          'apostado', coalesce(sum(monto) filter (where resultado <> 'pendiente'), 0),
          'ganancia', coalesce(sum(case resultado when 'gana' then monto*(cuota-1) when 'pierde' then -monto else 0 end), 0))
        from public.apuestas where usuario = v_u and cartera = 'libre')
    ) into v_res;
    return v_res;

  elsif p_accion = 'banca' then
    update public.usuarios set banca_inicial = (p_datos->>'valor')::numeric where chat_id = v_u;
    return jsonb_build_object('banca_inicial', (p_datos->>'valor')::numeric);
  end if;

  raise exception 'acción desconocida: %', p_accion;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.comunidad(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_texto text := left(trim(coalesce(p_datos->>'texto', '')), 1000);
  v_link text := nullif(trim(coalesce(p_datos->>'link', '')), '');
  v_img text := nullif(p_datos->>'imagen', '');
  v_res jsonb;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then
    raise exception 'no autorizado';
  end if;
  if v_u is null or not exists(select 1 from public.usuarios where chat_id = v_u and activo) then
    raise exception 'usuario sin acceso';
  end if;

  update public.publicaciones set imagen = null, texto = '', link = null, activa = false
   where activa and expira < now();

  if p_accion = 'feed' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'autor', coalesce(nullif(u.nombre, ''), 'Alguien'), 'mio', p.usuario = v_u,
             'texto', p.texto, 'link', p.link, 'foto', p.imagen is not null, 'creada', p.creada, 'expira', p.expira,
             'reacciones', coalesce((select jsonb_object_agg(r.emoji, r.n) from (
                 select emoji, count(*) n from public.reacciones where publicacion_id = p.id and activa group by emoji) r), '{}'::jsonb),
             'mias', coalesce((select jsonb_agg(emoji) from public.reacciones
                 where publicacion_id = p.id and usuario = v_u and activa), '[]'::jsonb))
             order by p.creada), '[]'::jsonb)
      into v_res
      from (select * from public.publicaciones where activa order by creada desc limit 100) p
      left join public.usuarios u on u.chat_id = p.usuario;
    return v_res;

  elsif p_accion = 'reaccionar' then
    if not exists(select 1 from public.publicaciones where id = (p_datos->>'id')::bigint and activa) then
      return 'null'::jsonb;
    end if;
    insert into public.reacciones (publicacion_id, usuario, emoji)
    values ((p_datos->>'id')::bigint, v_u, p_datos->>'emoji')
    on conflict (publicacion_id, usuario, emoji) do update set activa = not public.reacciones.activa;
    return 'true'::jsonb;

  elsif p_accion = 'imagen' then
    select to_jsonb(imagen) into v_res from public.publicaciones
     where id = (p_datos->>'id')::bigint and activa and imagen is not null;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'publicar' then
    if v_texto = '' and v_img is null and v_link is null then
      return jsonb_build_object('error', 'Escribe algo, agrega una foto o un link.');
    end if;
    if v_link is not null and (v_link !~ '^https://[^\s]+$' or length(v_link) > 500) then
      return jsonb_build_object('error', 'El link debe empezar con https://');
    end if;
    if v_img is not null and (v_img !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or length(v_img) > 600000) then
      return jsonb_build_object('error', 'La foto no es válida o es muy grande.');
    end if;
    if (select count(*) from public.publicaciones where usuario = v_u and activa) >= 20 then
      return jsonb_build_object('error', 'Tienes 20 publicaciones activas. Baja alguna antes de publicar otra.');
    end if;
    insert into public.publicaciones (usuario, texto, link, imagen, expira)
    values (v_u, v_texto, v_link, v_img,
            now() + make_interval(hours => greatest(1, least(coalesce((p_datos->>'horas')::int, 48), 168))))
    returning jsonb_build_object('id', id, 'autor', (select nombre from public.usuarios where chat_id = v_u)) into v_res;
    return v_res;

  elsif p_accion = 'bajar' then
    update public.publicaciones set imagen = null, texto = '', link = null, activa = false
     where id = (p_datos->>'id')::bigint and usuario = v_u and activa
    returning jsonb_build_object('id', id) into v_res;
    return coalesce(v_res, 'null'::jsonb);
  end if;

  raise exception 'acción desconocida: %', p_accion;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.conviene(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_s record; v_res jsonb; v_ant numeric;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then raise exception 'no autorizado'; end if;

  if p_accion in ('cotizar', 'votar') then
    select prob, minima, partido, deporte, inicio into v_s from public.senales
     where evento = p_datos->>'evento' and mercado = p_datos->>'mercado' and seleccion = p_datos->>'seleccion'
     order by creada desc limit 1;
    if v_s is null then return jsonb_build_object('error', 'Esa señal ya no existe.'); end if;
    if v_s.inicio <= now() then return jsonb_build_object('error', 'Ese partido ya empezó.'); end if;
  end if;

  if p_accion = 'cotizar' then
    if (p_datos->>'cuota') is null then
      update public.cotizaciones set cuota = 0, creada = now()
       where usuario = v_u and evento = p_datos->>'evento' and mercado = p_datos->>'mercado'
         and seleccion = p_datos->>'seleccion' and casa = p_datos->>'casa';
      return 'true'::jsonb;
    end if;
    select max(cuota) into v_ant from public.cotizaciones
     where evento = p_datos->>'evento' and mercado = p_datos->>'mercado' and seleccion = p_datos->>'seleccion'
       and casa = p_datos->>'casa' and cuota > 1;
    insert into public.cotizaciones (usuario, evento, mercado, seleccion, partido, deporte, inicio, casa, cuota, prob, minima)
    values (v_u, p_datos->>'evento', p_datos->>'mercado', p_datos->>'seleccion', v_s.partido, v_s.deporte, v_s.inicio,
            p_datos->>'casa', (p_datos->>'cuota')::numeric, v_s.prob, v_s.minima)
    on conflict (usuario, evento, mercado, seleccion, casa)
    do update set cuota = excluded.cuota, prob = excluded.prob, minima = excluded.minima, creada = now();
    return jsonb_build_object('prob', v_s.prob, 'minima', v_s.minima, 'partido', v_s.partido,
      'ventaja', round(v_s.prob * (p_datos->>'cuota')::numeric - 1, 4),
      'nombre', (select nombre from public.usuarios where chat_id = v_u),
      'nuevo_mejor', v_ant is null or (p_datos->>'cuota')::numeric > v_ant);

  elsif p_accion = 'votar' then
    insert into public.votos (usuario, evento, mercado, seleccion, voto, partido, inicio)
    values (v_u, p_datos->>'evento', p_datos->>'mercado', p_datos->>'seleccion', nullif(p_datos->>'voto', ''), v_s.partido, v_s.inicio)
    on conflict (usuario, evento, mercado, seleccion) do update set voto = excluded.voto, creada = now();
    return 'true'::jsonb;

  elsif p_accion = 'estado' then
    -- momios y votos de los partidos que no han empezado
    select jsonb_build_object(
      'cotizaciones', coalesce((select jsonb_agg(jsonb_build_object('evento', c.evento, 'mercado', c.mercado, 'seleccion', c.seleccion,
          'casa', c.casa, 'cuota', c.cuota, 'creada', c.creada, 'mio', c.usuario = v_u, 'nombre', u.nombre))
        from public.cotizaciones c join public.usuarios u on u.chat_id = c.usuario
        where c.inicio > now() and c.cuota > 1), '[]'::jsonb),
      'votos', coalesce((select jsonb_agg(jsonb_build_object('evento', v.evento, 'mercado', v.mercado, 'seleccion', v.seleccion,
          'voto', v.voto, 'mio', v.usuario = v_u, 'nombre', u.nombre))
        from public.votos v join public.usuarios u on u.chat_id = v.usuario
        where v.inicio > now() and v.voto is not null), '[]'::jsonb))
    into v_res;
    return v_res;

  elsif p_accion = 'analisis' then
    with c as (
      select casa, deporte, mercado, evento, seleccion, cuota, prob, minima, prob * cuota - 1 as ventaja
        from public.cotizaciones where cuota > 1 and prob is not null
         and creada > now() - make_interval(days => coalesce((p_datos->>'dias')::int, 90))),
    -- margen de la casa: cuando hay momios de todas las opciones de un mercado (las probabilidades del bot suman 1)
    m as (
      select casa, evento, mercado, sum(1 / mejor) - 1 as margen, sum(p) as cubierto from (
        select casa, evento, mercado, seleccion, max(cuota) mejor, max(prob) p from c group by 1, 2, 3, 4) x
      group by 1, 2, 3 having sum(p) > 0.97)
    select jsonb_build_object(
      'casas', coalesce((select jsonb_agg(jsonb_build_object('casa', casa, 'n', n, 'con_valor', con_valor, 'ventaja', ventaja, 'mejor', mejor,
          'margen', (select round(avg(margen), 4) from m where m.casa = z.casa), 'mercados', (select count(*) from m where m.casa = z.casa))
          order by n desc) from (
        select casa, count(*) n, count(*) filter (where cuota >= minima) con_valor, round(avg(ventaja), 4) ventaja, round(max(ventaja), 4) mejor
          from c group by casa) z), '[]'::jsonb),
      'deportes', coalesce((select jsonb_agg(jsonb_build_object('deporte', deporte, 'n', n, 'con_valor', con_valor, 'ventaja', ventaja)) from (
        select deporte, count(*) n, count(*) filter (where cuota >= minima) con_valor, round(avg(ventaja), 4) ventaja from c group by deporte) d), '[]'::jsonb),
      'mercados', coalesce((select jsonb_agg(jsonb_build_object('mercado', mercado, 'n', n, 'con_valor', con_valor, 'ventaja', ventaja)) from (
        select mercado, count(*) n, count(*) filter (where cuota >= minima) con_valor, round(avg(ventaja), 4) ventaja from c group by mercado) d), '[]'::jsonb),
      'top', coalesce((select jsonb_agg(t) from (
        select jsonb_build_object('partido', x.partido, 'seleccion', x.seleccion, 'casa', x.casa, 'cuota', x.cuota, 'ventaja', round(x.prob * x.cuota - 1, 4),
               'inicio', x.inicio, 'nombre', u.nombre) t
          from public.cotizaciones x join public.usuarios u on u.chat_id = x.usuario
         where x.cuota > 1 and x.prob is not null and x.creada > now() - interval '90 days'
         order by x.prob * x.cuota desc limit 8) y), '[]'::jsonb),
      'votos', (select jsonb_build_object('si', count(*) filter (where voto = 'si'), 'no', count(*) filter (where voto = 'no'))
                  from public.votos where creada > now() - interval '90 days'))
    into v_res;
    return v_res;
  end if;
  raise exception 'acción desconocida: %', p_accion;
end $function$
;

CREATE OR REPLACE FUNCTION public.extras(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_ini timestamptz := (date_trunc('week', now() at time zone 'America/Mexico_City')) at time zone 'America/Mexico_City';
  v_res jsonb;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then
    raise exception 'no autorizado';
  end if;

  if p_accion = 'limite' then
    -- valor null = quitar el límite
    update public.usuarios set limite_semanal = nullif(p_datos->>'valor', '')::numeric
     where chat_id = v_u and activo
    returning jsonb_build_object('limite', limite_semanal) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'estado_limite' then
    -- Apuestas normales (libres) desde el lunes: lo perdido en neto y lo que está en juego
    select jsonb_build_object(
      'limite', (select limite_semanal from public.usuarios where chat_id = v_u),
      'neto', coalesce(sum(case resultado when 'gana' then monto*(cuota-1) when 'pierde' then -monto else 0 end)
                       filter (where resultado <> 'pendiente' and cerrada >= v_ini), 0),
      'en_juego', coalesce(sum(monto) filter (where resultado = 'pendiente'), 0))
      into v_res
      from public.apuestas where usuario = v_u and cartera = 'libre';
    return v_res;

  elsif p_accion = 'semana' then
    -- Resumen de los últimos 7 días para cada usuario activo (y la semana anterior para comparar)
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_res from (
      select u.chat_id, u.nombre, u.banca_inicial + public.neto_mov(u.chat_id) as banca_inicial,
        (select jsonb_build_object(
           'cerradas', count(*), 'ganadas', count(*) filter (where resultado = 'gana'),
           'perdidas', count(*) filter (where resultado = 'pierde'),
           'apostado', coalesce(sum(monto), 0),
           'neto_bot', coalesce(sum(g) filter (where cartera = 'bot'), 0),
           'neto_libre', coalesce(sum(g) filter (where cartera = 'libre'), 0),
           'mejor', (select jsonb_build_object('seleccion', seleccion, 'ganancia', g2) from (
                      select seleccion, case resultado when 'gana' then monto*(cuota-1) when 'pierde' then -monto else 0 end g2
                        from public.apuestas where usuario = u.chat_id and resultado = 'gana' and cerrada > now() - interval '7 days'
                       order by 2 desc limit 1) m),
           'peor', (select jsonb_build_object('seleccion', seleccion, 'ganancia', -monto) from public.apuestas
                     where usuario = u.chat_id and resultado = 'pierde' and cerrada > now() - interval '7 days'
                     order by monto desc limit 1))
           from (select *, case resultado when 'gana' then monto*(cuota-1) when 'pierde' then -monto else 0 end g
                   from public.apuestas where usuario = u.chat_id and resultado <> 'pendiente'
                    and cerrada > now() - interval '7 days') s) as semana,
        (select coalesce(sum(case resultado when 'gana' then monto*(cuota-1) when 'pierde' then -monto else 0 end), 0)
           from public.apuestas where usuario = u.chat_id and resultado <> 'pendiente'
            and cerrada > now() - interval '14 days' and cerrada <= now() - interval '7 days') as neto_anterior,
        (select count(*) from public.apuestas where usuario = u.chat_id and resultado = 'pendiente') as pendientes,
        (select coalesce(sum(case resultado when 'gana' then monto*(cuota-1) when 'pierde' then -monto else 0 end), 0)
           from public.apuestas where usuario = u.chat_id and cartera = 'bot' and resultado <> 'pendiente') as ganancia_bot_total
      from public.usuarios u where u.activo) x;
    return v_res;
  end if;

  raise exception 'acción desconocida: %', p_accion;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guru(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_res jsonb; v_n int := 0; x jsonb;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then raise exception 'no autorizado'; end if;

  if p_accion = 'guardar' then
    for x in select * from jsonb_array_elements(coalesce(p_datos->'filas', '[]'::jsonb)) loop
      insert into public.pronosticos (evento, ruta, liga, deporte, inicio, local, visita, logo_local, logo_visita, modelo,
                                      p_local, p_empate, p_visita, datos, mercado)
      values (x->>'evento', x->>'ruta', x->>'liga', x->>'deporte', (x->>'inicio')::timestamptz, x->>'local', x->>'visita',
              x->>'logo_local', x->>'logo_visita', x->>'modelo', (x->>'p_local')::numeric, (x->>'p_empate')::numeric,
              (x->>'p_visita')::numeric, coalesce(x->'datos', '{}'::jsonb), x->'mercado')
      on conflict (evento) do update set
        inicio = excluded.inicio, p_local = excluded.p_local, p_empate = excluded.p_empate, p_visita = excluded.p_visita,
        datos = excluded.datos, mercado = coalesce(excluded.mercado, public.pronosticos.mercado), modelo = excluded.modelo,
        logo_local = excluded.logo_local, logo_visita = excluded.logo_visita, actualizada = now()
      where public.pronosticos.inicio > now();          -- ya no se cambia un pronóstico cuando el partido empezó
      v_n := v_n + 1;
    end loop;
    return to_jsonb(v_n);

  elsif p_accion = 'archivo' then
    insert into public.archivo (evento, ruta, liga, deporte, fecha, local, visita, local_completo, visita_completo, logo_local, logo_visita,
                                goles_local, goles_visita, res, busca)
    select a->>'evento', a->>'ruta', a->>'liga', a->>'deporte', (a->>'fecha')::timestamptz, a->>'local', a->>'visita',
           a->>'local_completo', a->>'visita_completo', a->>'logo_local', a->>'logo_visita',
           (a->>'goles_local')::numeric, (a->>'goles_visita')::numeric, a->>'res', a->>'busca'
      from jsonb_array_elements(coalesce(p_datos->'filas', '[]'::jsonb)) a
    on conflict (evento) do update set goles_local = excluded.goles_local, goles_visita = excluded.goles_visita, res = excluded.res,
      fecha = excluded.fecha, logo_local = excluded.logo_local, logo_visita = excluded.logo_visita, busca = excluded.busca;
    get diagnostics v_n = row_count;
    return to_jsonb(v_n);

  elsif p_accion = 'esquema' then
    return to_jsonb(privado.esquema_sql());

  elsif p_accion = 'archivo_n' then
    select jsonb_build_object('n', count(*), 'desde', min(fecha), 'hasta', max(fecha)) into v_res from public.archivo;
    return v_res;

  elsif p_accion = 'calibrar_datos' then
    select coalesce(jsonb_agg(jsonb_build_object('modelo', modelo, 'p_local', p_local, 'p_empate', p_empate, 'p_visita', p_visita,
             'datos', datos, 'res', res, 'marcador', marcador, 'local', local, 'visita', visita, 'deporte', deporte)), '[]'::jsonb) into v_res
      from public.pronosticos where res in ('L','E','V') and inicio > now() - interval '365 days';
    return v_res;

  elsif p_accion = 'config_get' then
    select to_jsonb(valor) into v_res from public.config where clave = p_datos->>'clave';
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'config_set' then
    insert into public.config (clave, valor) values (p_datos->>'clave', p_datos->>'valor')
      on conflict (clave) do update set valor = excluded.valor;
    return 'true'::jsonb;

  elsif p_accion = 'buscar' then
    with a as (
      select ar.*,
             dc.p_local dl, dc.p_empate de, dc.p_visita dv, dc.datos dd, dc.mercado dm,
             xg.p_local xl, xg.p_empate xe, xg.p_visita xv, xg.datos xd, xg.mercado xm
        from public.archivo ar
        left join public.pronosticos dc on dc.evento = ar.evento
        left join public.pronosticos xg on xg.evento = 'xg|' || ar.evento
       where (coalesce(p_datos->>'q', '') = '' or ar.busca like '%' || lower(p_datos->>'q') || '%')
         and (coalesce(p_datos->>'ruta', '') = '' or ar.ruta = p_datos->>'ruta')
         and (coalesce(p_datos->>'deporte', '') = '' or ar.deporte = p_datos->>'deporte')
         and ar.fecha >= coalesce(nullif(p_datos->>'desde', '')::timestamptz, '-infinity')
         and ar.fecha <= coalesce(nullif(p_datos->>'hasta', '')::timestamptz, 'infinity')
         and ar.res is not null),
    b as (
      select a.*, coalesce(a.dm, a.xm) pm,
        case when a.dl is null then null else
          (case a.res when 'L' then a.dl when 'E' then coalesce(a.de,0) else a.dv end) = greatest(a.dl, coalesce(a.de,0), a.dv) end ok_g,
        case when a.xl is null then null else
          (case a.res when 'L' then a.xl when 'E' then coalesce(a.xe,0) else a.xv end) = greatest(a.xl, coalesce(a.xe,0), a.xv) end ok_x,
        case when coalesce(a.dm, a.xm) ? 'L' then
          (case a.res when 'L' then (coalesce(a.dm,a.xm)->>'L')::numeric when 'E' then coalesce((coalesce(a.dm,a.xm)->>'E')::numeric,0) else (coalesce(a.dm,a.xm)->>'V')::numeric end)
            = greatest((coalesce(a.dm,a.xm)->>'L')::numeric, coalesce((coalesce(a.dm,a.xm)->>'E')::numeric,0), (coalesce(a.dm,a.xm)->>'V')::numeric) end ok_p
        from a),
    c as (
      select * from b where case coalesce(p_datos->>'filtro', 'todos')
        when 'con' then dl is not null or xl is not null
        when 'guru' then ok_g or ok_x
        when 'pinn' then ok_p
        when 'ninguno' then coalesce(ok_g, false) = false and coalesce(ok_x, false) = false and coalesce(ok_p, false) = false and (dl is not null or xl is not null or pm is not null)
        when 'todos_mal' then ok_g = false and ok_p = false
        else true end)
    select jsonb_build_object(
      'total', (select count(*) from c),
      'resumen', (select jsonb_build_object('con_guru', count(*) filter (where ok_g is not null), 'guru', count(*) filter (where ok_g),
                    'con_xg', count(*) filter (where ok_x is not null), 'xg', count(*) filter (where ok_x),
                    'con_pinn', count(*) filter (where ok_p is not null), 'pinn', count(*) filter (where ok_p)) from c),
      'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.fecha desc) from (
          select evento, ruta, liga, deporte, fecha, local, visita, logo_local, logo_visita, goles_local, goles_visita, res,
                 dl, de, dv, dd, xl, xe, xv, xd, pm, ok_g, ok_x, ok_p
            from c order by fecha desc
           limit least(coalesce((p_datos->>'n')::int, 60), 2000) offset coalesce((p_datos->>'desde_n')::int, 0)) f), '[]'::jsonb))
      into v_res;
    return v_res;

  elsif p_accion = 'pendientes' then
    select coalesce(jsonb_agg(jsonb_build_object('evento', evento, 'ruta', ruta)), '[]'::jsonb) into v_res
      from public.pronosticos where res is null and inicio < now() - interval '2 hours' and inicio > now() - interval '7 days';
    return v_res;

  elsif p_accion = 'resultado' then
    update public.pronosticos set res = p_datos->>'res', marcador = p_datos->>'marcador'
     where evento = p_datos->>'evento' and res is null;
    return 'true'::jsonb;

  elsif p_accion = 'lista' then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.inicio), '[]'::jsonb) into v_res from public.pronosticos p
     where p.inicio > now() - interval '30 hours' and p.inicio < now() + interval '8 days';
    return v_res;

  elsif p_accion = 'excel' then
    -- para el Excel diario del dueño: todo lo calificado (90 días) y lo que viene
    select coalesce(jsonb_agg(to_jsonb(fx) order by fx.inicio), '[]'::jsonb) into v_res from (
      select evento, liga, deporte, modelo, inicio, local, visita, p_local, p_empate, p_visita, datos, mercado, res, marcador, creada
        from public.pronosticos
       where (res is not null and inicio > now() - interval '90 days') or (res is null and inicio > now() - interval '6 hours')) fx;
    return v_res;

  elsif p_accion = 'historial' then
    -- los últimos 200 partidos ya jugados con lo que dijo cada uno
    select coalesce(jsonb_agg(to_jsonb(h) order by h.inicio desc), '[]'::jsonb) into v_res from (
      select evento, liga, deporte, inicio, local, visita, logo_local, logo_visita, p_local, p_empate, p_visita, mercado, res, marcador, datos
        from public.pronosticos where res in ('L', 'E', 'V') and (modelo = 'xG') = (coalesce(p_datos->>'modelo', '') = 'xG')
       order by inicio desc limit coalesce((p_datos->>'n')::int, 200)) h;
    return v_res;

  elsif p_accion = 'duelo' then
    -- Gurú vs Pinnacle en los últimos N partidos (200 por defecto) donde hay probabilidad de los dos
    with u as (
      select deporte,
             case res when 'L' then p_local when 'E' then coalesce(p_empate, 0) else p_visita end as pg,
             case res when 'L' then (mercado->>'L')::numeric when 'E' then coalesce((mercado->>'E')::numeric, 0) else (mercado->>'V')::numeric end as pm,
             greatest(p_local, coalesce(p_empate, 0), p_visita) = case res when 'L' then p_local when 'E' then coalesce(p_empate, 0) else p_visita end as ag,
             greatest((mercado->>'L')::numeric, coalesce((mercado->>'E')::numeric, 0), (mercado->>'V')::numeric)
               = case res when 'L' then (mercado->>'L')::numeric when 'E' then coalesce((mercado->>'E')::numeric, 0) else (mercado->>'V')::numeric end as am
        from public.pronosticos where res in ('L', 'E', 'V') and (modelo = 'xG') = (coalesce(p_datos->>'modelo', '') = 'xG') and mercado ? 'L'
       order by inicio desc limit coalesce((p_datos->>'n')::int, 200))
    select jsonb_build_object(
      'n', count(*), 'aciertos_guru', count(*) filter (where ag), 'aciertos_pinnacle', count(*) filter (where am),
      'guru_mas_cerca', count(*) filter (where pg > pm + 0.005), 'pinnacle_mas_cerca', count(*) filter (where pm > pg + 0.005),
      'empates', count(*) filter (where abs(pg - pm) <= 0.005),
      'logloss_guru', round(avg(-ln(greatest(pg, 0.001))), 4), 'logloss_pinnacle', round(avg(-ln(greatest(pm, 0.001))), 4))
      into v_res from u;
    return v_res;

  elsif p_accion = 'precision' then
    -- aciertos y Brier (0 = perfecto) del gurú contra el mercado (Pinnacle), últimos 60 días
    with b as (
      select deporte,
             case res when 'L' then p_local when 'E' then coalesce(p_empate, 0) else p_visita end as p_res,
             greatest(p_local, coalesce(p_empate, 0), p_visita) = case res when 'L' then p_local when 'E' then coalesce(p_empate, 0) else p_visita end as acierto,
             power(p_local - (res = 'L')::int, 2) + power(coalesce(p_empate, 0) - (res = 'E')::int, 2) + power(p_visita - (res = 'V')::int, 2) as brier,
             case when mercado is not null then
               power(coalesce((mercado->>'L')::numeric, 0) - (res = 'L')::int, 2) + power(coalesce((mercado->>'E')::numeric, 0) - (res = 'E')::int, 2)
               + power(coalesce((mercado->>'V')::numeric, 0) - (res = 'V')::int, 2) end as brier_m,
             case when mercado is not null then
               power(p_local - (res = 'L')::int, 2) + power(coalesce(p_empate, 0) - (res = 'E')::int, 2) + power(p_visita - (res = 'V')::int, 2) end as brier_mm
        from (select * from public.pronosticos where res in ('L', 'E', 'V') and (modelo = 'xG') = (coalesce(p_datos->>'modelo', '') = 'xG') order by inicio desc limit 200) ult)
    select coalesce(jsonb_agg(jsonb_build_object('deporte', deporte, 'n', n, 'aciertos', aciertos, 'brier', brier,
             'con_mercado', con_mercado, 'brier_guru', brier_mm, 'brier_mercado', brier_m)), '[]'::jsonb) into v_res
      from (select deporte, count(*) n, count(*) filter (where acierto) aciertos, round(avg(brier), 4) brier,
                   count(brier_m) con_mercado, round(avg(brier_mm), 4) brier_mm, round(avg(brier_m), 4) brier_m
              from b group by deporte) z;
    return v_res;
  end if;
  raise exception 'acción desconocida: %', p_accion;
end $function$
;

CREATE OR REPLACE FUNCTION public.jugar(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_cat jsonb := '{
    "tacos":   {"n":"Tacos","e":"🌮","p":5,"tipo":"comida"},
    "pizza":   {"n":"Pizza","e":"🍕","p":12,"tipo":"comida"},
    "asada":   {"n":"Carne asada","e":"🥩","p":30,"tipo":"comida"},
    "gorra":   {"n":"Gorra","e":"🧢","p":50,"tipo":"cabeza"},
    "bufanda": {"n":"Bufanda","e":"🧣","p":60,"tipo":"cuello"},
    "lentes":  {"n":"Lentes","e":"🕶️","p":80,"tipo":"ojos"},
    "jersey":  {"n":"Jersey de tu equipo","e":"👕","p":150,"tipo":"cuerpo"},
    "tenis":   {"n":"Tenis","e":"👟","p":200,"tipo":"pies"},
    "audif":   {"n":"Audífonos","e":"🎧","p":400,"tipo":"cabeza"},
    "balon":   {"n":"Balón firmado","e":"⚽","p":800,"tipo":"mano"},
    "reloj":   {"n":"Reloj de oro","e":"⌚","p":1500,"tipo":"mano"},
    "corona":  {"n":"Corona","e":"👑","p":10000,"tipo":"cabeza"},
    "copa":    {"n":"Copa del Mundo","e":"🏆","p":50000,"tipo":"mano"},
    "deportivo":{"n":"Auto deportivo","e":"🏎️","p":120000,"tipo":"fondo"},
    "yate":    {"n":"Yate","e":"🛥️","p":250000,"tipo":"fondo"},
    "jet":     {"n":"Jet privado","e":"✈️","p":2000000,"tipo":"fondo"},
    "estadio": {"n":"Estadio propio","e":"🏟️","p":1000000,"tipo":"fondo"},
    "cohete":  {"n":"Cohete","e":"🚀","p":5000000,"tipo":"fondo"},
    "isla":    {"n":"Isla privada","e":"🏝️","p":10000000,"tipo":"fondo"}
  }'::jsonb;
  v_premio jsonb := '{"logos":1,"penales":2,"canasta":2,"gol_campo":3,"tiro_libre":2,"equipodoku":2}'::jsonb;
  v_res jsonb; v_saldo numeric; v_item jsonb; v_hoy numeric; v_monto numeric;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then raise exception 'no autorizado'; end if;
  insert into public.mascota (usuario) values (v_u) on conflict do nothing;
  -- cartera virtual: lo que has ganado en apuestas ganadas (bot y normales) + premios de juegos - compras
  select coalesce((select sum(monto * (cuota - 1)) from public.apuestas where usuario = v_u and resultado = 'gana'), 0)
       + coalesce((select sum(monto) from public.monedas where usuario = v_u), 0) into v_saldo;

  if p_accion = 'estado' then
    select jsonb_build_object('saldo', round(v_saldo, 2), 'catalogo', v_cat,
      'mascota', to_jsonb(m) - 'usuario', 'horas_sin_comer', round(extract(epoch from now() - m.comida) / 3600, 1),
      'ganado_apuestas', coalesce((select round(sum(monto * (cuota - 1)), 2) from public.apuestas where usuario = v_u and resultado = 'gana'), 0),
      'premios_hoy', coalesce((select sum(monto) from public.monedas where usuario = v_u and concepto like 'juego:%' and creada > date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City'), 0))
      into v_res from public.mascota m where m.usuario = v_u;
    return v_res;

  elsif p_accion = 'comprar' then
    v_item := v_cat->(p_datos->>'item');
    if v_item is null then return jsonb_build_object('error', 'Ese artículo no existe.'); end if;
    if v_saldo < (v_item->>'p')::numeric then return jsonb_build_object('error', 'No te alcanza. ¡A ganar apuestas (o minijuegos)!'); end if;
    if v_item->>'tipo' <> 'comida' and exists(select 1 from public.mascota where usuario = v_u and items ? (p_datos->>'item')) then
      return jsonb_build_object('error', 'Ya lo tienes.');
    end if;
    insert into public.monedas (usuario, concepto, monto) values (v_u, 'compra:' || (p_datos->>'item'), -(v_item->>'p')::numeric);
    if v_item->>'tipo' = 'comida' then
      update public.mascota set comida = now() where usuario = v_u;
    else
      update public.mascota set items = items || to_jsonb(p_datos->>'item'),
        puestos = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(puestos) x
                    where v_cat->x->>'tipo' <> v_item->>'tipo') || to_jsonb(p_datos->>'item')
       where usuario = v_u;
    end if;
    return jsonb_build_object('ok', true, 'saldo', round(v_saldo - (v_item->>'p')::numeric, 2));

  elsif p_accion = 'poner' then
    -- pone o quita un accesorio que ya tienes (uno por tipo)
    v_item := v_cat->(p_datos->>'item');
    if v_item is null or not exists(select 1 from public.mascota where usuario = v_u and items ? (p_datos->>'item')) then
      return jsonb_build_object('error', 'No lo tienes.');
    end if;
    update public.mascota set puestos = case when puestos ? (p_datos->>'item')
        then (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(puestos) x where x <> p_datos->>'item')
        else (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(puestos) x where v_cat->x->>'tipo' <> v_item->>'tipo') || to_jsonb(p_datos->>'item') end
     where usuario = v_u;
    return 'true'::jsonb;

  elsif p_accion = 'especie' then
    if p_datos->>'especie' not in ('gato', 'perro', 'lagarto', 'tigre', 'pinguino', 'jirafa') then
      return jsonb_build_object('error', 'Ese animal no está.');
    end if;
    -- la primera vez es gratis; después cuesta $1,000,000 virtuales y se pierden los objetos comprados
    if exists(select 1 from public.mascota where usuario = v_u and especie_elegida) then
      if exists(select 1 from public.mascota where usuario = v_u and especie = p_datos->>'especie') then return 'true'::jsonb; end if;
      if v_saldo < 1000000 then return jsonb_build_object('error', 'Cambiar de mascota cuesta $1,000,000 virtuales y no te alcanza.'); end if;
      insert into public.monedas (usuario, concepto, monto) values (v_u, 'cambio_mascota:' || (p_datos->>'especie'), -1000000);
      update public.mascota set especie = p_datos->>'especie', items = '[]'::jsonb, puestos = '[]'::jsonb where usuario = v_u;
      return jsonb_build_object('ok', true, 'costo', 1000000);
    end if;
    update public.mascota set especie = p_datos->>'especie', especie_elegida = true where usuario = v_u;
    return jsonb_build_object('ok', true, 'costo', 0);

  elsif p_accion = 'nombre' then
    update public.mascota set nombre = left(coalesce(nullif(trim(p_datos->>'nombre'), ''), 'Momio'), 20) where usuario = v_u;
    return 'true'::jsonb;

  elsif p_accion = 'premio' then
    if not (v_premio ? (p_datos->>'juego')) then return jsonb_build_object('error', 'juego'); end if;
    select coalesce(sum(monto), 0) into v_hoy from public.monedas where usuario = v_u and concepto like 'juego:%'
       and creada > date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City';
    v_monto := least(greatest(least((p_datos->>'puntos')::int, 20), 0) * (v_premio->>(p_datos->>'juego'))::numeric, greatest(60 - v_hoy, 0));
    insert into public.monedas (usuario, concepto, monto, puntos) values (v_u, 'juego:' || (p_datos->>'juego'), v_monto, least((p_datos->>'puntos')::int, 20));
    return jsonb_build_object('ganaste', v_monto, 'tope', v_hoy + v_monto >= 60, 'saldo', round(v_saldo + v_monto, 2));

  elsif p_accion = 'logros' then
    -- revisa qué logros ya cumpliste, guarda los nuevos y te da su premio
    with cumple as (
      select l.k, l.premio, l.ok from (values
        ('primera_ganada', 20, (select count(*) from public.apuestas where usuario = v_u and resultado = 'gana') >= 1),
        ('cinco_ganadas', 50, (select count(*) from public.apuestas where usuario = v_u and resultado = 'gana') >= 5),
        ('veinte_ganadas', 150, (select count(*) from public.apuestas where usuario = v_u and resultado = 'gana') >= 20),
        ('clv_10', 100, (select count(*) from public.apuestas where usuario = v_u and clv > 0) >= 10),
        ('quiniela_5', 50, (select count(*) from public.quiniela_picks q join public.quiniela_res r on r.evento = q.evento and r.res = q.pick where q.usuario = v_u and q.liga <> 'lol/worlds') >= 5),
        ('lol_5', 50, (select count(*) from public.quiniela_picks q join public.quiniela_res r on r.evento = q.evento and r.res = q.pick where q.usuario = v_u and q.liga = 'lol/worlds') >= 5),
        ('reto_ganado', 25, exists(select 1 from public.retos where ganador = v_u)),
        ('parlay_practica', 25, exists(select 1 from public.practica where usuario = v_u and tipo = 'parlay' and estado = 'gana')),
        ('penales_perfecto', 30, exists(select 1 from public.monedas where usuario = v_u and concepto = 'juego:penales' and puntos >= 5)),
        ('canasta_perfecta', 30, exists(select 1 from public.monedas where usuario = v_u and concepto = 'juego:canasta' and puntos >= 5)),
        ('gol_campo_perfecto', 40, exists(select 1 from public.monedas where usuario = v_u and concepto = 'juego:gol_campo' and puntos >= 5)),
        ('logos_10', 30, exists(select 1 from public.monedas where usuario = v_u and concepto = 'juego:logos' and puntos >= 10)),
        ('primera_compra', 10, exists(select 1 from public.monedas where usuario = v_u and concepto like 'compra:%')),
        ('millonario', 0, exists(select 1 from public.monedas where usuario = v_u and concepto like 'cambio_mascota:%')
                              or exists(select 1 from public.mascota where usuario = v_u and items ?| array['estadio', 'jet', 'cohete', 'isla'])),
        ('conviene_10', 40, (select count(*) from public.cotizaciones where usuario = v_u) >= 10)
      ) l(k, premio, ok)),
    nuevos as (
      insert into public.logros (usuario, logro) select v_u, k from cumple where ok on conflict do nothing returning logro)
    select jsonb_build_object(
      'nuevos', coalesce((select jsonb_agg(jsonb_build_object('k', n.logro, 'premio', c.premio)) from nuevos n join cumple c on c.k = n.logro), '[]'::jsonb),
      'tengo', coalesce((select jsonb_object_agg(logro, creada) from public.logros where usuario = v_u), '{}'::jsonb)
                 || coalesce((select jsonb_object_agg(logro, now()) from nuevos), '{}'::jsonb),
      'premios', (select jsonb_object_agg(k, premio) from cumple))
      into v_res;
    -- premio en monedas por cada logro nuevo
    insert into public.monedas (usuario, concepto, monto)
    select v_u, 'logro:' || (x->>'k'), (x->>'premio')::numeric from jsonb_array_elements(v_res->'nuevos') x where (x->>'premio')::numeric > 0;
    return v_res;

  elsif p_accion = 'general' then
    -- tabla general entre amigos (sin dinero real): quinielas, retos, logros, minijuegos y mascota
    select coalesce(jsonb_agg(t order by (t->>'puntos')::numeric desc), '[]'::jsonb) into v_res from (
      select jsonb_build_object('nombre', u.nombre, 'yo', u.chat_id = v_u,
        'quiniela', (select count(*) from public.quiniela_picks q join public.quiniela_res r on r.evento = q.evento and r.res = q.pick where q.usuario = u.chat_id),
        'retos', (select count(*) from public.retos where ganador = u.chat_id),
        'logros', (select count(*) from public.logros where usuario = u.chat_id),
        'juegos', coalesce((select sum(m) from (select max(puntos) m from public.monedas where usuario = u.chat_id and concepto like 'juego:%'
                     and creada > now() - interval '7 days' group by concepto) z), 0),
        'mascota', coalesce((select sum((v_cat->x->>'p')::numeric) from public.mascota ma, jsonb_array_elements_text(ma.items) x where ma.usuario = u.chat_id), 0),
        'puntos', 3 * (select count(*) from public.quiniela_picks q join public.quiniela_res r on r.evento = q.evento and r.res = q.pick where q.usuario = u.chat_id)
                  + 5 * (select count(*) from public.retos where ganador = u.chat_id)
                  + 10 * (select count(*) from public.logros where usuario = u.chat_id)
                  + coalesce((select sum(m) from (select max(puntos) m from public.monedas where usuario = u.chat_id and concepto like 'juego:%'
                     and creada > now() - interval '7 days' group by concepto) z), 0)) t
        from public.usuarios u where u.activo) s;
    return v_res;

  elsif p_accion = 'hambrientos' then
    -- mascotas con más de 30 h sin comer (para el aviso por Telegram)
    select coalesce(jsonb_agg(jsonb_build_object('chat_id', m.usuario, 'nombre', m.nombre, 'especie', m.especie,
             'horas', round(extract(epoch from now() - m.comida) / 3600))), '[]'::jsonb)
      into v_res from public.mascota m join public.usuarios u on u.chat_id = m.usuario and u.activo
     where m.especie_elegida and m.comida < now() - interval '30 hours';
    return v_res;

  elsif p_accion = 'ranking' then
    select jsonb_build_object(
      'juegos', coalesce((select jsonb_agg(jsonb_build_object('juego', juego, 'nombre', nombre, 'mejor', mejor, 'yo', yo) order by juego, mejor desc) from (
          select split_part(m.concepto, ':', 2) juego, u.nombre, max(m.puntos) mejor, bool_or(m.usuario = v_u) yo
            from public.monedas m join public.usuarios u on u.chat_id = m.usuario and u.activo
           where m.concepto like 'juego:%' and m.creada > now() - interval '7 days' group by 1, 2) z), '[]'::jsonb),
      'mascotas', coalesce((select jsonb_agg(jsonb_build_object('nombre', u.nombre, 'mascota', ma.nombre, 'items', jsonb_array_length(ma.items),
          'valor', coalesce((select sum((v_cat->x->>'p')::numeric) from jsonb_array_elements_text(ma.items) x), 0), 'yo', u.chat_id = v_u)
          order by coalesce((select sum((v_cat->x->>'p')::numeric) from jsonb_array_elements_text(ma.items) x), 0) desc)
        from public.mascota ma join public.usuarios u on u.chat_id = ma.usuario and u.activo), '[]'::jsonb))
    into v_res;
    return v_res;
  end if;
  raise exception 'acción desconocida: %', p_accion;
end $function$
;

CREATE OR REPLACE FUNCTION public.mas(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_res jsonb;
  v_id bigint;
  v_cuota numeric := 1;
  v_n int;
  v_disp numeric;
  v_p public.practica;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then
    raise exception 'no autorizado';
  end if;

  -- ===================== perfil (equipo favorito, banca de práctica)
  if p_accion = 'lineas2' then return public.mas_lineas();
  elsif p_accion = 'clv_pendientes' then
    -- apuestas del bot sin CLV y las líneas de cierre (último escaneo antes del partido) de los últimos 10 días
    select jsonb_build_object(
      'apuestas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'partido', partido, 'seleccion', seleccion, 'cuota', cuota,
          'creada', creada)) from public.apuestas where cartera = 'bot' and not clv_revisado and creada > now() - interval '10 days'), '[]'::jsonb),
      'cierres', coalesce((select jsonb_agg(c) from (
          select jsonb_build_object('evento', evento, 'mercado', mercado, 'seleccion', seleccion, 'partido', max(partido),
                 'inicio', min(inicio), 'prob', (array_agg(prob order by creada desc))[1]) c
            from public.senales where inicio > now() - interval '10 days' and creada < inicio and prob is not null
           group by evento, mercado, seleccion) z), '[]'::jsonb))
    into v_res;
    return v_res;
  elsif p_accion = 'clv_set' then
    update public.apuestas set prob_cierre = (p_datos->>'prob')::numeric,
           clv = case when p_datos->>'prob' is null then null else round(cuota * (p_datos->>'prob')::numeric - 1, 4) end,
           clv_revisado = true
     where id = (p_datos->>'id')::bigint;
    return 'true'::jsonb;
  elsif p_accion = 'mov_crear' then
    insert into public.movimientos (usuario, tipo, monto, nota, cartera)
    values (v_u, p_datos->>'tipo', (p_datos->>'monto')::numeric, left(coalesce(p_datos->>'nota', ''), 80),
            case when p_datos->>'cartera' = 'libre' then 'libre' else 'bot' end)
    returning jsonb_build_object('id', id, 'neto', public.neto_mov(v_u)) into v_res;
    return v_res;
  elsif p_accion = 'mov_anular' then
    update public.movimientos set anulado = true where id = (p_datos->>'id')::bigint and usuario = v_u and not anulado;
    return jsonb_build_object('neto', public.neto_mov(v_u));
  elsif p_accion = 'movimientos' then
    select jsonb_build_object('neto', public.neto_mov(v_u), 'libre', public.neto_libre(v_u), 'lista', coalesce((select jsonb_agg(to_jsonb(m) order by m.creada desc)
      from public.movimientos m where m.usuario = v_u and not m.anulado), '[]'::jsonb)) into v_res;
    return v_res;
  elsif p_accion = 'perfil' then
    select jsonb_build_object('chat_id', u.chat_id, 'nombre', u.nombre, 'tema', u.tema, 'equipo_fav', u.equipo_fav,
      'practica_banca', u.practica_banca + coalesce((select sum(ganancia) from public.practica p
                         where p.usuario = u.chat_id and p.estado <> 'pendiente' and not p.oculta and p.torneo is null), 0),
      'practica_en_juego', coalesce((select sum(monto) from public.practica p where p.usuario = u.chat_id and p.estado = 'pendiente' and p.torneo is null), 0),
      'amigos', (select coalesce(jsonb_agg(jsonb_build_object('chat_id', x.chat_id, 'nombre', x.nombre) order by x.nombre), '[]'::jsonb)
                   from public.usuarios x where x.activo and x.chat_id <> u.chat_id))
      into v_res from public.usuarios u where u.chat_id = v_u and u.activo;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'fav' then
    update public.usuarios set equipo_fav = case when p_datos ? 'equipo' and jsonb_typeof(p_datos->'equipo') = 'object' then p_datos->'equipo' else null end
     where chat_id = v_u and activo returning jsonb_build_object('equipo_fav', equipo_fav) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'tema' then
    -- diseño de la página de cada quien (colores, fondo, menú, inicio); máximo ~8 KB
    if length(coalesce(p_datos->>'tema', '')) > 8000 then return jsonb_build_object('error', 'Diseño demasiado grande'); end if;
    update public.usuarios set tema = p_datos->'tema' where chat_id = v_u and activo;
    return 'true'::jsonb;

  elsif p_accion = 'favoritos' then
    select coalesce(jsonb_agg(jsonb_build_object('chat_id', chat_id, 'nombre', nombre, 'equipo', equipo_fav)), '[]'::jsonb)
      into v_res from public.usuarios where activo and equipo_fav is not null;
    return v_res;

  elsif p_accion = 'aviso' then
    -- true solo la primera vez (para no avisar dos veces lo mismo)
    insert into privado.avisos (usuario, clave) values (v_u, p_datos->>'clave') on conflict do nothing;
    get diagnostics v_n = row_count;
    return to_jsonb(v_n > 0);

  -- ===================== movimiento de líneas
  elsif p_accion = 'lineas' then
    select coalesce(jsonb_agg(x order by x->>'inicio'), '[]'::jsonb) into v_res from (
      select jsonb_build_object('evento', evento, 'partido', max(partido), 'deporte', max(deporte), 'inicio', min(inicio),
               'mercado', mercado, 'seleccion', seleccion,
               'serie', jsonb_agg(jsonb_build_array(creada, prob) order by creada)) x
        from public.senales
       where inicio > now() - interval '3 hours' and creada > now() - interval '4 days' and prob is not null
       group by evento, mercado, seleccion) t;
    return v_res;

  -- ===================== quiniela
  elsif p_accion = 'quiniela_pick' then
    if (p_datos->>'inicio')::timestamptz <= now() then
      return jsonb_build_object('error', 'Ese partido ya empezó.');
    end if;
    insert into public.quiniela_picks (usuario, evento, liga, partido, inicio, pick)
    values (v_u, p_datos->>'evento', coalesce(p_datos->>'liga', 'soccer/mex.1'), left(coalesce(p_datos->>'partido', ''), 120),
            (p_datos->>'inicio')::timestamptz, p_datos->>'pick')
    on conflict (usuario, evento) do update set pick = excluded.pick, creada = now()
      where public.quiniela_picks.inicio > now();
    return 'true'::jsonb;

  elsif p_accion = 'quiniela' then
    -- picks de todos (solo se ven los de otros cuando el partido ya empezó), resultados y tabla
    select jsonb_build_object(
      'picks', coalesce((select jsonb_agg(jsonb_build_object('usuario', q.usuario, 'nombre', u.nombre, 'evento', q.evento, 'partido', q.partido, 'inicio', q.inicio, 'mio', q.usuario = v_u,
                 'pick', case when q.usuario = v_u or q.inicio <= now() then q.pick else null end))
               from public.quiniela_picks q join public.usuarios u on u.chat_id = q.usuario and u.activo
              where q.inicio > now() - interval '10 days' and q.liga <> 'lol/worlds'), '[]'::jsonb),
      'res', coalesce((select jsonb_object_agg(r.evento, jsonb_build_object('res', r.res, 'marcador', r.marcador))
               from public.quiniela_res r where r.guardado > now() - interval '12 days'), '{}'::jsonb),
      'tabla', coalesce((select jsonb_agg(t order by (t->>'puntos')::int desc, (t->>'jugados')::int) from (
               select jsonb_build_object('nombre', u.nombre, 'yo', u.chat_id = v_u,
                        'puntos', count(*) filter (where r.res = q.pick), 'jugados', count(r.evento)) t
                 from public.quiniela_picks q join public.usuarios u on u.chat_id = q.usuario and u.activo
                 left join public.quiniela_res r on r.evento = q.evento
                where q.inicio > now() - interval '10 days' and q.liga <> 'lol/worlds'
                group by u.chat_id, u.nombre) s), '[]'::jsonb))
      into v_res;
    return v_res;

  elsif p_accion = 'lol_quiniela' then
    -- pick'em del Mundial de LoL: picks (los de otros se ven cuando empieza la serie), resultados y tabla
    select jsonb_build_object(
      'picks', coalesce((select jsonb_agg(jsonb_build_object('nombre', u.nombre, 'evento', q.evento, 'mio', q.usuario = v_u,
                 'pick', case when q.usuario = v_u or q.inicio <= now() then q.pick else null end))
               from public.quiniela_picks q join public.usuarios u on u.chat_id = q.usuario and u.activo where q.liga = 'lol/worlds'), '[]'::jsonb),
      'res', coalesce((select jsonb_object_agg(r.evento, r.res) from public.quiniela_res r where r.evento like 'lol:%'), '{}'::jsonb),
      'tabla', coalesce((select jsonb_agg(t order by (t->>'puntos')::int desc, (t->>'jugados')::int) from (
               select jsonb_build_object('nombre', u.nombre, 'yo', u.chat_id = v_u,
                        'puntos', count(*) filter (where r.res = q.pick), 'jugados', count(r.evento)) t
                 from public.quiniela_picks q join public.usuarios u on u.chat_id = q.usuario and u.activo
                 left join public.quiniela_res r on r.evento = q.evento
                where q.liga = 'lol/worlds' group by u.chat_id, u.nombre) s), '[]'::jsonb))
      into v_res;
    return v_res;

  elsif p_accion = 'quiniela_pendientes' then
    select coalesce(jsonb_agg(distinct jsonb_build_object('evento', q.evento, 'liga', q.liga, 'inicio', q.inicio)), '[]'::jsonb)
      into v_res from public.quiniela_picks q
     where q.inicio < now() - interval '100 minutes' and q.inicio > now() - interval '5 days'
       and not exists (select 1 from public.quiniela_res r where r.evento = q.evento);
    return v_res;

  elsif p_accion = 'quiniela_res' then
    insert into public.quiniela_res (evento, res, marcador) values (p_datos->>'evento', p_datos->>'res', p_datos->>'marcador')
    on conflict (evento) do nothing;
    return 'true'::jsonb;

  -- ===================== retos 1 vs 1
  elsif p_accion = 'reto_crear' then
    if (p_datos->>'inicio')::timestamptz <= now() then return jsonb_build_object('error', 'Ese partido ya empezó.'); end if;
    if not exists(select 1 from public.usuarios where chat_id = p_datos->>'rival' and activo) or p_datos->>'rival' = v_u then
      return jsonb_build_object('error', 'Elige a un amigo que tenga acceso.');
    end if;
    insert into public.retos (retador, rival, evento, liga, partido, inicio, local, visita, logo_local, logo_visita, lado, premio)
    values (v_u, p_datos->>'rival', p_datos->>'evento', p_datos->>'liga', left(p_datos->>'partido', 120),
            (p_datos->>'inicio')::timestamptz, p_datos->>'local', p_datos->>'visita', p_datos->>'logo_local', p_datos->>'logo_visita',
            p_datos->>'lado', left(coalesce(p_datos->>'premio', ''), 80))
    returning jsonb_build_object('id', id, 'retador_nombre', (select nombre from public.usuarios where chat_id = v_u)) into v_res;
    return v_res;

  elsif p_accion = 'reto_responder' then
    update public.retos set estado = case when (p_datos->>'acepta')::boolean then 'aceptado' else 'rechazado' end
     where id = (p_datos->>'id')::bigint and rival = v_u and estado = 'pendiente' and inicio > now()
    returning to_jsonb(retos.*) || jsonb_build_object('rival_nombre', (select nombre from public.usuarios where chat_id = v_u)) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'reto_cancelar' then
    update public.retos set estado = 'cancelado' where id = (p_datos->>'id')::bigint and retador = v_u and estado = 'pendiente'
    returning jsonb_build_object('id', id) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'retos' then
    select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
             'retador_nombre', (select nombre from public.usuarios where chat_id = r.retador),
             'rival_nombre', (select nombre from public.usuarios where chat_id = r.rival)) order by r.creada desc), '[]'::jsonb)
      into v_res from public.retos r
     where (r.retador = v_u or r.rival = v_u) and r.creada > now() - interval '30 days' and r.estado <> 'cancelado';
    return v_res;

  elsif p_accion = 'retos_abiertos' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_res from public.retos r
     where r.estado = 'aceptado' and r.inicio < now() - interval '90 minutes';
    -- los pendientes que nadie aceptó antes del partido se cancelan
    update public.retos set estado = 'cancelado' where estado = 'pendiente' and inicio <= now();
    return v_res;

  elsif p_accion = 'reto_cerrar' then
    update public.retos set estado = 'terminado', ganador = p_datos->>'ganador', marcador = p_datos->>'marcador'
     where id = (p_datos->>'id')::bigint and estado = 'aceptado'
    returning to_jsonb(retos.*) || jsonb_build_object(
      'retador_nombre', (select nombre from public.usuarios where chat_id = retos.retador),
      'rival_nombre', (select nombre from public.usuarios where chat_id = retos.rival)) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  -- ===================== modo práctica
  elsif p_accion = 'practica_crear' then
    select count(*), coalesce(exp(sum(ln(minima))), 1) into v_n, v_cuota
      from public.senales where id in (select (jsonb_array_elements_text(p_datos->'senales'))::bigint)
       and inicio > now() and minima > 1;
    if v_n = 0 or v_n <> jsonb_array_length(p_datos->'senales') then
      return jsonb_build_object('error', 'Alguna selección ya empezó o no está disponible.');
    end if;
    if v_n > 1 and (select count(distinct evento) from public.senales
                     where id in (select (jsonb_array_elements_text(p_datos->'senales'))::bigint)) <> v_n then
      return jsonb_build_object('error', 'En un parlay no puedes repetir partido.');
    end if;
    select (p->>'practica_banca')::numeric - (p->>'practica_en_juego')::numeric into v_disp
      from (select public.mas(p_clave, 'perfil', jsonb_build_object('usuario', v_u)) p) z;
    if (p_datos->>'monto')::numeric > coalesce(v_disp, 0) then
      return jsonb_build_object('error', 'No te alcanza la banca de práctica.');
    end if;
    insert into public.practica (usuario, tipo, monto, cuota)
    values (v_u, case when v_n > 1 then 'parlay' else 'simple' end, (p_datos->>'monto')::numeric, round(v_cuota, 3))
    returning id into v_id;
    insert into public.practica_piernas (practica_id, senal_id, evento, partido, deporte, inicio, mercado, seleccion, cuota)
    select v_id, id, evento, partido, deporte, inicio, mercado, seleccion, minima
      from public.senales where id in (select (jsonb_array_elements_text(p_datos->'senales'))::bigint);
    return jsonb_build_object('id', v_id, 'cuota', round(v_cuota, 3));

  elsif p_accion = 'practica' then
    select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('piernas',
             (select jsonb_agg(to_jsonb(g) order by g.inicio) from public.practica_piernas g where g.practica_id = p.id))
             order by p.creada desc), '[]'::jsonb)
      into v_res from public.practica p
     where p.usuario = v_u and not p.oculta and p.torneo is null and (p.estado = 'pendiente' or p.cerrada > now() - interval '7 days');
    return v_res;

  elsif p_accion = 'practica_pendientes' then
    select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb) into v_res from public.practica_piernas g
      join public.practica p on p.id = g.practica_id and p.estado = 'pendiente'
     where g.resultado = 'pendiente' and g.inicio < now() - interval '100 minutes' and g.inicio > now() - interval '5 days';
    return v_res;

  elsif p_accion = 'practica_pierna' then
    update public.practica_piernas set resultado = p_datos->>'resultado', marcador = left(p_datos->>'marcador', 120)
     where id = (p_datos->>'id')::bigint and resultado = 'pendiente' returning practica_id into v_id;
    if v_id is null then return 'null'::jsonb; end if;
    if not exists(select 1 from public.practica_piernas where practica_id = v_id and resultado = 'pendiente')
       or exists(select 1 from public.practica_piernas where practica_id = v_id and resultado = 'pierde') then
      update public.practica p set
        estado = case when exists(select 1 from public.practica_piernas where practica_id = v_id and resultado = 'pierde') then 'pierde'
                      when not exists(select 1 from public.practica_piernas where practica_id = v_id and resultado = 'gana') then 'nula'
                      else 'gana' end,
        cerrada = now()
       where p.id = v_id and p.estado = 'pendiente' returning * into v_p;
      if v_p.id is not null then
        update public.practica set ganancia = case v_p.estado
            when 'pierde' then -v_p.monto
            when 'nula' then 0
            else v_p.monto * (coalesce((select exp(sum(ln(cuota))) from public.practica_piernas
                                         where practica_id = v_id and resultado = 'gana'), 1) - 1) end
         where id = v_id;
        return (select to_jsonb(p) from public.practica p where p.id = v_id);
      end if;
    end if;
    return 'true'::jsonb;

  elsif p_accion = 'practica_reiniciar' then
    update public.practica set oculta = true where usuario = v_u and estado <> 'pendiente';
    update public.usuarios set practica_banca = 1000 where chat_id = v_u;
    return 'true'::jsonb;

  -- ===================== respaldo mensual
  elsif p_accion = 'respaldo' then
    select coalesce(jsonb_agg(jsonb_build_object('chat_id', u.chat_id, 'nombre', u.nombre,
             'apuestas', coalesce((select jsonb_agg(to_jsonb(a) - 'descartados' - 'evento' order by a.creada)
                                     from public.apuestas a where a.usuario = u.chat_id), '[]'::jsonb))), '[]'::jsonb)
      into v_res from public.usuarios u where u.activo;
    return v_res;
  end if;

  raise exception 'acción desconocida: %', p_accion;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mas_lineas()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x order by x->>'inicio'), '[]'::jsonb) from (
    select jsonb_build_object('evento', evento, 'partido', max(partido), 'deporte', max(deporte), 'inicio', min(inicio),
             'mercado', mercado, 'seleccion', seleccion,
             'id', (array_agg(id order by creada desc))[1], 'minima', (array_agg(minima order by creada desc))[1],
             'pin', (array_agg(pin order by creada desc) filter (where pin is not null))[1],
             'serie', jsonb_agg(jsonb_build_array(creada, prob) order by creada)) x
      from public.senales
     where inicio > now() - interval '3 hours' and creada > now() - interval '4 days' and prob is not null
     group by evento, mercado, seleccion) t
$function$
;

CREATE OR REPLACE FUNCTION public.neto_libre(u text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object('depositado', coalesce(sum(monto) filter (where tipo = 'deposito'), 0),
                            'retirado', coalesce(sum(monto) filter (where tipo = 'retiro'), 0))
    from public.movimientos where usuario = u and not anulado and cartera = 'libre'
$function$
;

CREATE OR REPLACE FUNCTION public.neto_mov(u text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(case tipo when 'deposito' then monto else -monto end), 0) from public.movimientos where usuario = u and not anulado and cartera = 'bot'
$function$
;

CREATE OR REPLACE FUNCTION public.opinion(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_id bigint;
  v_r public.opiniones;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then
    raise exception 'no autorizado';
  end if;

  if p_accion = 'crear' then
    if length(trim(coalesce(p_datos->>'texto',''))) < 3 then raise exception 'Escribe tu comentario'; end if;
    if (select count(*) from public.opiniones where usuario = v_u and creado > now() - interval '1 hour') >= 10 then
      raise exception 'Ya mandaste muchas en la última hora, gracias. Intenta más tarde.';
    end if;
    insert into public.opiniones(usuario, tipo, estrellas, texto, seccion)
    values (v_u, coalesce(nullif(p_datos->>'tipo',''),'idea'), nullif(p_datos->>'estrellas','')::int,
            left(trim(p_datos->>'texto'), 1000), left(nullif(p_datos->>'seccion',''), 40))
    returning * into v_r;
    return to_jsonb(v_r) || jsonb_build_object('nombre', (select nombre from public.usuarios where chat_id = v_u));

  elsif p_accion = 'lista' then
    -- todas (con nombre y votos); el que pide ve marcado lo suyo
    return coalesce((select jsonb_agg(x order by x.ord, x.creado desc) from (
      select o.id, o.tipo, o.estrellas, o.texto, o.seccion, o.estado, o.respuesta, o.creado, o.actualizado,
             coalesce(u.nombre, 'Alguien') nombre, (o.usuario = v_u) mia,
             cardinality(o.votos) votos, (v_u = any(o.votos)) vote,
             case when o.estado in ('hecha','no') then 1 else 0 end ord
      from public.opiniones o left join public.usuarios u on u.chat_id = o.usuario
      where o.creado > now() - interval '120 days' limit 200) x), '[]'::jsonb);

  elsif p_accion = 'votar' then
    v_id := (p_datos->>'id')::bigint;
    update public.opiniones set votos = case when v_u = any(votos) then array_remove(votos, v_u) else votos || v_u end
    where id = v_id and usuario <> v_u;
    return jsonb_build_object('ok', true);

  elsif p_accion = 'estado' then
    -- solo el dueño (lo valida la API)
    v_id := (p_datos->>'id')::bigint;
    update public.opiniones set
      estado = coalesce(nullif(p_datos->>'estado',''), estado),
      respuesta = coalesce(nullif(p_datos->>'respuesta',''), respuesta),
      actualizado = now()
    where id = v_id returning * into v_r;
    if v_r.id is null then raise exception 'No existe esa opinión'; end if;
    return to_jsonb(v_r);

  elsif p_accion = 'resumen' then
    return jsonb_build_object(
      'nuevas', (select count(*) from public.opiniones where estado = 'nueva'),
      'promedio', (select round(avg(estrellas)::numeric, 1) from public.opiniones where estrellas is not null),
      'calificaciones', (select count(*) from public.opiniones where estrellas is not null),
      'hechas', (select count(*) from public.opiniones where estado = 'hecha'));
  end if;
  raise exception 'acción desconocida';
end $function$
;

CREATE OR REPLACE FUNCTION public.resultados(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_res jsonb;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then
    raise exception 'no autorizado';
  end if;

  if p_accion = 'pendientes' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id, 'usuario', a.usuario, 'cartera', a.cartera, 'partido', a.partido, 'seleccion', a.seleccion,
             'cuota', a.cuota, 'monto', a.monto, 'creada', a.creada, 'evento', a.evento, 'descartados', a.descartados)), '[]'::jsonb)
      into v_res
      from public.apuestas a join public.usuarios u on u.chat_id = a.usuario and u.activo
     where a.resultado = 'pendiente' and a.creada > now() - interval '5 days';
    return v_res;

  elsif p_accion = 'proponer' then
    update public.apuestas
       set evento = p_datos->>'evento', marcador = left(p_datos->>'marcador', 200),
           logo = coalesce(nullif(logo, ''), left(p_datos->>'logo', 400))
     where id = (p_datos->>'id')::bigint and resultado = 'pendiente'
       and evento is distinct from p_datos->>'evento'
       and not (p_datos->>'evento' = any(descartados))
    returning jsonb_build_object('id', id) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'descartar' then
    update public.apuestas
       set descartados = array_append(descartados, evento), evento = null, marcador = null
     where id = (p_datos->>'id')::bigint and usuario = p_datos->>'usuario'
    returning jsonb_build_object('id', id) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'logo' then
    update public.apuestas
       set logo = coalesce(logo, left(p_datos->>'logo', 400)),
           liga = coalesce(liga, left(p_datos->>'liga', 40)),
           liga_logo = coalesce(liga_logo, left(p_datos->>'liga_logo', 400))
     where id = (p_datos->>'id')::bigint
    returning jsonb_build_object('id', id) into v_res;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'logo_forzar' then
    -- El usuario eligió el club correcto: reemplaza logo y liga (solo en sus propias apuestas)
    update public.apuestas
       set logo = left(p_datos->>'logo', 400), liga = left(p_datos->>'liga', 40), liga_logo = left(p_datos->>'liga_logo', 400)
     where id = (p_datos->>'id')::bigint and usuario = p_datos->>'usuario'
    returning jsonb_build_object('id', id) into v_res;
    return coalesce(v_res, 'null'::jsonb);
  end if;

  raise exception 'acción desconocida: %', p_accion;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.senal(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_res jsonb;
  v_s public.senales;
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then
    raise exception 'no autorizado';
  end if;

  if p_accion = 'guardar' then
    with nuevas as (
      insert into public.senales (lote, evento, partido, deporte, inicio, mercado, seleccion, prob, minima, pin)
      select p_datos->>'lote', f->>'evento', left(f->>'partido', 120), coalesce(f->>'deporte', ''),
             nullif(f->>'inicio', '')::timestamptz, f->>'mercado', left(f->>'seleccion', 120),
             nullif(f->>'prob', '')::numeric, nullif(f->>'minima', '')::numeric, nullif(f->>'pin', '')::numeric
        from jsonb_array_elements(p_datos->'filas') f
      returning id, evento, mercado, seleccion)
    select coalesce(jsonb_agg(to_jsonb(nuevas)), '[]'::jsonb) into v_res from nuevas;
    return v_res;

  elsif p_accion = 'hermanas' then
    select * into v_s from public.senales where id = (p_datos->>'id')::bigint;
    if v_s.id is null then return 'null'::jsonb; end if;
    select jsonb_build_object('partido', v_s.partido, 'inicio', v_s.inicio,
             'opciones', coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb))
      into v_res from public.senales s where s.lote = v_s.lote and s.evento = v_s.evento;
    return v_res;

  elsif p_accion = 'esperar' then
    insert into privado.esperas (chat_id, senal_id, expira)
    values (p_datos->>'usuario', (p_datos->>'id')::bigint, now() + interval '15 minutes')
    on conflict (chat_id) do update set senal_id = excluded.senal_id, expira = excluded.expira;
    select to_jsonb(s) into v_res from public.senales s where id = (p_datos->>'id')::bigint;
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'espera' then
    select to_jsonb(s) into v_res
      from privado.esperas e join public.senales s on s.id = e.senal_id
     where e.chat_id = p_datos->>'usuario' and e.expira > now();
    return coalesce(v_res, 'null'::jsonb);

  elsif p_accion = 'fin' then
    update privado.esperas set expira = now() where chat_id = p_datos->>'usuario';
    return 'true'::jsonb;
  end if;

  raise exception 'acción desconocida: %', p_accion;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.terminos(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_u text := p_datos->>'usuario';
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then raise exception 'no autorizado'; end if;
  if p_accion = 'estado' then
    return coalesce((select terminos from public.usuarios where chat_id = v_u), '{}'::jsonb);
  elsif p_accion = 'aceptar' then
    update public.usuarios set terminos = jsonb_build_object('v', p_datos->>'v', 'fecha', now(), 'medio', p_datos->>'medio') where chat_id = v_u;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'acción desconocida';
end $function$
;

CREATE OR REPLACE FUNCTION public.torneo(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_u text := p_datos->>'usuario';
  v_hoy date := (now() at time zone 'America/Mexico_City')::date;
  v_sem date := v_hoy - (extract(isodow from v_hoy)::int - 1);       -- lunes de esta semana
  v_fin timestamptz := ((v_sem + 7)::timestamp at time zone 'America/Mexico_City');   -- lunes 00:00 siguiente
  v_n int; v_cuota numeric; v_id bigint; v_disp numeric; v_res jsonb; v_ant date; r record; v_pos int := 0;
  PREMIOS numeric[] := array[500, 300, 150];
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then raise exception 'no autorizado'; end if;

  if p_accion = 'estado' then
    v_ant := v_sem - 7;
    return jsonb_build_object(
      'semana', v_sem, 'termina', v_fin,
      'banca', 1000 + coalesce((select sum(ganancia) from public.practica where usuario = v_u and torneo = v_sem and estado <> 'pendiente'), 0),
      'en_juego', coalesce((select sum(monto) from public.practica where usuario = v_u and torneo = v_sem and estado = 'pendiente'), 0),
      'mias', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object('piernas',
                 (select jsonb_agg(to_jsonb(g) order by g.inicio) from public.practica_piernas g where g.practica_id = p.id)) order by p.creada desc)
               from public.practica p where p.usuario = v_u and p.torneo = v_sem), '[]'::jsonb),
      'tabla', coalesce((select jsonb_agg(t order by (t->>'banca')::numeric desc, (t->>'n')::int desc) from (
          select jsonb_build_object('nombre', u.nombre, 'yo', u.chat_id = v_u,
                   'banca', 1000 + coalesce(sum(p.ganancia) filter (where p.estado <> 'pendiente'), 0),
                   'en_juego', coalesce(sum(p.monto) filter (where p.estado = 'pendiente'), 0),
                   'n', count(*), 'ganadas', count(*) filter (where p.estado = 'gana')) t
            from public.practica p join public.usuarios u on u.chat_id = p.usuario
           where p.torneo = v_sem group by u.chat_id, u.nombre) z), '[]'::jsonb),
      'anterior', coalesce((select jsonb_agg(t order by (t->>'banca')::numeric desc) from (
          select jsonb_build_object('nombre', u.nombre, 'yo', u.chat_id = v_u,
                   'banca', 1000 + coalesce(sum(p.ganancia) filter (where p.estado <> 'pendiente'), 0), 'n', count(*)) t
            from public.practica p join public.usuarios u on u.chat_id = p.usuario
           where p.torneo = v_ant group by u.chat_id, u.nombre having count(*) >= 3) z), '[]'::jsonb),
      'campeonatos', (select count(*) from public.monedas where usuario = v_u and concepto = 'torneo_1'));

  elsif p_accion = 'crear' then
    select count(*), coalesce(exp(sum(ln(minima))), 1) into v_n, v_cuota
      from public.senales where id in (select (jsonb_array_elements_text(p_datos->'senales'))::bigint)
       and inicio > now() and inicio < v_fin and minima > 1;
    if v_n = 0 or v_n <> jsonb_array_length(p_datos->'senales') then
      return jsonb_build_object('error', 'Alguna selección ya empezó, no está disponible o se juega después del domingo (el torneo cierra el domingo).');
    end if;
    if v_n > 1 and (select count(distinct evento) from public.senales
                     where id in (select (jsonb_array_elements_text(p_datos->'senales'))::bigint)) <> v_n then
      return jsonb_build_object('error', 'En un parlay no puedes repetir partido.');
    end if;
    v_disp := 1000 + coalesce((select sum(ganancia) from public.practica where usuario = v_u and torneo = v_sem and estado <> 'pendiente'), 0)
                   - coalesce((select sum(monto) from public.practica where usuario = v_u and torneo = v_sem and estado = 'pendiente'), 0);
    if coalesce((p_datos->>'monto')::numeric, 0) <= 0 or (p_datos->>'monto')::numeric > v_disp then
      return jsonb_build_object('error', 'No te alcanza la banca del torneo.');
    end if;
    insert into public.practica (usuario, tipo, monto, cuota, torneo)
    values (v_u, case when v_n > 1 then 'parlay' else 'simple' end, (p_datos->>'monto')::numeric, round(v_cuota, 3), v_sem)
    returning id into v_id;
    insert into public.practica_piernas (practica_id, senal_id, evento, partido, deporte, inicio, mercado, seleccion, cuota)
    select v_id, id, evento, partido, deporte, inicio, mercado, seleccion, minima
      from public.senales where id in (select (jsonb_array_elements_text(p_datos->'senales'))::bigint);
    return jsonb_build_object('id', v_id, 'cuota', round(v_cuota, 3));

  elsif p_accion = 'premiar' then
    -- se llama seguido (resultados cada 15 min); premia la semana pasada una sola vez, cuando ya no hay pendientes (o pasó el miércoles)
    v_ant := v_sem - 7;
    if exists(select 1 from privado.avisos where usuario = 'torneo' and clave = 'premiado:' || v_ant) then return '[]'::jsonb; end if;
    if not exists(select 1 from public.practica where torneo = v_ant) then return '[]'::jsonb; end if;
    if exists(select 1 from public.practica where torneo = v_ant and estado = 'pendiente') and v_hoy < v_sem + 2 then return '[]'::jsonb; end if;
    insert into privado.avisos(usuario, clave) values ('torneo', 'premiado:' || v_ant);
    v_res := '[]'::jsonb;
    for r in select p.usuario, u.nombre, 1000 + coalesce(sum(p.ganancia) filter (where p.estado <> 'pendiente'), 0) banca, count(*) n
               from public.practica p join public.usuarios u on u.chat_id = p.usuario
              where p.torneo = v_ant group by p.usuario, u.nombre having count(*) >= 3
              order by 3 desc, 4 desc loop
      v_pos := v_pos + 1;
      if v_pos <= 3 then
        insert into public.monedas (usuario, concepto, monto, puntos) values (r.usuario, 'torneo_' || v_pos, PREMIOS[v_pos], 0);
        if v_pos = 1 then insert into public.logros (usuario, logro) values (r.usuario, 'torneo_campeon') on conflict do nothing; end if;
      end if;
      v_res := v_res || jsonb_build_object('usuario', r.usuario, 'nombre', r.nombre, 'pos', v_pos, 'banca', r.banca, 'n', r.n,
                                           'premio', case when v_pos <= 3 then PREMIOS[v_pos] else 0 end);
    end loop;
    return jsonb_build_object('semana', v_ant, 'tabla', v_res);
  end if;
  raise exception 'acción desconocida';
end $function$
;

CREATE OR REPLACE FUNCTION public.web(p_clave text, p_accion text, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_chat text;
  v_token text;
  v_u public.usuarios;
  v_nombre text := lower(trim(coalesce(p_datos->>'nombre_web', '')));
begin
  if not exists(select 1 from privado.secretos where nombre = 'bot' and valor = p_clave) then
    raise exception 'no autorizado';
  end if;

  if p_accion = 'cuenta' then
    if v_nombre !~ '^[a-z0-9_.]{3,20}$' then
      return jsonb_build_object('error', 'El usuario debe tener de 3 a 20 letras, números, punto o guion bajo.');
    end if;
    if length(coalesce(p_datos->>'pass', '')) < 6 then
      return jsonb_build_object('error', 'La contraseña debe tener al menos 6 caracteres.');
    end if;
    if exists(select 1 from public.usuarios where usuario_web = v_nombre and chat_id <> p_datos->>'usuario') then
      return jsonb_build_object('error', 'Ese usuario ya está ocupado. Elige otro.');
    end if;
    update public.usuarios
       set usuario_web = v_nombre,
           pass_hash = extensions.crypt(p_datos->>'pass', extensions.gen_salt('bf')),
           fallos = 0, bloqueo = null
     where chat_id = p_datos->>'usuario' and activo
    returning * into v_u;
    if v_u.chat_id is null then return jsonb_build_object('error', 'No tienes acceso al bot.'); end if;
    update privado.sesiones set expira = now() where chat_id = v_u.chat_id and expira > now();
    return jsonb_build_object('ok', true, 'usuario_web', v_nombre);

  elsif p_accion = 'login' then
    select * into v_u from public.usuarios where usuario_web = v_nombre and activo;
    if v_u.chat_id is null then
      return jsonb_build_object('error', 'Usuario o contraseña incorrectos.');
    end if;
    if v_u.bloqueo is not null and v_u.bloqueo > now() then
      return jsonb_build_object('error', 'Demasiados intentos. Espera 15 minutos o cambia tu contraseña desde el bot.');
    end if;
    if v_u.pass_hash is null or extensions.crypt(coalesce(p_datos->>'pass', ''), v_u.pass_hash) <> v_u.pass_hash then
      update public.usuarios
         set fallos = fallos + 1,
             bloqueo = case when fallos + 1 >= 5 then now() + interval '15 minutes' else bloqueo end
       where chat_id = v_u.chat_id;
      return jsonb_build_object('error', 'Usuario o contraseña incorrectos.');
    end if;
    update public.usuarios set fallos = 0, bloqueo = null where chat_id = v_u.chat_id;
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into privado.sesiones (token_hash, chat_id)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_u.chat_id);
    return jsonb_build_object('token', v_token);

  elsif p_accion = 'sesion' then
    select s.chat_id into v_chat
      from privado.sesiones s join public.usuarios u on u.chat_id = s.chat_id and u.activo
     where s.token_hash = encode(extensions.digest(coalesce(p_datos->>'token', ''), 'sha256'), 'hex')
       and s.expira > now();
    return coalesce(to_jsonb(v_chat), 'null'::jsonb);

  elsif p_accion = 'salir' then
    update privado.sesiones set expira = now()
     where token_hash = encode(extensions.digest(coalesce(p_datos->>'token', ''), 'sha256'), 'hex');
    return 'true'::jsonb;

  elsif p_accion = 'todas' then
    return jsonb_build_object(
      'nombre', (select nombre from public.usuarios where chat_id = p_datos->>'usuario'),
      'usuario_web', (select usuario_web from public.usuarios where chat_id = p_datos->>'usuario'),
      'banca', (select banca_inicial + public.neto_mov(chat_id) from public.usuarios where chat_id = p_datos->>'usuario'),
      'limite', (select limite_semanal from public.usuarios where chat_id = p_datos->>'usuario'),
      'apuestas', coalesce((select jsonb_agg(to_jsonb(a) order by a.creada desc)
                              from public.apuestas a where a.usuario = p_datos->>'usuario'), '[]'::jsonb));
  end if;

  raise exception 'acción desconocida: %', p_accion;
end;
$function$
;

-- ======================= permisos: el navegador NO entra directo a las tablas, todo pasa por las funciones
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema privado from anon, authenticated;

-- ======================= secretos (CAMBIA los valores)
-- "bot": una clave larga inventada por ti; va también en Vercel como BOT_CLAVE.
-- "github": un token de GitHub (fine-grained, permiso Actions: write en tu repo) para disparar los procesos a su hora.
insert into privado.secretos (nombre, valor) values ('bot', 'CAMBIA-ESTO-POR-UNA-CLAVE-LARGA'), ('github', 'CAMBIA-ESTO-POR-TU-TOKEN-DE-GITHUB')
  on conflict (nombre) do nothing;

-- ======================= horarios (UTC). Antes edita privado.disparar con TU usuario/repositorio de GitHub.
select cron.schedule('alertas-manana', '0 13 * * *', 'select privado.disparar(''alertas.yml'')');
select cron.schedule('alertas-tarde', '0 0 * * *', 'select privado.disparar(''alertas.yml'')');
select cron.schedule('guru-excel', '45 13 * * *', 'select privado.disparar(''guru_excel.yml'', ''{"prueba":"false"}'')');
select cron.schedule('guru-manana', '25 13 * * *', 'select privado.disparar(''pronosticos.yml'', ''{"prueba":"false"}'')');
select cron.schedule('guru-tarde', '25 0 * * *', 'select privado.disparar(''pronosticos.yml'', ''{"prueba":"false"}'')');
select cron.schedule('respaldo-mes', '7 15 1 * *', 'select privado.disparar(''respaldo.yml'', ''{"prueba":"false"}'')');
select cron.schedule('resultados-15min', '2,17,32,47 0-7,12-23 * * *', 'select privado.disparar(''resultados.yml'', ''{"prueba":"false"}'')');
select cron.schedule('resultados-madrugada', '17 8-11 * * *', 'select privado.disparar(''resultados.yml'', ''{"prueba":"false"}'')');
select cron.schedule('resumen-lunes', '0 3 * * 1', 'select privado.disparar(''resumen.yml'', ''{"prueba":"false"}'')');
