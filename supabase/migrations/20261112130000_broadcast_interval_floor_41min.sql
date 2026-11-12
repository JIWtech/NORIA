-- Proteção do número: intervalo mínimo de 41 minutos entre mensagens de disparo.
--
-- APLICADA em produção em 12/11/2026 (nome da migração: broadcast_interval_floor_41min), com autorização do responsável.
-- Rollback: reaplicar a definição de broadcast_protection_settings da migração 20261109193722_broadcast_opt_out_detection.sql.
--
-- Motivo: disparos em cadência curta (padrão anterior: 30 a 90 segundos) elevam o risco de bloqueio do número no WhatsApp.
-- O piso passa a ser 2.460 s (41 min) e o intervalo máximo padrão 3.300 s (55 min). Ninguém consegue configurar abaixo disso:
-- o worker do servidor (broadcast_schedule_next) usa sempre estes valores. O limite diário padrão cai para 30 mensagens,
-- compatível com a cadência (cerca de 26 a 35 envios por dia no máximo). Tenants que já têm valores em
-- tenant_settings.settings.broadcast continuam limitados pelo piso, nunca abaixo dele.
begin;

create or replace function public.broadcast_protection_settings(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw jsonb;
  v_timezone text;
  v_min integer;
  v_max integer;
  v_daily integer;
  v_campaign integer;
  v_failures integer;
  v_window integer;
  v_num_pattern constant text := '^\d+(\.\d+)?$';
begin
  select coalesce(ts.settings -> 'broadcast', '{}'::jsonb), nullif(trim(ts.timezone), '')
  into v_raw, v_timezone
  from public.tenant_settings ts where ts.tenant_id = p_tenant_id;
  v_raw := coalesce(v_raw, '{}'::jsonb);

  v_min := case when (v_raw ->> 'min_interval_seconds') ~ v_num_pattern then floor((v_raw ->> 'min_interval_seconds')::numeric) end;
  v_max := case when (v_raw ->> 'max_interval_seconds') ~ v_num_pattern then floor((v_raw ->> 'max_interval_seconds')::numeric) end;
  v_daily := case when (v_raw ->> 'daily_limit') ~ v_num_pattern then floor((v_raw ->> 'daily_limit')::numeric) end;
  v_campaign := case when (v_raw ->> 'campaign_limit') ~ v_num_pattern then floor((v_raw ->> 'campaign_limit')::numeric) end;
  v_failures := case when (v_raw ->> 'max_consecutive_failures') ~ v_num_pattern then floor((v_raw ->> 'max_consecutive_failures')::numeric) end;
  v_window := case when (v_raw ->> 'opt_out_window_days') ~ v_num_pattern then floor((v_raw ->> 'opt_out_window_days')::numeric) end;

  -- Padrões conservadores e pisos de segurança (intervalo mínimo de 41 minutos).
  v_min := least(greatest(coalesce(v_min, 2460), 2460), 3600);
  v_max := least(greatest(coalesce(v_max, greatest(v_min, 3300)), v_min), 7200);
  v_daily := least(greatest(coalesce(v_daily, 30), 1), 5000);
  v_campaign := least(greatest(coalesce(v_campaign, 500), 1), 5000);
  v_failures := least(greatest(coalesce(v_failures, 5), 1), 50);
  v_window := least(greatest(coalesce(v_window, 7), 1), 60);

  return jsonb_build_object(
    'min_interval_seconds', v_min,
    'max_interval_seconds', v_max,
    'daily_limit', v_daily,
    'campaign_limit', v_campaign,
    'max_consecutive_failures', v_failures,
    'opt_out_window_days', v_window,
    'timezone', coalesce(v_timezone, 'America/Sao_Paulo')
  );
end $$;

revoke all on function public.broadcast_protection_settings(uuid) from public, anon, authenticated;
grant execute on function public.broadcast_protection_settings(uuid) to service_role;

commit;
