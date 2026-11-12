-- PROPOSTA PARA REVISAO. NAO APLICAR sem autorizacao explicita do responsavel.
-- Retomada por IA no follow-up de VENDAS quando o cliente adia ("vou pensar", "depois eu vejo").
--
-- O que muda: magia_sales_followup_eligible (versao atual: 20261024143922_sales_followup_configured_stages.sql) passa a aceitar
-- ancora com follow_up_disposition = 'deferred_by_customer' SOMENTE quando a configuracao do tenant tiver
-- settings.sales_follow_up.disposition_actions.deferred_by_customer = 'resume'. Silencio ('awaiting_customer') segue igual.
-- Recusa, encerramento, resolvido e disposicao ausente continuam recusados. Todas as outras travas sao identicas
-- (exclusao de contato, controle humano, conversa fechada, etapa sem IA, lead travado, interesse registrado, sessao, mensagem posterior).
-- Sem a chave 'resume' o comportamento e o da funcao atual, por isso esta funcao pode entrar ANTES do workflow novo.
-- magia_validate_sales_followup (027) e o gatilho de insercao chamam esta funcao; nao mudam. Nao ha DDL de tabela.
--
-- Uma unica retomada: o RPC magia_schedule_followups cria todas as etapas da politica. O disparador grava a retomada da IA com
-- ai_provider = 'gemini_follow_up'; a trava existente "saida posterior que nao seja configured_follow_up" torna as etapas
-- seguintes inelegiveis (sem mudar schema nem o RPC). O prazo e o da primeira etapa porque ela vence primeiro.
--
-- Ordem de aplicacao sugerida (cada passo exige autorizacao):
--   1) este arquivo (funcao). Sem efeito enquanto nenhum tenant tiver 'resume'.
--   2) publicar os workflows regenerados (CORE + EXT Genesis + disparador).
--   3) bloco CONFIG-APPLY abaixo (liga o 'resume' para wesley_automoveis).
-- Rollback: bloco CONFIG-ROLLBACK (desliga a configuracao) e/ou bloco FUNCTION-ROLLBACK (restaura a funcao atual).
begin;

CREATE OR REPLACE FUNCTION public.magia_sales_followup_eligible(p_tenant uuid, p_chat text, p_anchor uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cfg jsonb; lead public.sales_leads%rowtype; anchor public.channel_events%rowtype;
  boundary text; exclusion jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Sales follow-up denied'; end if;
  select s.settings into cfg from public.tenant_settings s join public.tenants t on t.id=s.tenant_id
    where t.id=p_tenant and t.status='active' and t.deleted_at is null;
  if not found or cfg->>'conversation_capability' is distinct from 'sales_v1'
    or cfg->>'ai_enabled' is distinct from 'true' or cfg->>'follow_up_enabled' is distinct from 'true'
    or cfg#>>'{sales_follow_up,enabled}' is distinct from 'true'
    or cfg->>'contact_exclusion_enabled' is distinct from 'true' then return false; end if;
  exclusion:=public.magia_contact_exclusion_status(p_tenant,p_chat);
  if exclusion->>'blocked' is distinct from 'false' then return false; end if;
  select * into anchor from public.channel_events where id=p_anchor and tenant_id=p_tenant
    and channel_type='whatsapp' and external_conversation_id=p_chat;
  if not found or anchor.direction is distinct from 'outbound' or anchor.sender_type is distinct from 'assistant'
    or anchor.handoff is true or anchor.service is distinct from 'sales_qualification'
    or anchor.ai_provider is distinct from 'sales_core' then return false; end if;
  select coalesce((select e.id::text from public.channel_events e where e.tenant_id=p_tenant
    and e.channel_type='whatsapp' and e.external_conversation_id=p_chat
    and (e.service='conversation_closed' or e.ai_provider in ('conversation_closed','conversation_reset'))
    order by e.created_at desc,e.id desc limit 1),'initial') into boundary;
  select * into lead from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
    and chat_id=p_chat and session_id=boundary;
  if not found or lead.ai_locked is true or lead.interest_registered is true
    or lead.stage_key not in (coalesce(cfg#>>'{sales,stage_keys,initial}',''),coalesce(cfg#>>'{sales,stage_keys,qualifying}',''),
      coalesce(cfg#>>'{sales,stage_keys,warm}',''),
      coalesce(cfg#>>'{sales,stage_keys,cold}',''))
    or cfg#>>array['sales','stages',lead.stage_key,'allow_ai'] is distinct from 'true'
    or anchor.raw_payload->>'conversation_session_id' is distinct from boundary then return false; end if;
  if exists(select 1 from public.channel_events e where e.tenant_id=p_tenant and e.channel_type='whatsapp'
    and e.external_conversation_id=p_chat and (e.created_at,e.id)>(anchor.created_at,anchor.id)
    and ((e.direction='inbound' and e.sender_type='contact') or e.handoff is true
      or e.sender_type='human' or e.service in ('conversation_closed','conversation_assigned','resume_ai')
      or (e.direction='outbound' and e.ai_provider is distinct from 'configured_follow_up'))) then return false; end if;
  -- Espera do cliente (silencio) segue como antes. O adiamento so e aceito quando o tenant decidiu retomar:
  -- settings.sales_follow_up.disposition_actions.deferred_by_customer = 'resume'. Recusa, encerramento e resolvido continuam fora.
  if anchor.raw_payload->>'follow_up_disposition' is distinct from 'awaiting_customer'
    and not (anchor.raw_payload->>'follow_up_disposition' is not distinct from 'deferred_by_customer'
      and cfg#>>'{sales_follow_up,disposition_actions,deferred_by_customer}' is not distinct from 'resume') then return false; end if;
  return true;
end $function$;

revoke all on function public.magia_sales_followup_eligible(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.magia_sales_followup_eligible(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;

-- ============================================================================================================
-- ROLLBACK DA FUNCAO: restaura exatamente a definicao atual (20261024143922). Remova o prefixo "-- " para executar.
-- >>> FUNCTION-ROLLBACK
-- begin;
-- CREATE OR REPLACE FUNCTION public.magia_sales_followup_eligible(p_tenant uuid, p_chat text, p_anchor uuid)
--  RETURNS boolean
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- declare cfg jsonb; lead public.sales_leads%rowtype; anchor public.channel_events%rowtype;
--   boundary text; exclusion jsonb;
-- begin
--   if coalesce(auth.role(),'')<>'service_role' then raise exception 'Sales follow-up denied'; end if;
--   select s.settings into cfg from public.tenant_settings s join public.tenants t on t.id=s.tenant_id
--     where t.id=p_tenant and t.status='active' and t.deleted_at is null;
--   if not found or cfg->>'conversation_capability' is distinct from 'sales_v1'
--     or cfg->>'ai_enabled' is distinct from 'true' or cfg->>'follow_up_enabled' is distinct from 'true'
--     or cfg#>>'{sales_follow_up,enabled}' is distinct from 'true'
--     or cfg->>'contact_exclusion_enabled' is distinct from 'true' then return false; end if;
--   exclusion:=public.magia_contact_exclusion_status(p_tenant,p_chat);
--   if exclusion->>'blocked' is distinct from 'false' then return false; end if;
--   select * into anchor from public.channel_events where id=p_anchor and tenant_id=p_tenant
--     and channel_type='whatsapp' and external_conversation_id=p_chat;
--   if not found or anchor.direction is distinct from 'outbound' or anchor.sender_type is distinct from 'assistant'
--     or anchor.handoff is true or anchor.service is distinct from 'sales_qualification'
--     or anchor.ai_provider is distinct from 'sales_core' then return false; end if;
--   select coalesce((select e.id::text from public.channel_events e where e.tenant_id=p_tenant
--     and e.channel_type='whatsapp' and e.external_conversation_id=p_chat
--     and (e.service='conversation_closed' or e.ai_provider in ('conversation_closed','conversation_reset'))
--     order by e.created_at desc,e.id desc limit 1),'initial') into boundary;
--   select * into lead from public.sales_leads where tenant_id=p_tenant and channel_type='whatsapp'
--     and chat_id=p_chat and session_id=boundary;
--   if not found or lead.ai_locked is true or lead.interest_registered is true
--     or lead.stage_key not in (coalesce(cfg#>>'{sales,stage_keys,initial}',''),coalesce(cfg#>>'{sales,stage_keys,qualifying}',''),
--       coalesce(cfg#>>'{sales,stage_keys,warm}',''),
--       coalesce(cfg#>>'{sales,stage_keys,cold}',''))
--     or cfg#>>array['sales','stages',lead.stage_key,'allow_ai'] is distinct from 'true'
--     or anchor.raw_payload->>'conversation_session_id' is distinct from boundary then return false; end if;
--   if exists(select 1 from public.channel_events e where e.tenant_id=p_tenant and e.channel_type='whatsapp'
--     and e.external_conversation_id=p_chat and (e.created_at,e.id)>(anchor.created_at,anchor.id)
--     and ((e.direction='inbound' and e.sender_type='contact') or e.handoff is true
--       or e.sender_type='human' or e.service in ('conversation_closed','conversation_assigned','resume_ai')
--       or (e.direction='outbound' and e.ai_provider is distinct from 'configured_follow_up'))) then return false; end if;
--   if anchor.raw_payload->>'follow_up_disposition' is distinct from 'awaiting_customer' then return false; end if;
--   return true;
-- end $function$;
--
-- revoke all on function public.magia_sales_followup_eligible(uuid,text,uuid) from public,anon,authenticated;
-- grant execute on function public.magia_sales_followup_eligible(uuid,text,uuid) to service_role;
-- notify pgrst,'reload schema';
-- commit;
-- <<< FUNCTION-ROLLBACK

-- ============================================================================================================
-- CONFIGURACAO DO TENANT (aplicar somente com autorizacao, depois do passo 1 e 2). Remova o prefixo "-- " para executar.
-- Escopo: tenant com slug 'wesley_automoveis' (o id e resolvido pelo slug dentro do bloco e usado em todo UPDATE).
-- Grava apenas disposition_actions.deferred_by_customer = 'resume'; preserva as demais chaves; idempotente;
-- recusa se ja houver outra decisao (cancel/keep) para o adiamento.
-- >>> CONFIG-APPLY
-- begin;
-- do $$
-- declare tid uuid; cfg jsonb; current_action text;
-- begin
--   -- O id do tenant nao esta versionado: e resolvido pelo slug e toda escrita seguinte usa esse id.
--   select t.id, s.settings into strict tid, cfg
--     from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
--    where t.slug = 'wesley_automoveis' and t.status = 'active' and t.deleted_at is null
--      and s.settings->>'conversation_capability' = 'sales_v1';
--   if cfg#>>'{sales_follow_up,enabled}' is distinct from 'true' then
--     raise exception 'Follow-up de vendas nao esta habilitado para este tenant'; end if;
--   -- A funcao nova precisa estar aplicada antes: sem ela o banco recusaria a retomada.
--   if position('deferred_by_customer' in pg_get_functiondef('public.magia_sales_followup_eligible(uuid,text,uuid)'::regprocedure)) = 0 then
--     raise exception 'Aplicar primeiro a funcao magia_sales_followup_eligible desta proposta'; end if;
--   current_action := cfg#>>'{sales_follow_up,disposition_actions,deferred_by_customer}';
--   if current_action is not null and current_action <> 'resume' then
--     raise exception 'Ja existe decisao para o adiamento (%); nao sobrescrever', current_action; end if;
--   update public.tenant_settings
--      set settings = jsonb_set(settings, '{sales_follow_up,disposition_actions}',
--            coalesce(settings#>'{sales_follow_up,disposition_actions}', '{}'::jsonb) || jsonb_build_object('deferred_by_customer', 'resume'), true),
--          updated_at = now()
--    where tenant_id = tid;
-- end $$;
-- commit;
-- <<< CONFIG-APPLY

-- Rollback da configuracao: remove somente a chave gravada acima quando o valor e 'resume' (e o objeto disposition_actions
-- se ficar vazio). Nao toca em outras chaves nem em outro valor.
-- >>> CONFIG-ROLLBACK
-- begin;
-- do $$
-- declare tid uuid;
-- begin
--   select t.id into strict tid from public.tenants t join public.tenant_settings s on s.tenant_id = t.id
--    where t.slug = 'wesley_automoveis' and s.settings#>>'{sales_follow_up,disposition_actions,deferred_by_customer}' = 'resume';
--   update public.tenant_settings
--      set settings = case
--            when (settings#>'{sales_follow_up,disposition_actions}') - 'deferred_by_customer' = '{}'::jsonb
--              then settings #- '{sales_follow_up,disposition_actions}'
--            else settings #- '{sales_follow_up,disposition_actions,deferred_by_customer}' end,
--          updated_at = now()
--    where tenant_id = tid;
-- exception when no_data_found then
--   raise notice 'Nada a reverter: o adiamento nao esta configurado como resume';
-- end $$;
-- commit;
-- <<< CONFIG-ROLLBACK
