-- Dependências ausentes verificadas em 24/10. Autorização: corrigir, migrar e publicar.
-- Versão confirmada no histórico remoto: 20261024143850.
-- Não reaplica versões antigas do ciclo de turnos nem altera filas históricas.
begin;

do $$
begin
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='sales_leads' and c.relrowsecurity) then
    raise exception 'SALES_LEADS_RLS_REQUIRED';
  end if;
  alter table public.sales_leads replica identity full;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='sales_leads') then
    alter publication supabase_realtime add table public.sales_leads;
  end if;
end $$;

-- Só as disposições já descritas na proposta aprovada. Demais chaves são preservadas.
update public.tenant_settings ts
set settings=jsonb_set(ts.settings,'{sales_follow_up}',
  coalesce(ts.settings->'sales_follow_up','{}'::jsonb)
  || jsonb_build_object('disposition_actions',jsonb_build_object('declined','cancel','closed_by_customer','cancel')),true)
from public.tenants t
where t.id=ts.tenant_id and t.slug='wesley_automoveis'
  and not (coalesce(ts.settings->'sales_follow_up','{}'::jsonb) ? 'disposition_actions');

-- Rollback: remover apenas a associação recém-adicionada à publicação, restaurar replica identity
-- e disposition_actions ao snapshot pré-aplicação. Não remover RLS nem modificar filas.
commit;
