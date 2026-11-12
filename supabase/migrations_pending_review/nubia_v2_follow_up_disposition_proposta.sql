-- PROPOSTA PARA REVISAO. NAO APLICAR sem autorizacao explicita do responsavel.
-- Somente dados de tenant_settings.settings (sem DDL, sem alteracao de schema), escopo estrito:
-- tenant clinica_nubia_oficial (id 563a93cd-a5c1-4412-a65f-be2e2d41bb88 E slug). Preserva todas as outras chaves
-- (jsonb_set / merge). Nao contem a chave Pix nem qualquer segredo.
--
-- O que esta proposta grava, e de onde vem cada item:
--
-- 1) settings.commercial_follow_up.disposition_actions = {"declined":"cancel","closed_by_customer":"cancel"}
--    Espelha o comportamento da v1 (CORE n8n/sources/noria_core.js, scheduleFollowUps ~linha 3511-3515):
--    para tenant sem vendas, a disposicao validada pelo CORE em {closed, declined, deferred}
--    (groundingCustomerDisposition, ~linha 4132) cancela os follow-ups pendentes
--    (cancelPendingFollowUps, ~linha 3494); qualquer outra disposicao ('active') nao cancela nada.
--    Mapeamento para o vocabulario da EXT v2 (DISPOSITIONS em n8n/sources/nubia_extension.js):
--      closed   -> closed_by_customer : cancel
--      declined -> declined           : cancel
--      deferred -> SEM EQUIVALENTE: a EXT v2 da Nubia nao tem a disposicao "deferred". Na v2, um "depois eu vejo"
--                  e tratado como 'active' (follow-up segue). PERGUNTA EM ABERTO para o responsavel.
--      active, resolved -> nao configurados (a EXT devolve DISPOSITION_ACTION_NOT_CONFIGURED = nada muda),
--                  como na v1, que nao cancela nesses casos. Handoff ja impede novos follow-ups no CORE.
--    A politica de follow-up em si (public.follow_up_policies, 1 politica ativa de whatsapp) NAO e alterada.
--
-- 2) settings.approved_messages.blocks.regras_agendamento.topics = ["payment_terms"]
--    Chave de vinculo (decisao Q2): a EXT v2 le blocks.<chave>.topics e apresenta o bloco quando o topico
--    informado pelo cliente esta na lista. O nome do bloco nao vive no codigo. Tambem e inofensivo para a v1
--    (groundingApprovedView ignora chaves desconhecidas do bloco).
--
-- 3) settings.business_facts.fee_rules.after_17h_sundays_holidays = {"after_time":"17:00","weekdays":[0],"holiday_dates":[]}
--    Regra da taxa business_facts.fees.after_17h_sundays_holidays (decisao Q6): vale para horario ESTRITAMENTE
--    depois de after_time e para os dias da semana listados (0 = domingo). holiday_dates fica vazio: feriados so
--    entram se cadastrados (o prompt diz "sem presumir feriados nao cadastrados"). PERGUNTA EM ABERTO: um inicio
--    exatamente as 17:00 tem a taxa? Esta proposta assume que NAO ("apos as 17h").
--
-- 4) settings.approved_messages.revision: 'nb-texts-v1' -> 'nb-texts-v2' (Q7). O padrao do CORE v1
--    (^nb-texts-v[1-9]\d*) continua valido.
--
-- Guardas: so aplica se a revisao atual for nb-texts-v1, commercial_follow_up e fee_rules ainda nao existirem e o
-- bloco regras_agendamento existir; caso contrario aborta sem alterar nada.

begin;
do $nubia_v2_follow_up$
declare
  affected integer;
begin
  update public.tenant_settings s
  set settings = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          s.settings,
          '{commercial_follow_up}',
          jsonb_build_object('disposition_actions',
            jsonb_build_object('declined', 'cancel', 'closed_by_customer', 'cancel'))
        ),
        '{approved_messages,blocks,regras_agendamento,topics}',
        '["payment_terms"]'::jsonb
      ),
      '{business_facts,fee_rules}',
      jsonb_build_object('after_17h_sundays_holidays',
        jsonb_build_object('after_time', '17:00', 'weekdays', jsonb_build_array(0), 'holiday_dates', jsonb_build_array()))
    ),
    '{approved_messages,revision}',
    to_jsonb('nb-texts-v2'::text)
  )
  from public.tenants t
  where t.id = s.tenant_id
    and t.id = '563a93cd-a5c1-4412-a65f-be2e2d41bb88'::uuid
    and t.slug = 'clinica_nubia_oficial'
    and s.settings->'approved_messages'->>'revision' = 'nb-texts-v1'
    and not (s.settings ? 'commercial_follow_up')
    and not (coalesce(s.settings->'business_facts', '{}'::jsonb) ? 'fee_rules')
    and jsonb_typeof(s.settings->'business_facts') = 'object'
    and s.settings->'approved_messages'->'blocks' ? 'regras_agendamento';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'NUBIA_V2_PROPOSAL_DRIFT_OR_SCOPE_MISMATCH';
  end if;
end $nubia_v2_follow_up$;
commit;

-- ROLLBACK EXATO (executar somente se esta proposta tiver sido aplicada). Restaura o estado anterior verificado em
-- leitura de producao: commercial_follow_up e fee_rules ausentes, bloco sem "topics", revisao nb-texts-v1.
--
-- begin;
-- do $nubia_v2_follow_up_rollback$
-- declare affected integer;
-- begin
--   update public.tenant_settings s
--   set settings = jsonb_set(
--     ((s.settings - 'commercial_follow_up')
--       #- '{business_facts,fee_rules}')
--       #- '{approved_messages,blocks,regras_agendamento,topics}',
--     '{approved_messages,revision}',
--     to_jsonb('nb-texts-v1'::text))
--   from public.tenants t
--   where t.id = s.tenant_id
--     and t.id = '563a93cd-a5c1-4412-a65f-be2e2d41bb88'::uuid
--     and t.slug = 'clinica_nubia_oficial'
--     and s.settings->'approved_messages'->>'revision' = 'nb-texts-v2';
--   get diagnostics affected = row_count;
--   if affected <> 1 then raise exception 'NUBIA_V2_ROLLBACK_SCOPE_MISMATCH'; end if;
-- end $nubia_v2_follow_up_rollback$;
-- commit;
