-- PROPOSTA (não aplicada): prompt v10 do I&C Salon — responder só ao que foi dito, sem preço não pedido nem nome do salão.
-- Aplicar somente com autorização explícita do responsável. Rollback: 17_proposta_prompt_v10_respostas_curtas_rollback.sql.
-- Só aplica sobre o v9 (ic_salon_recepcao_v9_horario_sugerido); se algum trecho exato não existir, nada é alterado.
-- Cada versão SUBSTITUI o texto de system_prompt (nada acumula): só mudam os trechos exatos abaixo.
--
-- Caso real de 12/11/2026 ("Quero loiro e fazer as unhas da mão, ficar bem diva"): a resposta citou o nome do salão, deu o preço da
-- mão tradicional e a duração sem pedirem e ficou longa. Revisão da lógica do prompt:
-- 1. A regra de unhas dizia "antes de passar valor ou horário, pergunte...", o que lê como "o valor é o próximo passo".
-- 2. Já existia "Mensagens curtas, de uma a três frases" e o modelo não seguiu; em vez de criar outra regra igual (duplicada), esta
--    reescreve a existente: responde só ao que foi perguntado ou comentado, sem obrigar pergunta no fim, sem nome do salão.
-- 3. O v8 mandava "terminar com uma pergunta que leve ao agendamento" em toda resposta de interesse; passa a convidar só quando
--    fizer sentido. (A pergunta pelo dado que falta continua só quando há um pedido de agendamento em andamento.)
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(replace(replace(s.settings->>'system_prompt',
        '- Unhas: antes de passar valor ou horário, pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.',
        '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente. Não informe valor nem duração se a pessoa não perguntou.'),
        '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp. Faça uma pergunta por vez e nunca transforme a conversa em formulário.',
        '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp. Responda só ao que a pessoa perguntou ou comentou, sem informar o que ela não pediu (preço, duração, detalhes) e sem precisar terminar com pergunta. Quando precisar de um dado, faça uma pergunta por vez e nunca transforme a conversa em formulário. Não cite o nome do salão, não escreva “bem-vinda” nem “bem-vindo” e não elogie a escolha da pessoa de forma exagerada.'),
        'Depois convide para o próximo passo, como marcar a avaliação ou o horário. Responda ao que foi perguntado, sem despejar informações, e termine com uma pergunta que leve ao agendamento.',
        'Convide para o próximo passo, como marcar a avaliação ou o horário, só quando fizer sentido; se a pessoa apenas comentou ou fez uma pergunta simples, responda ao que foi dito e pare, sem despejar informações.'),
    'prompt_revision', 'ic_salon_recepcao_v10_respostas_curtas'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v9_horario_sugerido'
  and strpos(s.settings->>'system_prompt', '- Unhas: antes de passar valor ou horário, pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.') > 0
  and strpos(s.settings->>'system_prompt', '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp. Faça uma pergunta por vez e nunca transforme a conversa em formulário.') > 0
  and strpos(s.settings->>'system_prompt', 'Depois convide para o próximo passo, como marcar a avaliação ou o horário. Responda ao que foi perguntado, sem despejar informações, e termine com uma pergunta que leve ao agendamento.') > 0;

commit;
