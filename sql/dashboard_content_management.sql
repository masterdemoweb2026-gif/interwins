create table if not exists public.assistant_section_content (
  id bigint generated always as identity primary key,
  section_key text not null check (section_key in ('proyectos', 'servicio_tecnico', 'empresa')),
  country text not null check (country in ('CL', 'UY')),
  opening_text text not null default '',
  knowledge_text text not null default '',
  updated_at timestamptz not null default now(),
  unique (section_key, country)
);

alter table public.proyectos
  add column if not exists country text not null default 'CL';

alter table public.proyectos
  add column if not exists created_at timestamptz not null default now();

alter table public.proyectos
  add column if not exists updated_at timestamptz not null default now();

create index if not exists proyectos_country_id_idx
  on public.proyectos (country, id);

insert into public.assistant_section_content (section_key, country, opening_text, knowledge_text)
values
  (
    'empresa',
    'CL',
    'InterWins es una empresa que diseña e implementa soluciones para operaciones críticas, orientadas a impactar positivamente la continuidad operativa, la seguridad en terreno y la eficiencia productiva de sus clientes.

En Chile, acompañamos a empresas con soluciones de radiocomunicación profesional, conectividad, soporte técnico y proyectos tecnológicos especializados.',
    'Somos una empresa que diseña e implementa soluciones para mejorar la operación de nuestros clientes.
Nos enfocamos en soluciones para operaciones críticas que aumentan la seguridad de las personas y maximizan la eficiencia productiva.
Podemos comunicar capacidades como radiocomunicación profesional, conectividad empresarial, infraestructura de telecomunicaciones, automatización, ciberseguridad y redes IP según el contexto comercial.
Si el cliente quiere avanzar, también se le puede orientar hacia compra, arriendo, proyectos, servicio técnico o puntos de venta.'
  ),
  (
    'empresa',
    'UY',
    'InterWins es una empresa que diseña e implementa soluciones para operaciones críticas, orientadas a impactar positivamente la continuidad operativa, la seguridad en terreno y la eficiencia productiva de sus clientes.

En Uruguay, también orientamos soluciones de conectividad y proyectos empresariales especializados.',
    'Somos una empresa que diseña e implementa soluciones para mejorar la operación de nuestros clientes.
Nos enfocamos en soluciones para operaciones críticas que aumentan la seguridad de las personas y maximizan la eficiencia productiva.
Podemos comunicar capacidades como radiocomunicación profesional, conectividad empresarial, infraestructura de telecomunicaciones, automatización, ciberseguridad y redes IP según el contexto comercial.
Si el cliente quiere avanzar, también se le puede orientar hacia compra, proyectos, servicio técnico o soluciones Cambium.'
  ),
  (
    'proyectos',
    'CL',
    'En Interwins diseñamos e implementamos proyectos tecnológicos bajo la metodología SOEM, respaldados por más de 50 implementaciones exitosas en Chile y Uruguay.

Nos especializamos en soluciones para operaciones críticas, ayudando a tu empresa a:

- Garantizar la continuidad operativa mediante contratos de soporte dedicados.
- Aumentar la seguridad de tu personal en terreno.
- Optimizar la eficiencia productiva de toda la organización.

¿Quieres implementar o mejorar tu sistema de comunicación?',
    ''
  ),
  (
    'proyectos',
    'UY',
    'En Interwins diseñamos e implementamos proyectos tecnológicos bajo la metodología SOEM, respaldados por más de 50 implementaciones exitosas en Chile y Uruguay.

Nos especializamos en soluciones para operaciones críticas, ayudando a tu empresa a:

- Garantizar la continuidad operativa mediante contratos de soporte dedicados.
- Aumentar la seguridad de tu personal en terreno.
- Optimizar la eficiencia productiva de toda la organización.

¿Quieres implementar o mejorar tu sistema de comunicación?',
    ''
  ),
  (
    'servicio_tecnico',
    'CL',
    '🛠️ Mantención preventiva
Optimice la durabilidad de sus equipos y mejore la comunicación mediante mantenimientos preventivos anuales que incluyen ajustes de frecuencia y sensibilidad.

🧰 Reparación (radios y equipos)
Recupere la funcionalidad de sus radios con repuestos y accesorios originales. Nuestros especialistas utilizan herramientas de vanguardia y tecnología Motorola en la reparación.

Si necesitas que te deriven:
📞 Mesa Central: +56 2 3263 5550
📞 SAM: +56 2 3263 5551

Si necesitas ayuda mas personalizada con tu caso, solo debes solicitar el servicio tecnico y te derivamos al formulario de contacto.',
    ''
  ),
  (
    'servicio_tecnico',
    'UY',
    '🔧 Servicio Técnico Autorizado Motorola
Contamos con un equipo profesional altamente capacitado y certificado para servicio técnico en Uruguay.

🛠️ Mantención preventiva
Optimice la durabilidad de sus equipos y mejore la comunicación mediante mantenimientos preventivos anuales que incluyen ajustes de frecuencia y sensibilidad.

🧰 Reparación (radios y equipos)
Recupere la funcionalidad de sus radios con repuestos y accesorios originales. Nuestros especialistas utilizan herramientas de vanguardia y tecnología Motorola en la reparación.

⚙️ Servicios adicionales
- Instalaciones de licencias
- Ajuste de parámetros
- Garantía Motorola Solutions

Si necesitas ayuda más personalizada en Uruguay, solicita el servicio técnico y te derivamos al formulario de contacto.',
    ''
  )
on conflict (section_key, country) do nothing;

create table if not exists public.assistant_service_knowledge (
  id bigint generated always as identity primary key,
  country text not null check (country in ('CL', 'UY')),
  tema text not null,
  palabras_clave text[] not null default '{}',
  informacion text not null default '',
  prioridad integer not null default 100,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_service_knowledge_country_priority_idx
  on public.assistant_service_knowledge (country, activo, prioridad, id);

insert into public.assistant_service_knowledge (country, tema, palabras_clave, informacion, prioridad, activo)
select
  'CL',
  coalesce(st.tema, 'Sin tema'),
  coalesce(st.palabras_clave, '{}'),
  coalesce(st.informacion, ''),
  100,
  true
from public.servicio_tecnico st
where coalesce(st.tema, '') <> ''
on conflict do nothing;
