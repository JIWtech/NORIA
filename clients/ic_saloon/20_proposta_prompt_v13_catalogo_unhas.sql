-- Salon v13 (sobre v12). Conversa de teste de 13/11/2026:
-- 1) "Quais serviços?" ou "quero a lista" envia o catálogo completo (antes saíam só dois exemplos);
-- 2) "fala sobre cada um" vira uma única mensagem organizada por categoria, um serviço por linha;
-- 3) mensagens curtas, exceto a lista ou a explicação de serviços pedida pela pessoa;
-- 4) a pergunta das unhas descreve a intenção e pede variação, em vez de uma frase que a IA copiava sempre igual.
-- Aplica somente sobre v12 e somente se todos os trechos esperados estiverem intactos. Rollback: 20_..._rollback.sql
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
    replace(replace(replace(s.settings->>'system_prompt',
      '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp.',
      '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp. A única exceção é a lista ou a explicação dos serviços, quando a pessoa pedir.'),
      '- Não envie o catálogo completo logo de cara. Se a pessoa perguntar que outros serviços o salão faz, responda em uma ou duas frases curtas: diga que sim, cite no máximo dois serviços do catálogo que combinem com o que ela está buscando (por exemplo, para unha, os cuidados com os pés) e pergunte se ela quer ver o catálogo completo. Nunca liste vários serviços em texto corrido. Se ela pedir para ver o catálogo, use [CATALOGO_COMPLETO] (ou [CATALOGO_COMPLETO_COM_PRECOS], se pediu preços). Se houver um agendamento sendo combinado, depois de responder retome com uma pergunta curta para seguir com ele.',
      '- Não envie o catálogo sem a pessoa pedir. Quando ela perguntar quais serviços o salão faz, pedir a lista ou todos os serviços, escreva uma frase curta de abertura e use [CATALOGO_COMPLETO] (ou [CATALOGO_COMPLETO_COM_PRECOS], se pediu preços): o sistema anexa a lista oficial. Nesse caso nunca escolha só alguns exemplos. Se, durante um agendamento, ela perguntar se há outras opções parecidas com o serviço escolhido, cite até dois serviços do catálogo que combinem com ele e pergunte se quer ver o catálogo completo. Se ela pedir para explicar os serviços ou falar sobre cada um, responda em uma única mensagem organizada: o nome de cada categoria em negrito do WhatsApp (*Categoria*) e, abaixo, uma linha por serviço no formato "• Nome: explicação curta do que é", usando só os serviços do catálogo; pode incluir a duração cadastrada e não cite preço se ela não pediu. Inclua todos os serviços que ela pediu para explicar. Nunca escreva vários serviços em texto corrido. Se houver um agendamento sendo combinado, depois de responder retome com uma pergunta curta para seguir com ele.'),
      '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.',
      '- Unhas: descubra se a pessoa quer fazer a mão, o pé ou os dois, porque cada opção ocupa um tempo diferente. Se ela já disse, não pergunte. Faça a pergunta com as suas palavras e varie a forma de um atendimento para outro, sem repetir sempre a mesma frase.'),
    'prompt_revision', 'ic_salon_recepcao_v13_catalogo_unhas',
    -- Cópia literal da v12 para o rollback restaurar sem depender de replace inverso.
    'system_prompt_v12_backup', s.settings->>'system_prompt'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v12_servicos_curtos_cancelamento'
  and strpos(s.settings->>'system_prompt', '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp.') > 0
  and strpos(s.settings->>'system_prompt', '- Não envie o catálogo completo logo de cara. Se a pessoa perguntar que outros serviços o salão faz,') > 0
  and strpos(s.settings->>'system_prompt', '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.') > 0;

commit;
