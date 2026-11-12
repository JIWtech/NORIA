-- Proposta do ic_salon. Aplicar somente após aceite de homologação.
-- A identidade autenticada da ponte deve ter raw_app_meta_data.noria_ic_salon_price_relay = true.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create schema if not exists noria_ic_salon;
revoke all on schema noria_ic_salon from public, anon, authenticated, service_role;

create table if not exists noria_ic_salon.price_rejections (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.conversation_turn_delivery_attempts(id) on delete cascade,
  expires_at timestamptz not null default (clock_timestamp() + interval '2 minutes')
);
alter table noria_ic_salon.price_rejections enable row level security;
revoke all on noria_ic_salon.price_rejections from public, anon, authenticated, service_role;

create or replace function public.ic_salon_issue_price_rejection(p_chat text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant constant uuid := '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
  v_attempt uuid;
  v_proof uuid;
begin
  if not exists (
    select 1 from auth.users
    where id = auth.uid() and raw_app_meta_data->'noria_ic_salon_price_relay' = 'true'::jsonb
  ) then
    raise exception 'IC_SALON_PRICE_RELAY_FORBIDDEN' using errcode = '42501';
  end if;

  select a.id into v_attempt
  from public.conversation_turn_queue q
  join public.conversation_turn_delivery_attempts a on a.id = q.current_delivery_id
    and a.tenant_id = q.tenant_id and a.channel_type = q.channel_type
    and a.chat_id = q.chat_id and a.turn_token = q.token
  where q.tenant_id = v_tenant and q.channel_type = 'whatsapp' and q.chat_id = p_chat
    and q.phase = 'sending' and q.lease_until > clock_timestamp()
    and a.status = 'attempting' and a.provider_message_id is null and a.outbound_event_id is null;

  if not found then return jsonb_build_object('issued', false); end if;

  delete from noria_ic_salon.price_rejections where expires_at <= clock_timestamp();
  insert into noria_ic_salon.price_rejections(attempt_id)
    values (v_attempt) returning id into v_proof;
  return jsonb_build_object('issued', true, 'message',
    'IC_SALON_PRICE_REJECTED:' || upper(replace(v_proof::text, '-', '')));
end
$$;

revoke all on function public.ic_salon_issue_price_rejection(text) from public, anon, authenticated, service_role;
grant execute on function public.ic_salon_issue_price_rejection(text) to authenticated;

create or replace function noria_ic_salon.finish_price_rejection()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_queue public.conversation_turn_queue%rowtype;
  v_proof uuid;
begin
  -- magia_fail_turn mantém o lock da fila ao atualizar a tentativa. Se outro
  -- chamador tiver atualizado a tentativa fora desse fluxo, não espere o lock.
  select * into v_queue from public.conversation_turn_queue
  where tenant_id = new.tenant_id and channel_type = new.channel_type and chat_id = new.chat_id
    and current_delivery_id = new.id and token = new.turn_token and phase = 'uncertain'
    and last_error_code = new.error_code
  for update skip locked;
  if not found then return null; end if;

  delete from noria_ic_salon.price_rejections
    where id = right(new.error_code, 32)::uuid and attempt_id = new.id
      and expires_at > clock_timestamp()
    returning id into v_proof;
  if not found then return null; end if;

  insert into public.conversation_turn_terminal_receipts(turn_token, tenant_id, chat_id, outcome, claimed, evidence)
    values (new.turn_token, new.tenant_id, new.chat_id, 'cancelled', v_queue.claimed,
      jsonb_build_object('kind', 'ic_salon_price_rejected_before_provider', 'delivery_attempt_id', new.id, 'proof_id', v_proof));

  update public.conversation_turn_delivery_attempts
    set status = 'superseded_uncertain', resolved_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = new.id;

  -- Consome só o lote recusado. Preserva mensagens pendentes e a janela de agrupamento.
  update public.conversation_turn_queue
    set claimed = '[]', token = null, lease_until = null, phase = 'ready', current_delivery_id = null,
      retry_batch_id = null, attempt_count = 0, retry_max_attempts = null, retry_base_seconds = null,
      retry_cap_seconds = null, next_attempt_at = null, last_error_code = null, review_required_at = null,
      updated_at = clock_timestamp()
    where tenant_id = new.tenant_id and channel_type = new.channel_type and chat_id = new.chat_id;

  return null;
end
$$;

revoke all on function noria_ic_salon.finish_price_rejection() from public, anon, authenticated, service_role;

drop trigger if exists ic_salon_price_rejection on public.conversation_turn_delivery_attempts;
create trigger ic_salon_price_rejection after update of status on public.conversation_turn_delivery_attempts
for each row when (
  new.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and old.status = 'attempting' and new.status = 'uncertain'
  and new.provider_message_id is null and new.outbound_event_id is null
  and new.error_code ~ '^SUPABASE_RAISED:IC_SALON_PRICE_REJECTED:[0-9A-F]{32}$'
)
execute function noria_ic_salon.finish_price_rejection();

commit;
