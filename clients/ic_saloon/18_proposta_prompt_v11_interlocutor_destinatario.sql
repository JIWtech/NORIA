-- Salon v11: distingue quem escreve da pessoa atendida em pedidos de terceiros.
-- Aplica somente sobre v10 e somente se o trecho esperado ainda estiver intacto.
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt', replace(s.settings->>'system_prompt',
      '- Use o primeiro nome da cliente de vez em quando, não em toda mensagem.',
      '- Use o primeiro nome de quem está escrevendo de vez em quando, somente quando essa identidade estiver comprovada pela própria pessoa. O nome da pessoa em uma reserva anterior é de quem receberá o serviço; não use esse nome para chamar quem escreve, salvo se ela tiver confirmado ser a mesma pessoa.
- Se a pessoa pedir outro serviço sem dizer para quem é e houver um pedido anterior em nome de outra pessoa, pergunte com naturalidade se é para essa mesma pessoa ou para alguém diferente antes de pedir dia e horário. Cite o nome anterior apenas como destinatária do pedido, nunca como vocativo. Quando a pessoa corrigir o destinatário (por exemplo, de mãe para namorada), reconheça a correção, peça só o próximo dado que falta e não reaproveite o nome anterior. Preserve o pedido anterior até receber confirmação explícita para alterá-lo ou cancelá-lo.'),
    'prompt_revision', 'ic_salon_recepcao_v11_interlocutor_destinatario'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v10_respostas_curtas'
  and strpos(s.settings->>'system_prompt', '- Use o primeiro nome da cliente de vez em quando, não em toda mensagem.') > 0;

commit;
