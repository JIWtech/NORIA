-- IA-16: o painel carregava só os 1.000 eventos mais recentes por tenant; conversas sem evento nessa janela
-- sumiam do painel. Esta função devolve o último evento de cada conversa, para o painel completar a janela.
-- SECURITY INVOKER: as políticas RLS de channel_events (membro do tenant) continuam valendo, sem atalho entre tenants.
-- Rollback: drop function public.conversation_latest_events(text, integer); drop index public.channel_events_conversation_latest_idx;

create index if not exists channel_events_conversation_latest_idx
  on public.channel_events (tenant_slug, channel_type, external_conversation_id, created_at desc);

create or replace function public.conversation_latest_events(p_tenant_slug text, p_limit integer default 500)
returns setof public.channel_events
language sql
stable
security invoker
set search_path = public
as $$
  select latest.*
  from (
    select distinct on (e.channel_type, e.external_conversation_id) e.*
    from public.channel_events e
    where e.tenant_slug = p_tenant_slug
      and e.external_conversation_id is not null
      -- Marcadores internos do painel não representam a conversa (o painel os ignora): ficam de fora.
      and coalesce(e.service, '') not in ('noria_pipeline_pin', 'kanban_move')
      and coalesce(e.ai_provider, '') <> 'kanban_action'
    order by e.channel_type, e.external_conversation_id, e.created_at desc, e.id desc
  ) latest
  order by latest.created_at desc, latest.id desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

revoke all on function public.conversation_latest_events(text, integer) from public, anon;
grant execute on function public.conversation_latest_events(text, integer) to authenticated;
