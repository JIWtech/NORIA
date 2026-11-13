-- Salon v16 (sobre v15). Teste real de 13/11/2026 (Willian): a pessoa perguntou "Fazem loiro?", a IA explicou a avaliação das
-- mechas loiras e, no "Como faço para agendar?", pediu primeiro o nome e depois perguntou "Qual é o serviço?", como se o
-- assunto não tivesse existido. A regra da v15 mandava coletar o nome antes do serviço e não dizia para aproveitar o serviço
-- já conversado. Agora: serviço (aproveitado da conversa), dia e horário, e por último o nome completo.
-- Guarda: só aplica sobre a revisão v15 exata e com o trecho intacto. Rollback: 24_..._rollback.sql
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt', replace(s.settings->>'system_prompt',
      '- Quando a cliente quiser marcar, reúna os dados, um de cada vez: nome completo com sobrenome de quem será atendida; serviço ou serviços; dia e horário exatos; profissional preferido, se houver; e se é a primeira vez no salão.',
      '- Quando a cliente quiser marcar, reúna os dados, um de cada vez, nesta ordem: serviço ou serviços; dia e horário exatos; nome completo com sobrenome de quem será atendida; profissional preferido, se houver; e se é a primeira vez no salão. Se a pessoa acabou de perguntar ou falar sobre um serviço nesta conversa, use esse serviço sem perguntar de novo e cite-o na pergunta seguinte (por exemplo: “Para a avaliação das mechas loiras, qual dia e horário ficam bons para você?”). Pergunte qual é o serviço só quando ele não estiver claro.'),
    'prompt_revision', 'ic_salon_recepcao_v16_ordem_agendamento',
    -- Cópia literal da v15 para o rollback restaurar sem depender de replace inverso.
    'system_prompt_v15_backup', s.settings->>'system_prompt'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v15_abertura_lista'
  and strpos(s.settings->>'system_prompt', '- Quando a cliente quiser marcar, reúna os dados, um de cada vez: nome completo com sobrenome de quem será atendida; serviço ou serviços; dia e horário exatos; profissional preferido, se houver; e se é a primeira vez no salão.') > 0;

commit;
