create table if not exists public.assistant_section_content (
  id bigint generated always as identity primary key,
  section_key text not null check (section_key in ('proyectos', 'servicio_tecnico')),
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
