-- Recuperar la cuenta sin el móvil de la verificación en dos pasos: códigos de
-- recuperación, correo (contraseña + código del correo) y administración.
begin;
\ir _harness/fixtures.sql

-- Sesión con el claim «amr» de Supabase Auth: método y hace cuántos segundos.
create function pg_temp.login_amr(p_user uuid, p_aal text, p_method text, p_ago integer default 0) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal,
    'amr', json_build_array(json_build_object('method', p_method, 'timestamp', extract(epoch from now())::bigint - p_ago)))::text, true);
$$;
create function pg_temp.factors(p_user uuid) returns bigint language sql as $$
  select count(*) from auth.mfa_factors where user_id = p_user;
$$;

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'app', 'totp', 'verified', now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000000ad', 'app', 'totp', 'verified', now(), now());

-- ===================== Nadie toca las tablas =====================
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal2', 'totp');
set local role authenticated;
select tests.throws($$select * from public.mfa_recovery_codes$$, 'nadie lee los códigos', '%permission denied%');
select tests.throws($$insert into public.mfa_email_recoveries (user_id, expires_at) values (auth.uid(), now())$$, 'ni crea peticiones a mano', '%permission denied%');
reset role;

-- ===================== Códigos de recuperación =====================
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'password');
set local role authenticated;
select tests.throws($$select public.create_mfa_recovery_codes()$$, 'sin entrar con el código no se crean códigos', '%verificación en dos pasos%');
reset role;

select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal2', 'totp');
set local role authenticated;
create temp table codigos on commit drop as select c from public.create_mfa_recovery_codes() c;
reset role;
select tests.eq((select count(*) from codigos), 10::bigint, 'se crean 10 códigos');
select tests.eq((select count(*) from codigos where c ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$'), 10::bigint, 'con el formato ABCD-EFGH-JKLM-NPQR');
select tests.eq((select count(distinct c) from codigos), 10::bigint, 'todos distintos');
select tests.eq((select count(*) from public.mfa_recovery_codes r join codigos on r.code_hash = encode(sha256(convert_to(replace(c, '-', ''), 'UTF8')), 'hex')), 10::bigint,
  'solo se guarda su huella');
select tests.eq((select count(*) from public.mfa_recovery_codes where code_hash in (select c from codigos)), 0::bigint, '(nunca el código)');
set local role authenticated;
select tests.eq((select codes_left from public.mfa_recovery_status()), 10, 'la persona ve cuántos le quedan');
reset role;

-- Otra persona no puede usar esos códigos.
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000b1', 'aal1', 'password');
set local role authenticated;
select tests.eq((select public.use_mfa_recovery_code((select c from codigos limit 1)) ->> 'reason'), 'sin_verificacion', 'un código de otra cuenta no sirve');
reset role;

select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'password');
set local role authenticated;
select tests.eq((select public.use_mfa_recovery_code('AAAA-BBBB-CCCC-DDDD') ->> 'reason'), 'incorrecto', 'un código inventado no sirve');
select tests.eq((select public.use_mfa_recovery_code(lower(replace((select c from codigos limit 1), '-', ' '))) ->> 'ok'), 'true',
  'un código válido sirve (sin guiones y en minúsculas también)');
reset role;
select tests.eq(pg_temp.factors('00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'y quita la verificación en dos pasos');
select tests.eq((select count(*) from public.mfa_recovery_codes where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'y los demás códigos');
select tests.eq((select count(*) from public.access_events where kind = 'dos_pasos_recuperada_codigo' and subject_user = '00000000-0000-0000-0000-0000000000a1'), 1::bigint,
  'queda en el registro de accesos');
set local role authenticated;
select tests.eq((select public.use_mfa_recovery_code((select c from codigos offset 1 limit 1)) ->> 'reason'), 'sin_verificacion', 'sin verificación ya no hay nada que recuperar');
reset role;

-- Límite de intentos: 5 fallos en 15 minutos.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'app2', 'totp', 'verified', now(), now());
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal2', 'totp');
set local role authenticated;
create temp table codigos2 on commit drop as select c from public.create_mfa_recovery_codes() c;
reset role;
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'password');
set local role authenticated;
select public.use_mfa_recovery_code('XXXX-XXXX-XXXX-XXX' || n) from generate_series(1, 5) n;
select tests.eq((select public.use_mfa_recovery_code((select c from codigos2 limit 1)) ->> 'reason'), 'demasiados', 'tras 5 fallos, ni un código bueno sirve durante 15 minutos');
reset role;
select tests.eq(pg_temp.factors('00000000-0000-0000-0000-0000000000a1'), 1::bigint, '(la verificación sigue puesta)');
delete from public.mfa_recovery_failures;

-- ===================== Por correo =====================
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'recovery');
set local role authenticated;
select tests.eq((select public.start_mfa_email_recovery() ->> 'reason'), 'contrasena', 'sin haber escrito la contraseña no se empieza (un enlace de «olvidé la contraseña» no basta)');
reset role;
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'password', 3600);
set local role authenticated;
select tests.eq((select public.start_mfa_email_recovery() ->> 'reason'), 'contrasena', 'la contraseña tiene que ser de hace menos de 15 minutos');
reset role;
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'password');
set local role authenticated;
select tests.eq((select public.finish_mfa_email_recovery() ->> 'reason'), 'caducada', 'sin pedirla antes no se termina');
select tests.eq((select public.start_mfa_email_recovery() ->> 'ok'), 'true', 'con la contraseña recién escrita, se pide');
select tests.eq((select public.finish_mfa_email_recovery() ->> 'reason'), 'correo', 'con la sesión de la contraseña no se termina: hace falta el código del correo');
reset role;
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'otp', 3600);
set local role authenticated;
select tests.eq((select public.finish_mfa_email_recovery() ->> 'reason'), 'correo', 'un código de correo de antes de la petición no vale');
reset role;
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'otp');
set local role authenticated;
select tests.eq((select public.finish_mfa_email_recovery() ->> 'ok'), 'true', 'con el código del correo, se termina');
select tests.eq((select public.finish_mfa_email_recovery() ->> 'reason'), 'caducada', 'y la petición ya no vale otra vez');
reset role;
select tests.eq(pg_temp.factors('00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'y quita la verificación');
select tests.eq((select count(*) from public.access_events where kind = 'dos_pasos_recuperada_correo'), 1::bigint, 'queda en el registro');

-- Peticiones caducadas y límite de 3 por hora.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', 'app3', 'totp', 'verified', now(), now());
update public.mfa_email_recoveries set expires_at = now() - interval '1 minute';
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'otp');
set local role authenticated;
select tests.eq((select public.finish_mfa_email_recovery() ->> 'reason'), 'caducada', 'pasados 15 minutos la petición caduca');
reset role;
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000a1', 'aal1', 'password');
set local role authenticated;
select public.start_mfa_email_recovery();
select public.start_mfa_email_recovery();
select tests.eq((select public.start_mfa_email_recovery() ->> 'reason'), 'demasiados', 'como mucho 3 peticiones por hora');
reset role;

-- La administración de la plataforma no se recupera por correo.
select pg_temp.login_amr('00000000-0000-0000-0000-0000000000ad', 'aal1', 'password');
set local role authenticated;
select tests.eq((select public.start_mfa_email_recovery() ->> 'reason'), 'administracion', 'la administración de la plataforma no puede usar el correo');
reset role;

-- ===================== Administración (SQL Editor) =====================
select tests.throws($$select private.admin_reset_mfa('nadie@x.test', 'comprobado por teléfono')$$, 'un correo que no existe', '%No hay ninguna cuenta%');
select tests.throws($$select private.admin_reset_mfa('x', 'corto')$$, 'sin motivo no se hace', '%motivo%');
select tests.eq((select has_function_privilege('authenticated', 'private.admin_reset_mfa(text, text)', 'execute')
                     or has_function_privilege('service_role', 'private.admin_reset_mfa(text, text)', 'execute')), false,
  'solo desde el SQL Editor');
select private.admin_reset_mfa((select email from auth.users where id = '00000000-0000-0000-0000-0000000000ad'), 'Comprobado en persona con su DNI');
select tests.eq(pg_temp.factors('00000000-0000-0000-0000-0000000000ad'), 0::bigint, 'la administración la retira');
select tests.eq((select detail ->> 'motivo' from public.access_events where kind = 'dos_pasos_retirada_admin'), 'Comprobado en persona con su DNI', 'con su motivo en el registro');

rollback;
