-- Gênesis 23-27/10: avisos automáticos de banco/fintech vindos de telefone fixo receberam resposta da IA e follow-ups,
-- porque o fato autenticado business_account só considerava isBusiness/isEnterprise do provedor.
-- Muda apenas magia_attest_turn_ingress: telefone fixo brasileiro da chave autenticada vira business_account=true.
-- Sem mudança de tabela. Rollback: ingress_landline_commercial_v1_rollback.sql. Teste: scripts/test_ingress_landline_commercial.cjs
CREATE OR REPLACE FUNCTION public.magia_attest_turn_ingress(p_source uuid, p_envelope jsonb, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare src public.conversation_turn_ingress_sources%rowtype; d jsonb; k jsonb; os boolean; ba boolean; phone text;
  prior public.conversation_turn_ingress_facts%rowtype;
begin
  select * into src from public.conversation_turn_ingress_sources where id=p_source and enabled
    and principal_id=auth.uid() for share;
  if not found then raise exception 'INGRESS_SOURCE_FORBIDDEN'; end if;
  d:=p_envelope->'data'; k:=coalesce(d->'key',d#>'{message,key}');
  if p_digest is null or p_digest!~'^[a-f0-9]{64}$' or p_envelope->>'instance' is distinct from src.instance_name
    or nullif(k->>'id','') is null or nullif(k->>'remoteJid','') is null or k->'fromMe' is null
    or k->'fromMe' not in ('true'::jsonb,'false'::jsonb)
    or not exists(select 1 from public.channels where tenant_id=src.tenant_id and type='whatsapp' and status='active'
      and (external_id=src.instance_name or config->>'instance_name'=src.instance_name)) then raise exception 'INGRESS_SCOPE_MISMATCH'; end if;
  -- Strict provider booleans, plus one technical fact from the authenticated key: a Brazilian landline
  -- (55 + DDD + 8 digits starting 2-5) only runs WhatsApp Business, so it is a business account.
  -- No contact_category/CORE flags/text heuristics.
  os:=case when d->'isMyContact' in ('true'::jsonb,'false'::jsonb) then (d->>'isMyContact')::boolean
    when d#>'{contact,isMyContact}' in ('true'::jsonb,'false'::jsonb) then (d#>>'{contact,isMyContact}')::boolean else null end;
  ba:=case when d->'isBusiness' in ('true'::jsonb,'false'::jsonb) then (d->>'isBusiness')::boolean
    when d->'isEnterprise' in ('true'::jsonb,'false'::jsonb) then (d->>'isEnterprise')::boolean else null end;
  phone:=case when k->>'remoteJid' ~ '^[1-9][0-9]{9,14}@s[.]whatsapp[.]net$' then k->>'remoteJid'
    when k->>'remoteJidAlt' ~ '^[1-9][0-9]{9,14}@s[.]whatsapp[.]net$' then k->>'remoteJidAlt' else null end;
  if split_part(phone,'@',1) ~ '^55[1-9][1-9][2-5][0-9]{7}$' then ba:=true; end if;
  insert into public.conversation_turn_ingress_facts(source_id,tenant_id,chat_id,instance_name,external_message_id,
    body_sha256,from_me,owner_saved,business_account,phone_jid)
    values(src.id,src.tenant_id,k->>'remoteJid',src.instance_name,k->>'id',p_digest,(k->>'fromMe')::boolean,os,ba,phone) on conflict do nothing;
  select * into prior from public.conversation_turn_ingress_facts where source_id=src.id and external_message_id=k->>'id';
  if prior.body_sha256 is distinct from p_digest or prior.chat_id is distinct from k->>'remoteJid' then
    raise exception 'INGRESS_REPLAY_MISMATCH'; end if;
  return jsonb_build_object('attested',true,'tenant_id',src.tenant_id);
end $function$;
