-- Recibo e confirmação do I&C Salon mais naturais (13/11/2026):
-- 1) o recibo do pedido não repete o aviso de menores (a IA explica a regra quando o assunto aparece, prompt v14);
-- 2) a confirmação, enviada uma vez quando a equipe confirma, traz o aviso de forma leve;
-- 3) frases terminam com pontuação;
-- 4) texto de passar para a equipe mais natural (o anterior dizia "conferir esse ponto");
-- 6) textos de último recurso por caso: dia fechado (closed_day_template) e desistência sem pedido aberto
--    (no_pending_request_template), no lugar da mensagem de erro genérica;
-- 5) feriados nacionais de data fixa em business_hours.holidays (MM-DD): o motor trata como dia fechado. A lista é do
--    cadastro e pode ser ajustada; feriados de data móvel (Sexta-feira Santa) e locais não entram aqui.
-- Guarda: só troca os textos que ainda estão exatamente como os atuais. A cópia anterior fica em
-- appointment_request.templates_backup_v1 para o rollback (22_..._rollback.sql).
begin;

update public.tenant_settings s
set settings = jsonb_set(s.settings, '{appointment_request}', (s.settings->'appointment_request') || jsonb_build_object(
    'templates_backup_v1', jsonb_build_object(
      'received_template', s.settings->'appointment_request'->>'received_template',
      'confirmation_template', s.settings->'appointment_request'->>'confirmation_template',
      'review_handoff_template', s.settings->'appointment_request'->>'review_handoff_template'),
    'received_template', E'Prontinho, anotei aqui! {servicos} para {data}, às {hora} ✨\nAgora é só aguardar: a equipe confirma o horário com você por aqui.',
    'review_handoff_template', 'Vou chamar alguém da equipe para continuar com você por aqui, tá bem?',
    'closed_day_template', 'Nesse dia o salão não abre. Qual outro dia fica bom para você?',
    'no_pending_request_template', 'Não encontrei pedido pendente dessa pessoa por aqui. Posso ajudar em mais alguma coisa?',
    'confirmation_template', E'Oba, seu horário está confirmado! {servicos} para {data}, às {hora} 💜\nVamos te esperar com muito carinho. Se o atendimento for para alguém menor de idade, é só vir com o pai ou a mãe junto, tá?'
  )), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and not (s.settings->'appointment_request' ? 'templates_backup_v1')
  and s.settings->'appointment_request'->>'received_template' = E'Prontinho, anotei aqui! {servicos} para {data}, às {hora} ✨\nAgora é só aguardar: a equipe confirma o horário com você por aqui, combinado?\nUm lembrete importante: menores de idade só são atendidos acompanhados do pai ou da mãe'
  and s.settings->'appointment_request'->>'confirmation_template' = E'Oba, seu horário está confirmado! {servicos} para {data}, às {hora} 💜\nVamos te esperar com muito carinho!\nLembrando que menores de idade só são atendidos acompanhados do pai ou da mãe';

update public.tenant_settings s
set settings = jsonb_set(s.settings, '{business_hours}', coalesce(s.settings->'business_hours', '{}'::jsonb)
    || jsonb_build_object('holidays', jsonb_build_array('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'),
      'holidays_added_by', '22_textos_recibo_confirmacao')), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and not coalesce(s.settings->'business_hours' ? 'holidays', false);

commit;
