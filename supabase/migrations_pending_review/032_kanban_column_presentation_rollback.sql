-- Rollback da migração 032. Antes, publique o painel anterior: o atual lê estes campos.
begin;

drop trigger if exists kanban_columns_apply_preset on public.kanban_columns;
drop function if exists public.magia_kanban_column_apply_preset();
drop table if exists public.kanban_column_presets;

alter table public.kanban_columns drop constraint if exists kanban_columns_icon_check;
alter table public.kanban_columns drop constraint if exists kanban_columns_tone_check;
alter table public.kanban_columns drop constraint if exists kanban_columns_owner_role_check;
alter table public.kanban_columns
  drop column if exists icon,
  drop column if exists tone,
  drop column if exists owner_role,
  drop column if exists short_label,
  drop column if exists description;

commit;

notify pgrst, 'reload schema';
