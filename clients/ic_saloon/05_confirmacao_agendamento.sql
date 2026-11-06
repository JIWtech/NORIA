-- I&C Salon: liga a coluna "Confirmar agendamento" (plano em docs/operations/plano_coluna_confirmacao_agendamento.md).
-- Só rodar depois de: migração 031 aplicada, CORE e painel publicados, e textos abaixo aprovados pelo Cesar.
-- Enquanto os textos estiverem com PREENCHER, o script recusa. Seguro de reaplicar. Só toca o tenant ic_salon.
--
-- Variáveis aceitas nos textos: {nome}, {servicos}, {data} (ex.: sexta-feira, 6 de novembro) e {hora}.
-- Sugestões para o Cesar aprovar:
--   recebido:     Perfeito, {nome}! Anotei {servicos} para {data}, às {hora}. A equipe vai confirmar o horário por aqui.
--                 Menores de idade só são atendidos acompanhados do pai ou da mãe.
--   confirmado:   {nome}, seu horário está confirmado: {servicos}, {data}, às {hora}. Te esperamos!
--                 Menores de idade só são atendidos acompanhados do pai ou da mãe.
--   indisponível: {nome}, esse horário não está disponível. Qual outro dia ou horário fica bom para você?
--
-- Para reverter: restaure o prompt anterior (revisão ic_salon_recepcao_v2) e remova settings.appointment_request na mesma transação.

do $do$
declare
  v_tid uuid;
  v_board uuid;
  v_prompt text;
  v_new text;
  v_received text := 'PREENCHER';
  v_confirmed text := 'PREENCHER';
  v_rejected text := 'PREENCHER';
begin
  if 'PREENCHER' in (v_received, v_confirmed, v_rejected) then raise exception 'TEXTOS_NAO_APROVADOS'; end if;

  select id into v_tid from public.tenants where slug = 'ic_salon';
  if v_tid is null then raise exception 'TENANT_NOT_FOUND'; end if;
  if to_regprocedure('public.magia_upsert_appointment_request(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text)') is null then
    raise exception 'MIGRATION_031_REQUIRED';
  end if;
  select settings->>'system_prompt' into v_prompt from public.tenant_settings where tenant_id = v_tid;
  if v_prompt is null then raise exception 'PROMPT_NOT_FOUND'; end if;

  v_new := replace(v_prompt,
    'Você não vê a agenda e não confirma horário. Nunca diga que um horário está livre, reservado ou confirmado e nunca use a tag [ACAO: CRIAR_AGENDAMENTO]. Quem confirma é a equipe do salão.',
    'Você não vê a agenda e não confirma horário. Nunca diga que um horário está livre, reservado ou confirmado. Quem confirma é a equipe do salão.');
  v_new := replace(v_new, 'dia ou período preferido;', 'dia e horário exatos;');
  v_new := replace(v_new,
    '- Quando tiver os dados, resuma em uma frase, diga que a equipe vai confirmar o horário por aqui e lembre que menores de idade só são atendidos acompanhados do pai ou da mãe. Finalize com [HUMANO_SOLICITADO].',
    '- Quando tiver nome completo, serviço, dia e horário exatos, registre o pedido com a tag, sem texto de resumo, usando a data no formato AAAA-MM-DD e os nomes dos serviços como estão no catálogo: [ACAO: CRIAR_AGENDAMENTO|nome=Nome Sobrenome|servicos=Serviço 1;Serviço 2|data=AAAA-MM-DD|hora=HH:MM|profissional=Nome, se houver|primeira_vez=sim ou não|status=pending_confirmation]. Não use [HUMANO_SOLICITADO] nesse momento.'
    || E'\n- Quando o contexto trouxer pedido_pendente, o pedido já está com a equipe. Essas regras valem acima de QUANDO PASSAR PARA A EQUIPE:'
    || E'\n  - se a cliente perguntar pela confirmação ou mandar algo como "ok", responda com suas palavras que a equipe vai confirmar por aqui. Nunca diga que está confirmado;'
    || E'\n  - se ela mudar serviço, dia, horário ou profissional, use [ACAO: ATUALIZAR_PEDIDO|hora=HH:MM] apenas com o que mudou (campos: servicos, data, hora, profissional);'
    || E'\n  - se ela desistir do pedido, escreva uma frase curta confirmando e termine com [ACAO: CANCELAR_PEDIDO].'
    || E'\n- Se ela quiser mudar ou cancelar um agendamento que já está em confirmado, finalize com [HUMANO_SOLICITADO].');

  if v_new = v_prompt then
    if position('ATUALIZAR_PEDIDO' in v_prompt) = 0 then raise exception 'PROMPT_REPLACE_INCOMPLETE'; end if;
  elsif position('[ACAO: CRIAR_AGENDAMENTO|nome' in v_new) = 0 or position('dia e horário exatos;' in v_new) = 0
    or position('nunca use a tag' in v_new) > 0 then
    raise exception 'PROMPT_REPLACE_INCOMPLETE';
  end if;

  update public.tenant_settings
  set settings = settings || jsonb_build_object(
    'system_prompt', v_new,
    'prompt_revision', 'ic_salon_recepcao_v3',
    'appointment_request', jsonb_build_object('mode', 'operator_confirmation', 'received_template', v_received,
      'confirmation_template', v_confirmed, 'slot_rejected_template', v_rejected, 'stale_alert_hours', 4))
  where tenant_id = v_tid;

  select board_id into v_board from public.kanban_columns where tenant_id = v_tid and automation_key = 'agendamentos';
  if v_board is null then raise exception 'BOARD_NOT_FOUND'; end if;
  if not exists (select 1 from public.kanban_columns where tenant_id = v_tid and automation_key = 'confirmar_agendamento') then
    update public.kanban_columns set position = position + 100 where tenant_id = v_tid and board_id = v_board and position >= 3;
    update public.kanban_columns set position = position - 99 where tenant_id = v_tid and board_id = v_board and position >= 100;
    insert into public.kanban_columns(tenant_id, board_id, name, position, automation_key)
    values (v_tid, v_board, 'Confirmar agendamento', 3, 'confirmar_agendamento');
  end if;
end
$do$;
