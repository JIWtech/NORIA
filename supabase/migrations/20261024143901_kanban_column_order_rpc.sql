-- Mesma RPC técnica da proposta 023, apenas service_role; sem alteração de identidade de colunas.
-- Versão confirmada no histórico remoto: 20261024143901. Validação corrigida para filtrar o quadro antes do FULL JOIN.
-- Persistência atômica da ordem visual do Kanban. A identidade da coluna
-- (id e automation_key) nunca é alterada por esta operação.
begin;

create or replace function public.reorder_kanban_columns(
  p_tenant_id uuid,
  p_board_id uuid,
  p_positions jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  expected_count integer;
  supplied_count integer;
begin
  if jsonb_typeof(p_positions) <> 'array' then
    raise exception 'p_positions must be an array';
  end if;

  select count(*) into expected_count
  from public.kanban_columns
  where tenant_id = p_tenant_id and board_id = p_board_id;

  select count(*) into supplied_count
  from jsonb_to_recordset(p_positions) as item(automation_key text, position integer);

  if expected_count = 0 or supplied_count <> expected_count then
    raise exception 'Kanban column set does not match board';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_positions) as item(automation_key text, position integer)
    where nullif(trim(automation_key), '') is null or position is null or position < 0
  ) or exists (
    select automation_key
    from jsonb_to_recordset(p_positions) as item(automation_key text, position integer)
    group by automation_key having count(*) > 1
  ) or exists (
    select position
    from jsonb_to_recordset(p_positions) as item(automation_key text, position integer)
    group by position having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_positions) as item(automation_key text, position integer)
    full join (select id,automation_key from public.kanban_columns
      where tenant_id = p_tenant_id and board_id = p_board_id) column_row
      on column_row.automation_key = item.automation_key
    where item.automation_key is null or column_row.id is null
  ) then
    raise exception 'Invalid Kanban column order';
  end if;

  if (select min(position) from jsonb_to_recordset(p_positions) as item(automation_key text, position integer)) <> 0
    or (select max(position) from jsonb_to_recordset(p_positions) as item(automation_key text, position integer)) <> expected_count - 1 then
    raise exception 'Kanban positions must be consecutive and start at zero';
  end if;

  update public.kanban_columns column_row
  set position = item.position,
      updated_at = now()
  from jsonb_to_recordset(p_positions) as item(automation_key text, position integer)
  where column_row.tenant_id = p_tenant_id
    and column_row.board_id = p_board_id
    and column_row.automation_key = item.automation_key;
end;
$$;

revoke all on function public.reorder_kanban_columns(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.reorder_kanban_columns(uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
