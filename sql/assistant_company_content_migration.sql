do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'assistant_section_content_section_key_check'
      and conrelid = 'public.assistant_section_content'::regclass
  ) then
    alter table public.assistant_section_content
      drop constraint assistant_section_content_section_key_check;
  end if;
exception
  when undefined_table then
    null;
end $$;

alter table public.assistant_section_content
  add constraint assistant_section_content_section_key_check
  check (section_key in ('proyectos', 'servicio_tecnico', 'empresa'));

insert into public.assistant_section_content (section_key, country, opening_text, knowledge_text)
values
  (
    'empresa',
    'CL',
    'InterWins es una empresa que diseña e implementa soluciones para operaciones críticas, orientadas a impactar positivamente la continuidad operativa, la seguridad en terreno y la eficiencia productiva de sus clientes.

En Chile, acompañamos a empresas con soluciones de radiocomunicación profesional, conectividad, soporte técnico y proyectos tecnológicos especializados.',
    'Diseñamos e implementamos soluciones para mejorar la operación de nuestros clientes.
Nos enfocamos en soluciones para operaciones críticas que aumentan la seguridad de las personas y maximizan la eficiencia productiva.
InterWins puede apoyar con radiocomunicación profesional, conectividad empresarial, infraestructura de telecomunicaciones, automatización, ciberseguridad y redes IP según el contexto del proyecto.
También orientamos requerimientos vinculados a compra, arriendo, proyectos, servicio técnico y puntos de venta.'
  ),
  (
    'empresa',
    'UY',
    'InterWins es una empresa que diseña e implementa soluciones para operaciones críticas, orientadas a impactar positivamente la continuidad operativa, la seguridad en terreno y la eficiencia productiva de sus clientes.

En Uruguay, también orientamos soluciones de conectividad y proyectos empresariales especializados.',
    'Diseñamos e implementamos soluciones para mejorar la operación de nuestros clientes.
Nos enfocamos en soluciones para operaciones críticas que aumentan la seguridad de las personas y maximizan la eficiencia productiva.
InterWins puede apoyar con radiocomunicación profesional, conectividad empresarial, infraestructura de telecomunicaciones, automatización, ciberseguridad y redes IP según el contexto del proyecto.
También orientamos requerimientos vinculados a compra, proyectos, servicio técnico y soluciones Cambium.'
  )
on conflict (section_key, country) do update
set opening_text = excluded.opening_text,
    knowledge_text = excluded.knowledge_text,
    updated_at = now();
