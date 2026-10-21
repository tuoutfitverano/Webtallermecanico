-- Inventario de la copia: por cada tabla propia, número de filas y una huella
-- (md5 de las filas ordenadas). No contiene datos personales: sirve para
-- comprobar que una restauración devuelve exactamente lo mismo.
select coalesce(json_object_agg(t.name, json_build_object('rows', t.rows, 'md5', t.md5) order by t.name), '{}')
  from (
    select format('%I.%I', n.nspname, c.relname) as name,
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows,
           (xpath('/row/h/text()', query_to_xml(format(
              'select md5(coalesce(string_agg(r::text, chr(10) order by r::text), %L)) as h from %I.%I r', '', n.nspname, c.relname), false, true, '')))[1]::text as md5
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p')
       and (n.nspname in ('public', 'private') or (n.nspname = 'auth' and c.relname in ('users', 'identities')))
  ) t;
