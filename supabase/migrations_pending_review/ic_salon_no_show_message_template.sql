-- Template da mensagem "cliente não veio" do I&C Salon (tenant ic_salon).
-- APLICADO em 11/11/2026. Só dados em tenant_settings.settings; nenhuma função ou tabela muda.
--
-- O painel abre a prévia editável depois de "Cliente não veio" quando:
--   * settings.appointment_outcome_tracking = true (já ligado no Salon pelo script 02);
--   * settings.payment.pix_key preenchido (este script NÃO cria a chave: o salão precisa informá-la);
--   * o agendamento tem conversa de WhatsApp.
-- Sem o template abaixo, o painel usa o padrão do código (DEFAULT_NO_SHOW_TEMPLATE em
-- app/src/services/appointments/noShowMessage.js). Placeholders: {nome} {servicos} {data} {hora}
-- {valor_sinal} {pix_key} {pix_holder}. {valor_sinal} é 50% do catálogo (tenant_service_catalog) e
-- já vem com "a partir de" quando algum serviço tem metadata.price_type = 'from'.
-- Reaplicável. Rollback: ic_salon_no_show_message_template_rollback.sql

begin;

do $$
declare
  v_tid uuid;
  v_template constant text := 'Olá, {nome}! Sentimos sua falta no horário de {data} às {hora} ({servicos}). '
    || 'Para agendar de novo, pedimos um sinal de 50% do valor do serviço: {valor_sinal}, pelo Pix {pix_key} ({pix_holder}). '
    || 'Depois é só enviar o comprovante por aqui e escolher o novo horário.';
begin
  select id into v_tid from public.tenants where slug = 'ic_salon';
  if v_tid is null then raise exception 'IC_SALON_TENANT_NOT_FOUND'; end if;

  update public.tenant_settings
  set settings = jsonb_set(
        coalesce(settings, '{}'::jsonb),
        '{appointment_outcome}',
        coalesce(settings->'appointment_outcome', '{}'::jsonb) || jsonb_build_object('no_show_message_template', v_template)),
      updated_at = now()
  where tenant_id = v_tid;
  if not found then raise exception 'IC_SALON_SETTINGS_NOT_FOUND'; end if;

  if nullif(btrim(coalesce((select settings->'payment'->>'pix_key' from public.tenant_settings where tenant_id = v_tid), '')), '') is null then
    raise notice 'IC_SALON sem settings.payment.pix_key: a prévia de falta continuará desligada até o salão informar a chave Pix.';
  end if;
end
$$;

commit;
