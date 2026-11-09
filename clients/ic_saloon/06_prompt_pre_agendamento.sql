-- I&C Salon: ajustes do prompt para o pré-agendamento (aplicados em 09/11/2026).
-- Cada passo só altera o prompt que está exatamente na versão esperada (md5); rodar de novo não muda nada.

-- 1) A lista "quando passar para a equipe" mandava encaminhar quando os dados do agendamento ficavam completos.
--    Isso fazia a IA pedir atendente em vez de registrar o pedido. 469d4a29… -> 3128d9fb…
update tenant_settings
set settings = jsonb_set(settings, '{system_prompt}', to_jsonb(replace(settings->>'system_prompt',
  E'neste texto;\n- os dados do agendamento estiverem completos.', 'neste texto.')))
where tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'
  and md5(settings->>'system_prompt') = '469d4a2901b680dd1dfde785fb4b83ca';

-- 2) A avaliação presencial não é serviço do catálogo, e o pedido só aceita serviço do catálogo.
--    A IA registra o serviço que a cliente pretende fazer, e a avaliação acontece no atendimento. 3128d9fb… -> dafdeb67…
update tenant_settings
set settings = jsonb_set(settings, '{system_prompt}', to_jsonb(replace(settings->>'system_prompt',
  E'- A avaliação é presencial e gratuita. Não é feita por foto.\n',
  E'- A avaliação é presencial e gratuita. Não é feita por foto.\n- A avaliação não é um serviço do catálogo e nunca vai na tag. Para marcar uma avaliação, descubra qual serviço do catálogo a cliente pretende fazer (pergunte, se ainda não estiver claro) e registre o pedido com esse serviço. Na conversa, diga que a avaliação é feita no salão, junto com o atendimento.\n')))
where tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'
  and md5(settings->>'system_prompt') = '3128d9fb4f95269f6283f898f1ea03eb';

-- 3) Frases de nova tentativa do pedido, antes fixas no CORE: agora são do tenant, como as de recebido e confirmado.
--    Mesmo texto que o cliente já recebia. Sem elas, o pedido recusado vai para a equipe.
update tenant_settings
set settings = jsonb_set(settings, '{appointment_request}', (settings->'appointment_request') || jsonb_build_object(
  'invalid_request_template', 'Não consegui registrar esse horário. Me confirme o serviço, a data e o horário desejados para eu verificar?',
  'full_name_template', 'Qual é o seu nome completo, por favor?'))
where tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'
  and settings->'appointment_request'->>'mode' = 'operator_confirmation'
  and not (settings->'appointment_request' ? 'invalid_request_template')
  and not (settings->'appointment_request' ? 'full_name_template');

-- 4) Horário indisponível com tom mais acolhedor e sem repetir o nome completo da cliente.
update tenant_settings
set settings = jsonb_set(settings, '{appointment_request,slot_rejected_template}',
  to_jsonb('Poxa, o horário de {data}, às {hora}, já está ocupado 😕 Mas a gente encontra outro pra você! Qual dia ou horário fica melhor?'::text))
where tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'
  and settings->'appointment_request'->>'slot_rejected_template' = '{nome}, esse horário não está disponível. Qual outro dia ou horário fica bom para você?';

-- 5) Mensagens do pedido mais leves, sem o nome completo da cliente e sem ponto final em toda frase (no máximo um emoji).
update tenant_settings
set settings = jsonb_set(settings, '{appointment_request}', (settings->'appointment_request') || jsonb_build_object(
  'received_template', E'Prontinho, anotei aqui! {servicos} para {data}, às {hora} ✨\nAgora é só aguardar: a equipe confirma o horário com você por aqui, combinado?\nUm lembrete importante: menores de idade só são atendidos acompanhados do pai ou da mãe',
  'confirmation_template', E'Oba, seu horário está confirmado! {servicos} para {data}, às {hora} 💜\nVamos te esperar com muito carinho!\nLembrando que menores de idade só são atendidos acompanhados do pai ou da mãe',
  'slot_rejected_template', 'Poxa, o horário de {data}, às {hora}, já está ocupado 😕 Mas a gente encontra outro para você! Qual dia ou horário fica melhor?',
  'invalid_request_template', 'Hum, não consegui registrar esse pedido 😕 Pode me contar de novo o serviço, o dia e o horário que você quer?',
  'full_name_template', 'Para eu anotar certinho, qual é o seu nome completo?'))
where tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'
  and settings->'appointment_request'->>'received_template' like 'Perfeito, {nome}!%'
  and settings->'appointment_request'->>'confirmation_template' like '{nome}, seu horário está confirmado%';

-- 6) Estilo das respostas livres da IA: tom de WhatsApp, menos ponto final, sem repetir o nome. dafdeb67… -> d9ac00a5…
update tenant_settings
set settings = jsonb_set(settings, '{system_prompt}', to_jsonb(replace(settings->>'system_prompt',
  E'nunca transforme a conversa em formulário.\n',
  E'nunca transforme a conversa em formulário.\n- Escreva como numa conversa de WhatsApp, leve e calorosa. Evite terminar todas as frases com ponto final: prefira quebra de linha, exclamação ou pergunta quando couber.\n- Não repita o nome da cliente a cada mensagem. Se usar, use só o primeiro nome, e de vez em quando.\n')))
where tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'
  and md5(settings->>'system_prompt') = 'dafdeb67c6930cc9e90479b250a22624';
