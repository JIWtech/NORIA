-- Migration 030: desfecho de agendamentos ("cliente compareceu" / "cliente não veio")
-- e lista de clientes com sinal obrigatório.
--
-- Regra de negócio (I&C Salon, aplicável a qualquer tenant que a use):
--   * o primeiro agendamento não tem sinal;
--   * quem faltou (no_show) passa a exigir sinal em novos agendamentos;
--   * comparecer depois (completed/done) volta ao normal.
--
-- Nada é criado com dados: a lista é DERIVADA dos agendamentos feitos no sistema,
-- então nenhum cliente anterior à ativação entra nela. Não altera linhas existentes.
-- Reaplicável (create or replace / if not exists).

begin;

create index if not exists appointments_outcome_lookup_idx
  on public.appointments (tenant_id, channel_type, external_conversation_id, starts_at desc)
  where status in ('no_show', 'completed', 'done');

-- Registra o desfecho de um agendamento. Para "não veio" em conversa de WhatsApp, encerra
-- o atendimento pelo mesmo caminho do botão "Encerrar" do painel (evento conversation_closed
-- gravado por magia_record_turn_control_event), com o motivo no raw_payload.
create or replace function public.magia_mark_appointment_outcome(
  p_appointment uuid,
  p_outcome text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.appointments%rowtype;
  v_actor text;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_closed boolean := false;
begin
  if auth.uid() is null then raise exception 'APPOINTMENT_OUTCOME_FORBIDDEN'; end if;
  if p_outcome is null or p_outcome not in ('no_show', 'attended') then raise exception 'APPOINTMENT_OUTCOME_INVALID'; end if;

  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  select coalesce(nullif(m.email, ''), auth.uid()::text) into v_actor
  from public.tenant_members m
  where m.tenant_id = a.tenant_id and m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner', 'admin', 'manager', 'operator', 'agent')
  limit 1;
  if v_actor is null then raise exception 'APPOINTMENT_OUTCOME_FORBIDDEN'; end if;

  v_status := case p_outcome when 'no_show' then 'no_show' else 'completed' end;
  if a.status = v_status or (p_outcome = 'attended' and a.status = 'done') then
    return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', a.status, 'already', true, 'closed_conversation', false);
  end if;

  -- Só agendamentos ainda abertos ou o desfecho oposto (correção de clique errado).
  if a.status not in ('scheduled', 'confirmed', 'pending_payment', 'payment_reported', 'reserved', 'no_show', 'completed', 'done') then
    raise exception 'APPOINTMENT_OUTCOME_INVALID_STATUS';
  end if;
  if a.starts_at > now() then raise exception 'APPOINTMENT_NOT_STARTED'; end if;

  update public.appointments
  set status = v_status,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('outcome', p_outcome, 'outcome_at', now(), 'outcome_by', v_actor)
        || case when v_note is null then '{}'::jsonb else jsonb_build_object('outcome_note', v_note) end
  where id = a.id;

  if p_outcome = 'no_show' and a.channel_type = 'whatsapp' and nullif(a.external_conversation_id, '') is not null then
    perform public.magia_record_turn_control_event(jsonb_build_object(
      'tenant_id', a.tenant_id,
      'channel_type', 'whatsapp',
      'direction', 'outbound',
      'sender_type', 'system',
      'external_conversation_id', a.external_conversation_id,
      'external_message_id', 'appointment_outcome_no_show_' || a.id::text,
      'command_id', 'appointment_outcome_no_show_' || a.id::text,
      'contact_name', a.contact_name,
      'message_text', 'Atendimento encerrado: cliente não veio',
      'service', 'conversation_closed',
      'stage', 'Finalizado',
      'handoff', false,
      'ai_provider', 'conversation_closed',
      'delivery_status', 'closed',
      'sent_by_user', v_actor,
      'raw_payload', jsonb_build_object(
        'command', 'appointment_outcome', 'close_reason', 'no_show',
        'appointment_id', a.id, 'closed_by', v_actor, 'note', v_note)
    ));
    v_closed := true;
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', v_status, 'already', false, 'closed_conversation', v_closed);
end
$$;

-- Contatos com sinal obrigatório: o desfecho MAIS RECENTE do contato é "não veio".
-- security invoker: a RLS de appointments limita ao que o usuário pode ver; o service_role
-- (CORE/n8n) enxerga o tenant informado.
create or replace function public.magia_deposit_required_contacts(p_tenant uuid)
returns table (channel_type text, external_conversation_id text, appointment_id uuid, last_no_show_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select l.channel_type, l.external_conversation_id, l.id, l.starts_at
  from (
    select distinct on (a.channel_type, a.external_conversation_id)
      a.channel_type, a.external_conversation_id, a.id, a.starts_at, a.status
    from public.appointments a
    where a.tenant_id = p_tenant
      and nullif(a.external_conversation_id, '') is not null
      and a.status in ('no_show', 'completed', 'done')
    order by a.channel_type, a.external_conversation_id, a.starts_at desc, a.created_at desc
  ) l
  where l.status = 'no_show';
$$;

revoke all on function public.magia_mark_appointment_outcome(uuid, text, text) from public, anon;
grant execute on function public.magia_mark_appointment_outcome(uuid, text, text) to authenticated;
revoke all on function public.magia_deposit_required_contacts(uuid) from public, anon;
grant execute on function public.magia_deposit_required_contacts(uuid) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
