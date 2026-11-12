-- Encerrar o atendimento cria a fronteira da conversa, sem fechar a venda.
-- Mantém o contrato do trigger para atribuição, resposta manual, fila e retomada.
begin;

CREATE OR REPLACE FUNCTION public.magia_sales_human_control()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare cfg jsonb; target text; session text; lead_id uuid; current_stage text;
begin
  if coalesce(new.ai_provider,'')='sales_operator' or new.direction is distinct from 'outbound'
    or coalesce(new.service,'') not in ('conversation_assigned','manual_reply','handoff_requested','resume_ai')
    then return new; end if;
  select settings into cfg from public.tenant_settings where tenant_id=new.tenant_id;
  if cfg->>'conversation_capability' is distinct from 'sales_v1' then return new; end if;
  target := cfg->'sales'->'stage_keys'->>(case when new.service='resume_ai' then 'qualifying' else 'human' end);
  perform 1 from public.conversation_turn_queue where tenant_id=new.tenant_id
    and channel_type=new.channel_type and chat_id=new.external_conversation_id for update;
  select coalesce((select id::text from public.channel_events where tenant_id=new.tenant_id
    and channel_type=new.channel_type and external_conversation_id=new.external_conversation_id
    and id<>new.id and (service='conversation_closed' or ai_provider in ('conversation_closed','conversation_reset'))
    order by created_at desc,id desc limit 1),'initial') into session;
  select id, stage_key into lead_id, current_stage from public.sales_leads where tenant_id=new.tenant_id
    and channel_type=new.channel_type and chat_id=new.external_conversation_id and session_id=session
    order by created_at desc limit 1 for update;
  if lead_id is null then return new; end if;
  -- Um operador pode assumir uma conversa sem tirar o lead da etapa comercial
  -- que já exige atendimento humano, como financiamento ou avaliação.
  if new.service in ('conversation_assigned','manual_reply','handoff_requested')
    and current_stage is not null
    and (cfg->'sales'->'stages') ? current_stage
    and coalesce((cfg->'sales'->'stages'->current_stage->>'allow_ai')::boolean,false)=false
    and coalesce((cfg->'sales'->'stages'->current_stage->>'closed')::boolean,false)=false then
    target := current_stage;
  end if;
  update public.sales_leads set ai_locked=new.service<>'resume_ai',stage_key=target,
    revision=revision+1,updated_at=now()
  where id=lead_id;
  return new;
end $function$;

commit;
