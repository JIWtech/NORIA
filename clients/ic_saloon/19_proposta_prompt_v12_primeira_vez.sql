-- Salon v12 (sobre v11). Ajustes da conversa de teste de 12/11/2026 (João, mãe e namorada):
-- 1) primeira_vez só entra na tag quando a cliente respondeu sobre a pessoa atendida;
-- 2) "quais outros serviços?": resposta curta, até dois serviços que combinem e oferta do catálogo completo;
-- 3) depois de escolher o serviço, a IA segue para o próximo dado do agendamento em vez de encerrar;
-- 4) desistência de um pedido ainda não confirmado usa CANCELAR_PEDIDO (o motor grava o cancelamento).
-- Aplica somente sobre v11 e somente se todos os trechos esperados estiverem intactos. Rollback: 19_..._rollback.sql
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
    replace(replace(replace(replace(s.settings->>'system_prompt',
      'O sistema escreve a confirmação de recebimento para a cliente.',
      'O sistema escreve a confirmação de recebimento para a cliente. Preencha primeira_vez somente se a cliente respondeu, com palavras dela, se a pessoa atendida neste pedido já foi ao salão; sem resposta explícita, omita o campo. Nunca presuma e nunca reaproveite a resposta dada para outra pessoa.'),
      '- Não envie o catálogo completo logo de cara. Só liste todos os serviços se ela pedir.',
      '- Não envie o catálogo completo logo de cara. Se a pessoa perguntar que outros serviços o salão faz, responda em uma ou duas frases curtas: diga que sim, cite no máximo dois serviços do catálogo que combinem com o que ela está buscando (por exemplo, para unha, os cuidados com os pés) e pergunte se ela quer ver o catálogo completo. Nunca liste vários serviços em texto corrido. Se ela pedir para ver o catálogo, use [CATALOGO_COMPLETO] (ou [CATALOGO_COMPLETO_COM_PRECOS], se pediu preços). Se houver um agendamento sendo combinado, depois de responder retome com uma pergunta curta para seguir com ele.'),
      'Não informe valor nem duração se a pessoa não perguntou.',
      'Não informe valor nem duração se a pessoa não perguntou. Depois que ela escolher, siga com uma pergunta curta pelo próximo dado que falta para marcar (para quem é, dia e horário ou nome completo); não encerre a conversa sem esse próximo passo.'),
      '- Se a cliente quiser mudar ou desistir de um pedido já enviado, ou mudar ou cancelar um agendamento confirmado, diga que a equipe vai ajustar com ela por aqui e termine com [HUMANO_SOLICITADO].',
      '- Se a cliente desistir de um pedido_pendente (ainda não confirmado pela equipe), diga com as suas palavras que retirou o pedido daquela pessoa e use [ACAO: CANCELAR_PEDIDO|pedido=ID do pedido]. Se ela quiser mudar um pedido já enviado, ou mudar ou cancelar um agendamento confirmado, diga que a equipe vai ajustar com ela por aqui e termine com [HUMANO_SOLICITADO].'),
    'prompt_revision', 'ic_salon_recepcao_v12_servicos_curtos_cancelamento',
    -- Cópia literal da v11 para o rollback restaurar sem depender de replace inverso.
    'system_prompt_v11_backup', s.settings->>'system_prompt'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v11_interlocutor_destinatario'
  and strpos(s.settings->>'system_prompt', 'O sistema escreve a confirmação de recebimento para a cliente.') > 0
  and strpos(s.settings->>'system_prompt', '- Não envie o catálogo completo logo de cara. Só liste todos os serviços se ela pedir.') > 0
  and strpos(s.settings->>'system_prompt', 'Não informe valor nem duração se a pessoa não perguntou.') > 0
  and strpos(s.settings->>'system_prompt', '- Se a cliente quiser mudar ou desistir de um pedido já enviado, ou mudar ou cancelar um agendamento confirmado, diga que a equipe vai ajustar com ela por aqui e termine com [HUMANO_SOLICITADO].') > 0;

commit;
