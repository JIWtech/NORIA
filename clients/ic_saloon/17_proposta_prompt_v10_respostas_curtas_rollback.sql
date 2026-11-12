-- Reverte 17_proposta_prompt_v10_respostas_curtas.sql (v10 -> v9). Só aplica sobre o v10.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(replace(replace(s.settings->>'system_prompt',
        '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente. Não informe valor nem duração se a pessoa não perguntou.',
        '- Unhas: antes de passar valor ou horário, pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.'),
        '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp. Responda só ao que a pessoa perguntou ou comentou, sem informar o que ela não pediu (preço, duração, detalhes) e sem precisar terminar com pergunta. Quando precisar de um dado, faça uma pergunta por vez e nunca transforme a conversa em formulário. Não cite o nome do salão, não escreva “bem-vinda” nem “bem-vindo” e não elogie a escolha da pessoa de forma exagerada.',
        '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp. Faça uma pergunta por vez e nunca transforme a conversa em formulário.'),
        'Convide para o próximo passo, como marcar a avaliação ou o horário, só quando fizer sentido; se a pessoa apenas comentou ou fez uma pergunta simples, responda ao que foi dito e pare, sem despejar informações.',
        'Depois convide para o próximo passo, como marcar a avaliação ou o horário. Responda ao que foi perguntado, sem despejar informações, e termine com uma pergunta que leve ao agendamento.'),
    'prompt_revision', 'ic_salon_recepcao_v9_horario_sugerido'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v10_respostas_curtas';

commit;
