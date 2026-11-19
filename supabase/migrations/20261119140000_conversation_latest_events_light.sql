-- Painel lento em tenants com muitas conversas (NB Bronze, 19/11: lista de conversas com 1.041 linhas, 1,6 MB e
-- 2,8 s por recarga, em duas páginas que recalculavam tudo). Versão leve da função conversation_latest_events:
--   * janela por última atividade: p_since (só conversas com atividade a partir dela) e p_before (só as anteriores,
--     carregadas sob demanda quando a pessoa abre "conversas antigas");
--   * remove do raw_payload chaves de diagnóstico que o painel nunca lê e zera ai_usage.
-- SECURITY INVOKER: as políticas RLS de channel_events (membro do tenant) continuam valendo, sem atalho entre tenants.
-- A função original permanece (fallback do painel e rollback).
-- Rollback: drop function public.conversation_latest_events_light(text, integer, timestamptz, timestamptz);

create or replace function public.conversation_latest_events_light(
  p_tenant_slug text,
  p_limit integer default 500,
  p_since timestamptz default null,
  p_before timestamptz default null
)
returns setof public.channel_events
language sql
stable
security invoker
set search_path = public
as $$
  -- LATERAL: "(jsonb_populate_record(...)).*" executaria a função uma vez por coluna (2,8 s); assim, uma vez por linha.
  select trimmed.*
  from (
    select distinct on (e.channel_type, e.external_conversation_id) e.*
    from public.channel_events e
    where e.tenant_slug = p_tenant_slug
      and e.external_conversation_id is not null
      and coalesce(e.service, '') not in ('noria_pipeline_pin', 'kanban_move')
      and coalesce(e.ai_provider, '') <> 'kanban_action'
    order by e.channel_type, e.external_conversation_id, e.created_at desc, e.id desc
  ) latest
  cross join lateral jsonb_populate_record(null::public.channel_events,
    to_jsonb(latest) || jsonb_build_object(
      'raw_payload', coalesce(latest.raw_payload, '{}'::jsonb)
        - array['grounding', 'services_pipeline', 'core_revision', 'conversation_state', 'grouped_message_ids', 'catalog_lookup', 'source_media'],
      'ai_usage', null)) trimmed
  where (p_since is null or latest.created_at >= p_since)
    and (p_before is null or latest.created_at < p_before)
  order by latest.created_at desc, latest.id desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

revoke all on function public.conversation_latest_events_light(text, integer, timestamptz, timestamptz) from public, anon;
grant execute on function public.conversation_latest_events_light(text, integer, timestamptz, timestamptz) to authenticated;
