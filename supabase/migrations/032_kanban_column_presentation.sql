-- Migration 032: símbolo, cor, papel e textos de cada coluna do Kanban ficam no Supabase, por tenant.
--
-- Antes, o painel decidia o símbolo e a cor por regras fixas sobre a chave e o título da coluna.
-- Agora cada linha de kanban_columns carrega a própria aparência; o painel só desenha.
--
--   * icon, tone e owner_role aceitam só valores conhecidos (o painel tem a mesma lista);
--   * kanban_column_presets guarda os padrões da plataforma por automation_key (dado, não código);
--   * o gatilho preenche, na inserção, os campos vazios a partir do preset; o que vier preenchido fica;
--   * a carga inicial reproduz exatamente o que o painel mostrava antes (conferido por teste).
--
-- Não altera nome, posição nem chave de nenhuma coluna. Reaplicável.
-- Rollback: supabase/migrations_pending_review/032_kanban_column_presentation_rollback.sql

begin;

alter table public.kanban_columns
  add column if not exists icon text,
  add column if not exists tone text,
  add column if not exists owner_role text,
  add column if not exists short_label text,
  add column if not exists description text;

alter table public.kanban_columns drop constraint if exists kanban_columns_icon_check;
alter table public.kanban_columns add constraint kanban_columns_icon_check check (icon is null or icon in (
  'bot', 'user-round', 'message-circle', 'clock', 'calendar-days', 'calendar-check', 'calendar-x',
  'circle-dollar', 'check-circle', 'sparkles', 'flame', 'car-front', 'wrench', 'inbox'));
alter table public.kanban_columns drop constraint if exists kanban_columns_tone_check;
alter table public.kanban_columns add constraint kanban_columns_tone_check check (tone is null or tone in (
  'blue', 'cyan', 'orange', 'yellow', 'violet', 'lime', 'pink', 'indigo', 'teal', 'green', 'red', 'slate'));
alter table public.kanban_columns drop constraint if exists kanban_columns_owner_role_check;
alter table public.kanban_columns add constraint kanban_columns_owner_role_check check (owner_role is null or owner_role in ('ai', 'human', 'neutral'));

create table if not exists public.kanban_column_presets (
  automation_key text primary key,
  icon text,
  tone text,
  owner_role text not null default 'neutral',
  short_label text,
  description text,
  constraint kanban_column_presets_icon_check check (icon is null or icon in (
    'bot', 'user-round', 'message-circle', 'clock', 'calendar-days', 'calendar-check', 'calendar-x',
    'circle-dollar', 'check-circle', 'sparkles', 'flame', 'car-front', 'wrench', 'inbox')),
  constraint kanban_column_presets_tone_check check (tone is null or tone in (
    'blue', 'cyan', 'orange', 'yellow', 'violet', 'lime', 'pink', 'indigo', 'teal', 'green', 'red', 'slate')),
  constraint kanban_column_presets_owner_role_check check (owner_role in ('ai', 'human', 'neutral'))
);
alter table public.kanban_column_presets enable row level security;
revoke all on table public.kanban_column_presets from public, anon, authenticated;

insert into public.kanban_column_presets (automation_key, icon, tone, owner_role, short_label, description) values
  ('conversas_ia',           'bot',            'cyan',   'ai',      'Conversas IA',        'Em atendimento com a IA.'),
  ('novas_conversas',        'message-circle', 'blue',   'neutral', 'Novas',               'Aguardando primeiro contato.'),
  ('conversas_andamento',    'clock',          'cyan',   'neutral', 'Andamento',           'Em negociação.'),
  ('aguardando_humano',      'user-round',     'pink',   'human',   'Aguardando',          'Aguardando atendimento da equipe.'),
  ('com_humano',             'user-round',     'pink',   'human',   'Em atendimento',      'Com atendentes da equipe.'),
  ('conversas_humanos',      'user-round',     'pink',   'human',   'Em atendimento',      'Com atendentes da equipe.'),
  ('verificar_sinal',        'circle-dollar',  'lime',   'neutral', 'Sinal',               'Aguardando confirmação.'),
  ('confirmar_agendamento',  'calendar-check', null,     'neutral', null,                  'Pedidos conduzidos pela IA aguardando a sua confirmação.'),
  ('agendamentos',           'calendar-days',  'indigo', 'neutral', 'Agenda',              'Conversas com horário marcado.'),
  ('nao_compareceu',         'calendar-x',     null,     'neutral', null,                  'Clientes que faltaram ao agendamento.'),
  ('finalizadas',            'check-circle',   'green',  'neutral', 'Finalizadas',         'Atendimentos concluídos.'),
  ('conversas_abandonadas',  null,             'red',    'neutral', null,                  null),
  ('follow_ups',             null,             null,     'neutral', null,                  null),
  ('produtos_apresentados',  'sparkles',       'yellow', 'neutral', 'Produtos',            'Produtos e serviços enviados.'),
  ('interesse_compra',       null,             'orange', 'neutral', null,                  null),
  ('aguardando_finalizacao', null,             'lime',   'neutral', null,                  null),
  ('sales_new',              'message-circle', 'blue',   'neutral', 'Novos contatos',      'Novos contatos aguardando qualificação.'),
  ('sales_qualifying',       'bot',            'cyan',   'ai',      'Qualificação IA',     'IA coletando informações comerciais.'),
  ('sales_hot',              'flame',          'orange', 'neutral', 'Leads quentes',       'Leads de compra com prioridade comercial.'),
  ('sales_warm',             null,             null,     'neutral', null,                  null),
  ('sales_cold',             null,             null,     'neutral', null,                  null),
  ('sales_appraisal',        'car-front',      'yellow', 'neutral', 'Avaliação de retoma', 'Avaliação de veículo para retoma.'),
  ('sales_financing',        'circle-dollar',  'violet', 'neutral', 'Financiamento',       'Fila operacional de financiamento.'),
  ('sales_human',            'user-round',     'pink',   'human',   'Atendimento humano',  'Atendimento assumido pela equipe.'),
  ('sales_after_sales',      'wrench',         'teal',   'neutral', 'Pós-venda',           'Atendimentos de manutenção e pós-venda.'),
  ('sales_closed',           'check-circle',   'green',  'neutral', 'Negócio fechado',     'Venda efetivamente concluída.')
on conflict (automation_key) do update set icon = excluded.icon, tone = excluded.tone, owner_role = excluded.owner_role,
  short_label = excluded.short_label, description = excluded.description;

-- Na inserção, completa só o que veio vazio. Quem cria a coluna pode definir a própria aparência.
create or replace function public.magia_kanban_column_apply_preset()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p public.kanban_column_presets%rowtype;
begin
  select * into p from public.kanban_column_presets where automation_key = new.automation_key;
  if found then
    new.icon := coalesce(new.icon, p.icon);
    new.tone := coalesce(new.tone, p.tone);
    new.owner_role := coalesce(new.owner_role, p.owner_role);
    new.short_label := coalesce(new.short_label, p.short_label);
    new.description := coalesce(new.description, p.description);
  end if;
  new.owner_role := coalesce(new.owner_role, 'neutral');
  return new;
end
$$;
revoke all on function public.magia_kanban_column_apply_preset() from public, anon, authenticated;

drop trigger if exists kanban_columns_apply_preset on public.kanban_columns;
create trigger kanban_columns_apply_preset before insert on public.kanban_columns
  for each row execute function public.magia_kanban_column_apply_preset();

-- Carga inicial: só preenche o que ainda está vazio.
update public.kanban_columns c
set icon = coalesce(c.icon, p.icon),
    tone = coalesce(c.tone, p.tone),
    owner_role = coalesce(c.owner_role, p.owner_role),
    short_label = coalesce(c.short_label, p.short_label),
    description = coalesce(c.description, p.description)
from public.kanban_column_presets p
where p.automation_key = c.automation_key;
update public.kanban_columns set owner_role = 'neutral' where owner_role is null;

commit;

notify pgrst, 'reload schema';
