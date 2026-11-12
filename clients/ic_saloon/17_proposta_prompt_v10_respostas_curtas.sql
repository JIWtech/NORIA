-- PROPOSTA (não aplicada): prompt v10 do I&C Salon — respostas curtas, sem nome do salão e sem preço que ninguém pediu.
-- Aplicar somente com autorização explícita do responsável. Rollback: 17_proposta_prompt_v10_respostas_curtas_rollback.sql.
-- Só aplica sobre o v9 (ic_salon_recepcao_v9_horario_sugerido); se algum trecho exato não existir, nada é alterado.
--
-- Caso real de 12/11/2026 ("Quero loiro e fazer as unhas da mão, ficar bem diva"): a resposta citou o nome do salão, deu o preço da
-- mão tradicional e do tempo sem pedirem e ficou longa. Causa no prompt: a regra de unhas diz "antes de passar valor ou horário,
-- pergunte...", o que lê como "o valor é o próximo passo"; e não há limite de tamanho nem pedido para omitir o nome do salão
-- (o motor informa "Empresa: I&C Salon" ao modelo, que o repete). O código do adaptador também passou a barrar preço não pedido.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(replace(s.settings->>'system_prompt',
        '- Unhas: antes de passar valor ou horário, pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.',
        '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente. Não informe valor nem duração se a pessoa não perguntou.'),
        '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.',
        '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.' || E'\n' ||
        '- Mensagens curtas: no máximo três frases curtas, com uma pergunta no fim. Responda só ao que a pessoa disse. Não cite o nome do salão, não escreva “bem-vinda” nem “bem-vindo” e não elogie a escolha dela de forma exagerada. Não fale de preço, duração ou detalhes que ela não pediu.'),
    'prompt_revision', 'ic_salon_recepcao_v10_respostas_curtas'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v9_horario_sugerido'
  and strpos(s.settings->>'system_prompt', '- Unhas: antes de passar valor ou horário, pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.') > 0
  and strpos(s.settings->>'system_prompt', '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.') > 0;

commit;
