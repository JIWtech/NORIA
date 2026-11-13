-- PROPOSTA, NAO APLICADA. Exige autorização explícita antes de rodar em produção.
--
-- Vários pedidos pendentes na mesma conversa, um por pessoa atendida.
--
-- Problema (I&C Salon, 2026-11-12): o índice appointments_one_open_request_idx (migração 031) só admite um pedido
-- 'pending_confirmation' por conversa. Quando o mesmo contato pedia um serviço para outra pessoa (mãe e depois namorada),
-- a gravação do segundo pedido era recusada e a IA respondia como se houvesse registro.
--
-- Solução: o mesmo índice, com o mesmo nome (o motor reconhece o erro por ele), passa a incluir a pessoa atendida
-- (metadata.recipient_key, gravada pelo motor do Salon). Pedidos sem recipient_key (caminho legado e outros tenants)
-- usam '' e continuam com um pedido aberto por conversa, exatamente como antes.
--
-- A função magia_upsert_appointment_request precisa acompanhar o índice (ON CONFLICT infere o índice pela expressão).
-- Ela só filtra o pedido existente também por recipient_key; com recipient_key vazio o comportamento é o da 031.
--
-- Efeito colateral a conferir antes de aplicar: magia_cancel_appointment_request (031) e os comandos de confirmação
-- que escolhem o pedido só por conversa (sem id) continuam válidos para tenants legados; o Salon opera por id.
-- migrations_pending_review/slot_proposal_v1.sql bloqueia o aceite quando existe OUTRO pedido pendente na conversa
-- (SLOT_PROPOSAL_OPEN_REQUEST_EXISTS); com vários destinatários isso deve passar a considerar só a mesma pessoa.
--
-- Rollback: 20261113000000_appointment_requests_one_per_recipient_rollback.sql
begin;

drop index if exists public.appointments_one_open_request_idx;

create unique index appointments_one_open_request_idx
  on public.appointments (tenant_id, channel_type, external_conversation_id, (coalesce(metadata->>'recipient_key', '')))
  where status = 'pending_confirmation';

create or replace function public.magia_upsert_appointment_request(
  p_tenant uuid,
  p_channel text,
  p_chat text,
  p_contact text,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_details jsonb,
  p_request text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.appointments%rowtype;
  saved public.appointments%rowtype;
  stamp jsonb;
  recipient text := coalesce(p_details->>'recipient_key', '');
begin
  if p_tenant is null or nullif(btrim(coalesce(p_channel, '')), '') is null or nullif(btrim(coalesce(p_chat, '')), '') is null
    or nullif(btrim(coalesce(p_title, '')), '') is null or p_starts_at is null or nullif(btrim(coalesce(p_request, '')), '') is null
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'APPOINTMENT_REQUEST_INVALID';
  end if;

  select * into current_row from public.appointments
  where tenant_id = p_tenant and channel_type = p_channel and external_conversation_id = p_chat
    and status = 'pending_confirmation' and coalesce(metadata->>'recipient_key', '') = recipient
  for update;

  if found and current_row.metadata->>'request_key' = p_request then
    return jsonb_build_object('appointment', to_jsonb(current_row), 'created', false, 'already', true);
  end if;
  if found and current_row.metadata->>'confirmation_state' is not null then
    raise exception 'APPOINTMENT_REQUEST_BUSY';
  end if;
  if p_starts_at <= now() then raise exception 'APPOINTMENT_REQUEST_PAST'; end if;

  stamp := jsonb_build_object('source', 'ai_appointment_request', 'request_key', p_request,
    'request_version', coalesce((current_row.metadata->>'request_version')::integer, 0) + 1,
    'request_updated_at', now());

  insert into public.appointments as a(tenant_id, title, starts_at, ends_at, status, contact_name, channel_type,
    external_conversation_id, notes, metadata)
  values (p_tenant, p_title, p_starts_at, p_ends_at, 'pending_confirmation', p_contact, p_channel, p_chat,
    'Pedido registrado pela IA. Aguardando confirmação da equipe.', coalesce(p_details, '{}'::jsonb) || stamp)
  on conflict (tenant_id, channel_type, external_conversation_id, (coalesce(metadata->>'recipient_key', ''))) where status = 'pending_confirmation'
  do update set title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    contact_name = excluded.contact_name, metadata = a.metadata || excluded.metadata, updated_at = now()
  returning * into saved;

  return jsonb_build_object('appointment', to_jsonb(saved), 'created', (saved.metadata->>'request_version')::integer = 1, 'already', false);
end
$$;

commit;
