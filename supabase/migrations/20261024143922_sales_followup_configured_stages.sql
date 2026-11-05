-- Elegibilidade segue etapas autorizadas no tenant e espera explícita pelo cliente.
-- Versão confirmada no histórico remoto: 20261024143922.
-- Não depende de percentuais ou nomes de regras comerciais. Mantém sessão, exclusão e controle humano.
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
  if anchor.raw_payload->>'follow_up_disposition' is distinct from 'awaiting_customer' then return false; end if;
  return true;
end $function$;

revoke all on function public.magia_sales_followup_eligible(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.magia_sales_followup_eligible(uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;

