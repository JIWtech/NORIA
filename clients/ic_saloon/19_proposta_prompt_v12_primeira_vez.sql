-- PROPOSTA, NAO APLICADA. Salon v12: primeira_vez só entra na tag quando a cliente respondeu sobre a pessoa atendida.
-- O adaptador (first_visit_stated) e o motor já impedem a gravação sem resposta; este texto evita o preenchimento no prompt.
-- Aplica somente sobre v11 e somente se o trecho esperado ainda estiver intacto. Rollback: 19_..._rollback.sql
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt', replace(s.settings->>'system_prompt',
      'O sistema escreve a confirmação de recebimento para a cliente.',
      'O sistema escreve a confirmação de recebimento para a cliente. Preencha primeira_vez somente se a cliente respondeu, com palavras dela, se a pessoa atendida neste pedido já foi ao salão; sem resposta explícita, omita o campo. Nunca presuma e nunca reaproveite a resposta dada para outra pessoa.'),
    'prompt_revision', 'ic_salon_recepcao_v12_primeira_vez'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v11_interlocutor_destinatario'
  and strpos(s.settings->>'system_prompt', 'O sistema escreve a confirmação de recebimento para a cliente.') > 0;

commit;
