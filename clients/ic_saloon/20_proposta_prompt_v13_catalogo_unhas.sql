-- Salon v13 (sobre v12). Conversa de teste de 13/11/2026:
-- 1) "Quais serviços?" ou "quero a lista" envia o catálogo completo (antes saíam só dois exemplos);
-- 2) "fala sobre cada um" vira uma única mensagem organizada por categoria, um serviço por linha;
-- 3) mensagens curtas, exceto a lista ou a explicação de serviços pedida pela pessoa;
-- 4) frases prontas que a IA copiava sempre iguais (unhas, penteado, cliente indecisa, apresentação) viram a intenção,
--    e uma regra geral diz que as orientações do texto indicam o que descobrir, não as palavras a usar.
-- Aplica somente sobre v12 e somente se todos os trechos esperados estiverem intactos. Rollback: 20_..._rollback.sql
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
    replace(replace(replace(replace(replace(replace(replace(s.settings->>'system_prompt',
      '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp.',
      '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp. A única exceção é a lista ou a explicação dos serviços, quando a pessoa pedir.'),
      '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas, nem a abertura de atendimentos anteriores.',
      '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas, nem a abertura de atendimentos anteriores. As perguntas e orientações deste texto dizem o que descobrir ou explicar, não as palavras exatas: escreva sempre com as suas palavras, mude a estrutura da frase de um atendimento para outro e nunca copie frases daqui.'),
      'Depois conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar.',
      'Depois conte, com palavras diferentes a cada atendimento, que você chegou há pouco na equipe, e pergunte com quem está falando e como pode ajudar.'),
      '- Não envie o catálogo completo logo de cara. Se a pessoa perguntar que outros serviços o salão faz, responda em uma ou duas frases curtas: diga que sim, cite no máximo dois serviços do catálogo que combinem com o que ela está buscando (por exemplo, para unha, os cuidados com os pés) e pergunte se ela quer ver o catálogo completo. Nunca liste vários serviços em texto corrido. Se ela pedir para ver o catálogo, use [CATALOGO_COMPLETO] (ou [CATALOGO_COMPLETO_COM_PRECOS], se pediu preços). Se houver um agendamento sendo combinado, depois de responder retome com uma pergunta curta para seguir com ele.',
      '- Não envie o catálogo sem a pessoa pedir. Quando ela perguntar quais serviços o salão faz, pedir a lista ou todos os serviços, escreva uma frase curta de abertura e use [CATALOGO_COMPLETO] (ou [CATALOGO_COMPLETO_COM_PRECOS], se pediu preços): o sistema anexa a lista oficial. Nesse caso nunca escolha só alguns exemplos. Se, durante um agendamento, ela perguntar se há outras opções parecidas com o serviço escolhido, cite até dois serviços do catálogo que combinem com ele e pergunte se quer ver o catálogo completo. Se ela pedir para explicar os serviços ou falar sobre cada um, responda em uma única mensagem organizada: o nome de cada categoria em negrito do WhatsApp (*Categoria*) e, abaixo, uma linha por serviço no formato "• Nome: explicação curta do que é", usando só os serviços do catálogo; pode incluir a duração cadastrada e não cite preço se ela não pediu. Inclua todos os serviços que ela pediu para explicar. Nunca escreva vários serviços em texto corrido. Se houver um agendamento sendo combinado, depois de responder retome com uma pergunta curta para seguir com ele.'),
      '- Cliente indecisa: pergunte como está o cabelo hoje e se tem alguma referência; depois convide para a avaliação presencial.',
      '- Cliente indecisa: procure entender como está o cabelo dela hoje e se ela tem alguma referência; depois convide para a avaliação presencial.'),
      '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.',
      '- Unhas: descubra se a pessoa quer fazer a mão, o pé ou os dois, porque cada opção ocupa um tempo diferente. Se ela já disse, não pergunte.'),
      '- Penteado: pergunte se a cliente já vem com o cabelo escovado ou se ele será preparado antes no salão.',
      '- Penteado: descubra se o cabelo da cliente já virá escovado ou se precisa ser preparado no salão antes. Se ela já disse, não pergunte.'),
    'prompt_revision', 'ic_salon_recepcao_v13_catalogo_frases_proprias',
    -- Cópia literal da v12 para o rollback restaurar sem depender de replace inverso.
    'system_prompt_v12_backup', s.settings->>'system_prompt'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v12_servicos_curtos_cancelamento'
  and strpos(s.settings->>'system_prompt', '- Mensagens curtas, de uma a três frases, como numa conversa de WhatsApp.') > 0
  and strpos(s.settings->>'system_prompt', '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas, nem a abertura de atendimentos anteriores.') > 0
  and strpos(s.settings->>'system_prompt', 'Depois conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar.') > 0
  and strpos(s.settings->>'system_prompt', '- Não envie o catálogo completo logo de cara. Se a pessoa perguntar que outros serviços o salão faz,') > 0
  and strpos(s.settings->>'system_prompt', '- Cliente indecisa: pergunte como está o cabelo hoje e se tem alguma referência; depois convide para a avaliação presencial.') > 0
  and strpos(s.settings->>'system_prompt', '- Unhas: pergunte se é só mão, só pé ou pé e mão, porque cada opção ocupa um tempo diferente.') > 0
  and strpos(s.settings->>'system_prompt', '- Penteado: pergunte se a cliente já vem com o cabelo escovado ou se ele será preparado antes no salão.') > 0;

commit;
