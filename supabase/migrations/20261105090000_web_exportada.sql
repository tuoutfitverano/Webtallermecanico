-- Copia de la web de un taller (docs/EXPORTAR_WEB.md, contrato de web).
--
-- Un taller que ha pagado su web se la lleva aunque deje el servicio: la copia
-- se genera con los mismos datos que su web pública (get_public_site), pero
-- buscados por el identificador del taller (slug) y AUNQUE la web esté sin
-- publicar o el taller suspendido, que es justo cuando se la lleva.
--
-- Solo lectura. Solo desde el SQL Editor o el flujo «Exportar la web de un
-- taller» (conexión de administración): nadie de la API puede ejecutarla.
-- Misma forma que get_public_site (lo comprueba 27_web_exportada.test.sql).
create function private.exported_site(p_slug text)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'workshop', jsonb_build_object('id', w.id, 'slug', w.slug, 'name', w.name),
    'site', jsonb_build_object('is_demo_content', s.is_demo_content, 'theme', s.theme, 'content', s.content),
    'legal', jsonb_build_object(
      'legal_name', w.legal_name, 'tax_id', w.tax_id, 'address_line', w.address_line, 'postal_code', w.postal_code,
      'city', w.city, 'province', w.province, 'registry_info', w.registry_info, 'email', w.legal_email)
  )
  from public.workshops w
  join public.workshop_sites s on s.workshop_id = w.id
  where w.slug = btrim(p_slug);
$$;
revoke all on function private.exported_site(text) from public, anon, authenticated, service_role;
