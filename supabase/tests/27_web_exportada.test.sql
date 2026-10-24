-- Copia de la web de un taller: los mismos datos que su web pública, aunque esté
-- sin publicar o suspendido, y solo desde una conexión de administración.
begin;
\ir _harness/fixtures.sql

select tests.eq((select private.exported_site('taller-alcarria') = public.get_public_site('alcarria.test')), true,
  'mismos datos que la web pública (misma forma que get_public_site)');
select tests.eq((select private.exported_site('taller-chamberi') -> 'workshop' ->> 'slug'), 'taller-chamberi',
  'también con la web sin publicar');
update public.workshops set status = 'suspendido' where id = 'aaaaaaaa-0000-0000-0000-000000000000';
select tests.eq((select public.get_public_site('alcarria.test')), null::jsonb, '(suspendido: su web pública ya no se ve)');
select tests.eq((select private.exported_site('taller-alcarria') -> 'site' -> 'content' ->> 'tagline'), 'Demo',
  'pero su copia sí se puede generar');
select tests.eq((select private.exported_site('no-existe')), null::jsonb, 'un taller que no existe no devuelve nada');

select tests.eq((select has_function_privilege('anon', 'private.exported_site(text)', 'execute')
                     or has_function_privilege('authenticated', 'private.exported_site(text)', 'execute')
                     or has_function_privilege('service_role', 'private.exported_site(text)', 'execute')), false,
  'nadie de la API la puede ejecutar');
set local role authenticated;
select tests.throws($$select private.exported_site('taller-alcarria')$$, 'una cuenta no la ejecuta', '%permission denied%');
reset role;

rollback;
