-- I&C Salon: libera a conversa …5989, travada em "envio incerto" desde 09/11 09:40.
-- A Evolution recusou (400) uma resposta vazia: a mensagem NÃO saiu (tentativa sem id do provedor).
-- Reproduz o que magia_resolve_turn_review faz ao liberar a fila, só para esta conversa e este turno.
-- Aborta sem alterar nada se o estado não for exatamente o diagnosticado.
begin;
do $$
declare
  v_tenant uuid;
  q public.conversation_turn_queue%rowtype;
  v_attempt uuid;
  v_rows integer;
begin
  select id into v_tenant from public.tenants where slug = 'ic_salon';
  if v_tenant is null then raise exception 'TENANT_NAO_ENCONTRADO'; end if;

  select * into q from public.conversation_turn_queue
   where tenant_id = v_tenant and channel_type = 'whatsapp' and chat_id = '5521967095989@s.whatsapp.net'
   for update;
  if not found or q.phase <> 'uncertain' or q.token is distinct from '080ce1b7-5c25-482d-84ef-1970e99dcd79'::uuid then
    raise exception 'ESTADO_DIFERENTE_DO_DIAGNOSTICO: nada foi alterado';
  end if;

  -- A tentativa recusada: sem id do provedor = a mensagem não foi entregue.
  update public.conversation_turn_delivery_attempts
     set status = 'superseded_uncertain', error_code = 'PROVIDER_REJECTED_EMPTY_TEXT_400',
         resolved_at = clock_timestamp(), updated_at = clock_timestamp()
   where tenant_id = v_tenant and channel_type = 'whatsapp' and chat_id = q.chat_id
     and turn_token = q.token and status = 'uncertain' and provider_message_id is null
  returning id into v_attempt;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'TENTATIVA_NAO_CONFERE: nada foi alterado'; end if;

  -- Registro de fim do turno (mesma trilha de auditoria da revisão oficial).
  insert into public.conversation_turn_terminal_receipts (turn_token, tenant_id, chat_id, outcome, claimed, evidence)
  values (q.token, v_tenant, q.chat_id, 'cancelled', q.claimed, jsonb_build_object(
    'kind', 'operator_repair_provider_rejected', 'delivery_attempt_id', v_attempt,
    'provider_error', 'Request failed with status code 400', 'reason', 'empty reply text, nothing delivered',
    'repaired_at', clock_timestamp()));

  -- Fila livre com as mensagens pendentes preservadas; o gatilho resolve o alerta sozinho.
  update public.conversation_turn_queue
     set phase = 'ready', claimed = '[]'::jsonb, token = null, lease_until = null, current_delivery_id = null,
         retry_batch_id = null, attempt_count = 0, retry_max_attempts = null, retry_base_seconds = null,
         retry_cap_seconds = null, next_attempt_at = null, last_error_code = null, review_required_at = null,
         updated_at = clock_timestamp()
   where tenant_id = v_tenant and channel_type = 'whatsapp' and chat_id = q.chat_id and token = q.token;
end $$;
commit;

-- Conferência: fase "ready", alerta resolvido.
select q.phase, jsonb_array_length(q.pending) as pendentes,
       (select resolution from public.conversation_turn_review_tickets r
         where r.tenant_id = q.tenant_id and r.chat_id = q.chat_id order by r.created_at desc limit 1) as alerta
  from public.conversation_turn_queue q join public.tenants t on t.id = q.tenant_id
 where t.slug = 'ic_salon' and q.chat_id = '5521967095989@s.whatsapp.net';
