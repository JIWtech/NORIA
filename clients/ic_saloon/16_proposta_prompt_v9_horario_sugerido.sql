-- PROPOSTA (não aplicada): prompt v9 do I&C Salon — como responder quando a cliente sugere dia e horário.
-- Aplicar somente com autorização explícita do responsável. Rollback: 16_proposta_prompt_v9_horario_sugerido_rollback.sql.
-- Só aplica sobre o v8 (ic_salon_recepcao_v8_saudacao); se o trecho exato não existir, nada é alterado.
--
-- Caso real de 12/11/2026: a cliente disse "pode ser sábado às 9" e a IA inventou que "o horário das 9h é um pouquinho puxado"
-- (a IA não vê a agenda); em "As 10?" o rascunho deu o pedido por combinado, o revisor rejeitou duas vezes (claims_booking) e a
-- conversa caiu em "vou pedir para a equipe conferir esse ponto". O prompt não dizia o que fazer nesse momento.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(s.settings->>'system_prompt',
        '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.',
        '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.' || E'\n' ||
        '- Quando a cliente sugerir um dia e um horário, não diga que está combinado, marcado, livre, ocupado ou “puxado”, e não comente como está a agenda: você não a vê. Agradeça, diga que a equipe confirma o horário e faça uma pergunta com o próximo dado que falta (nome completo com sobrenome e, depois, se é a primeira vez no salão).'),
    'prompt_revision', 'ic_salon_recepcao_v9_horario_sugerido'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v8_saudacao'
  and strpos(s.settings->>'system_prompt', '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.') > 0;

commit;
