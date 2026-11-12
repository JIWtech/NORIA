-- Reverte 17_proposta_prompt_v10_respostas_curtas.sql (v10 -> v9). Só aplica sobre o v10.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(replace(s.settings->>'system_prompt',
        '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente. Não informe valor nem duração se a pessoa não perguntou.',
        '- Unhas: antes de passar valor ou horário, pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.'),
        E'\n' || '- Mensagens curtas: no máximo três frases curtas, com uma pergunta no fim. Responda só ao que a pessoa disse. Não cite o nome do salão, não escreva “bem-vinda” nem “bem-vindo” e não elogie a escolha dela de forma exagerada. Não fale de preço, duração ou detalhes que ela não pediu.',
        ''),
    'prompt_revision', 'ic_salon_recepcao_v9_horario_sugerido'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v10_respostas_curtas';

commit;
