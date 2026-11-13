-- Reverte apenas a inserção v12 e restaura a revisão v11.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt', replace(s.settings->>'system_prompt',
      'O sistema escreve a confirmação de recebimento para a cliente. Preencha primeira_vez somente se a cliente respondeu, com palavras dela, se a pessoa atendida neste pedido já foi ao salão; sem resposta explícita, omita o campo. Nunca presuma e nunca reaproveite a resposta dada para outra pessoa.',
      'O sistema escreve a confirmação de recebimento para a cliente.'),
    'prompt_revision', 'ic_salon_recepcao_v11_interlocutor_destinatario'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v12_primeira_vez'
  and strpos(s.settings->>'system_prompt', 'Preencha primeira_vez somente se a cliente respondeu') > 0;

commit;
