-- Reverte 16_proposta_prompt_v9_horario_sugerido.sql (v9 -> v8). Só aplica sobre o v9.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(s.settings->>'system_prompt',
        E'\n' || '- Quando a cliente sugerir um dia e um horário, não diga que está combinado, marcado, livre, ocupado ou “puxado”, e não comente como está a agenda: você não a vê. Agradeça, diga que a equipe confirma o horário e faça uma pergunta com o próximo dado que falta (nome completo com sobrenome e, depois, se é a primeira vez no salão).',
        ''),
    'prompt_revision', 'ic_salon_recepcao_v8_saudacao'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v9_horario_sugerido';

commit;
