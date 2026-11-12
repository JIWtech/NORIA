-- Proposta de configuração do ic_salon. NÃO APLICADA. Aplicar somente após revisão e com autorização explícita.
--
-- Objetivo
-- 1. Mensagens de recuperação por cenário em settings.appointment_request. O motor isolado do Salon usa estes textos e,
--    na ausência deles, um padrão equivalente no código:
--    - conflict_existing_appointment_template: pedido no mesmo horário de uma reserva futura do contato (texto + revisão da equipe).
--      Placeholders: {nome}, {servicos}, {data} e {hora}, no formato do renderAppointmentRequest do motor
--      ({data} = dia da semana, dia e mês por extenso; {hora} = HH:mm).
--    - missing_details_template: dados do pedido inválidos ou no passado. Literal, sem placeholders.
--    - processing_error_template: falha técnica ou resposta segura inviável (texto + revisão da equipe). Literal, sem placeholders.
--    invalid_request_template deixa de ser usado pelo motor isolado do Salon. Fica no banco só por compatibilidade.
-- 2. Remove a contradição da proposta 10: ela mandava copiar o nome do título de uma reserva anterior sem confirmação,
--    enquanto o revisor do adaptador exige confirmação explícita para nome vindo de reserva anterior.
--    Se a proposta 10 ainda não foi aplicada, prefira corrigir o próprio arquivo 10 antes de aplicá-lo. A parte 2 cobre o
--    caso de a 10 já estar aplicada e é no-op quando o trecho antigo não existe.
--
-- Rollback (mesma transação):
--   update public.tenant_settings
--   set settings = settings #- '{appointment_request,conflict_existing_appointment_template}'
--                           #- '{appointment_request,missing_details_template}'
--                           #- '{appointment_request,processing_error_template}'
--                           #- '{appointment_request,name_confirmation_template}'
--                           #- '{appointment_request,review_handoff_template}',
--       updated_at = now()
--   where tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid;
--   Para a parte 2, aplicar o replace inverso (trocar novo_trecho por trecho_antigo, abaixo) em conversation_style_instructions.

begin;

-- Parte 1: cada chave é adicionada apenas se ausente; valores já configurados pelo tenant são preservados.
with defaults(settings) as (
  select jsonb_build_object(
    'conflict_existing_appointment_template',
      'Vi aqui que você já tem {servicos} marcado para {data}, às {hora}. Vou pedir para a equipe conferir esse horário com você por aqui.',
    'missing_details_template',
      'Para eu registrar seu pedido, me confirma o serviço, o dia e o horário exato que você prefere?',
    'processing_error_template',
      'Não consegui concluir isso por aqui agora. Vou pedir para a equipe conferir e continuar seu atendimento.',
    -- Pedido completo com nome vindo só de reserva anterior. Placeholder {nome}.
    'name_confirmation_template', 'Posso registrar esse pedido no nome {nome}?',
    -- Reprovação de conteúdo persistente (não técnica): vai à equipe sem a mensagem de erro.
    'review_handoff_template', 'Vou pedir para a equipe conferir esse ponto com você por aqui, tá bem?')
)
update public.tenant_settings s
-- O lado direito do || prevalece: valores existentes sobrescrevem os padrões.
set settings = jsonb_set(s.settings, '{appointment_request}', defaults.settings || (s.settings->'appointment_request')),
    updated_at = now()
from defaults
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->'appointment_request'->>'mode' = 'operator_confirmation'
  and not (s.settings->'appointment_request' ?& array['conflict_existing_appointment_template', 'missing_details_template', 'processing_error_template',
    'name_confirmation_template', 'review_handoff_template']);

-- Parte 2: troca o trecho da proposta 10 que dispensava a confirmação do nome da reserva anterior.
with patch(trecho_antigo, novo_trecho) as (
  values (
    $old$Antes de perguntar o nome, consulte AGENDAMENTOS CONHECIDOS PELO SISTEMA. Todos os registros dessa seção já são do mesmo contato no WhatsApp. Se a pessoa pede para si e o título de uma reserva confirmada ou de um pedido existente tiver o formato “serviço - nome completo”, com um único nome consistente e sem indicação de atendimento para terceiros, copie o nome após o hífen para o campo nome da tag. Esse nome já preenche o requisito de nome completo do pedido para si. Não peça confirmação desse dado nessas condições.$old$,
    $new$Antes de perguntar o nome, consulte AGENDAMENTOS CONHECIDOS PELO SISTEMA. Se o nome completo só aparece no título de uma reserva ou de um pedido anterior, não o copie direto para a tag: pergunte se o novo pedido pode ser registrado nesse nome, citando-o, e use-o somente depois da confirmação explícita da pessoa.$new$)
)
update public.tenant_settings s
set settings = jsonb_set(s.settings, '{conversation_style_instructions}',
      to_jsonb(replace(s.settings->>'conversation_style_instructions', patch.trecho_antigo, patch.novo_trecho))),
    updated_at = now()
from patch
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and strpos(coalesce(s.settings->>'conversation_style_instructions', ''), patch.trecho_antigo) > 0;

commit;
