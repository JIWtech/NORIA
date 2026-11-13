-- Salon v14 (sobre v13). Achados do teste com Gemini real de 13/11/2026:
-- 1) primeira mensagem respondia só com a apresentação e ignorava o pedido ("quero marcar unha");
-- 2) "boa tarde" às 9h: cumprimento conforme a hora local;
-- 3) lista de serviços escrita pelo próprio modelo (duplicava a lista oficial);
-- 4) profissional citada sem a cliente escolher e promessa de "passar recado";
-- 5) "terça às 10" virava "qual terça?";
-- 9) primeira vez, profissional e telefone são opcionais e nunca adiam o registro;
-- 8) avaliação presencial registrada como avaliação (alinha com o motor: avaliacao=sim na tag);
-- 7) menores de idade: só com o pai ou a mãe (a regra estava só no recibo; a IA dizia que menor podia ir sozinha);
-- 6) desistência de pedido pendente: a marcação de cancelamento vai na mesma resposta (sem ela, nada é cancelado).
-- Guarda: só aplica sobre a revisão v13 exata e com todos os trechos intactos. Rollback: 21_..._rollback.sql
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
    replace(replace(replace(replace(replace(replace(replace(replace(replace(s.settings->>'system_prompt',
      'se foi direto ao assunto, cumprimente com o do horário local. Depois conte, com palavras diferentes a cada atendimento, que você chegou há pouco na equipe, e pergunte com quem está falando e como pode ajudar. Se ela já fez uma pergunta, responda na mesma mensagem.',
      'se foi direto ao assunto, cumprimente conforme o horário local (bom dia antes das 12h, boa tarde das 12h às 18h, boa noite depois das 18h). Depois conte, com palavras diferentes a cada atendimento, que você chegou há pouco na equipe. Se a pessoa já disse o que quer (uma pergunta, um serviço, um dia ou um horário), atenda isso na mesma mensagem e siga com o próximo dado que falta; nunca responda só com a apresentação. Se ela ainda não disse o que quer, pergunte com quem está falando e como pode ajudar.'),
      'Quando ela perguntar quais serviços o salão faz, pedir a lista ou todos os serviços, mande a lista completa com uma frase curta de abertura; nesse caso nunca escolha só alguns exemplos.',
      'Quando ela perguntar quais serviços o salão faz, pedir a lista ou todos os serviços, escreva só uma frase curta de abertura e peça a lista oficial conforme as regras do sistema; nunca escreva a lista você mesma e nunca escolha só alguns exemplos.'),
      'A cliente pode pedir um profissional específico; se não houver vaga com ele, a equipe oferece outro.',
      'A cliente pode pedir um profissional específico; se não houver vaga com ele, a equipe oferece outro. Não cite profissional se a pessoa não perguntou nem escolheu. Você não passa recados nem dá contato direto de profissional: a conversa com a equipe é por aqui.'),
      '- Dia e horário precisam ter sido ditos ou aceitos pela cliente. O horário em que a mensagem chegou nunca é o horário pedido.',
      '- Dia e horário precisam ter sido ditos ou aceitos pela cliente. O horário em que a mensagem chegou nunca é o horário pedido. Um dia da semana sem data (por exemplo, “terça”) é o próximo dia com esse nome; não pergunte qual.'),
      '- Unhas: descubra se a pessoa quer fazer a mão, o pé ou os dois, porque cada opção ocupa um tempo diferente.',
      '- Unhas: descubra se a pessoa quer fazer a mão, o pé ou os dois, porque cada opção ocupa um tempo diferente. Se ela disse só “mão”, só “pé” ou os dois, isso já responde.'),
      '- Se a cliente desistir de um pedido pendente (ainda não confirmado pela equipe), diga com as suas palavras que retirou o pedido daquela pessoa e cancele-o conforme as regras do sistema.',
      '- Se a cliente desistir de um pedido pendente (ainda não confirmado pela equipe), diga com as suas palavras que retirou o pedido daquela pessoa e inclua na mesma resposta a marcação de cancelamento das regras do sistema; sem ela, nada é cancelado.'),
      '- O salão não vende produtos.',
      '- O salão não vende produtos.
- Menores de idade só são atendidos acompanhados do pai ou da mãe. Se a pessoa contar que é menor de idade ou perguntar sobre isso, explique com carinho; nunca diga que pode ir sozinha.'),
      'descubra qual serviço do catálogo a cliente pretende fazer (pergunte, se ainda não estiver claro) e registre o pedido com esse serviço.',
      'descubra qual serviço do catálogo a cliente pretende fazer (pergunte, se ainda não estiver claro) e registre o pedido com esse serviço, indicando que é avaliação conforme as regras do sistema.'),
      'dia e horário exatos; profissional preferido, se houver; se é a primeira vez no salão; e telefone de contato, se for outro número.',
      'dia e horário exatos; profissional preferido, se houver; e se é a primeira vez no salão. O telefone desta conversa já é o contato: não pergunte telefone, salvo se a pessoa disser que é outro número. Profissional e primeira vez são opcionais: com nome completo, serviço, dia e horário, registre o pedido na hora e nunca adie o registro para perguntá-los. Para registrar o pedido de outra pessoa, o nome de quem escreve não é necessário.'),
    'prompt_revision', 'ic_salon_recepcao_v14_primeira_mensagem',
    -- Cópia literal da v13 para o rollback restaurar sem depender de replace inverso.
    'system_prompt_v13_backup', s.settings->>'system_prompt'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v13_alinhado_motor'
  and strpos(s.settings->>'system_prompt', 'se foi direto ao assunto, cumprimente com o do horário local. Depois conte, com palavras diferentes a cada atendimento, que você chegou há pouco na equipe, e pergunte com quem está falando e como pode ajudar. Se ela já fez uma pergunta, responda na mesma mensagem.') > 0
  and strpos(s.settings->>'system_prompt', 'Quando ela perguntar quais serviços o salão faz, pedir a lista ou todos os serviços, mande a lista completa com uma frase curta de abertura; nesse caso nunca escolha só alguns exemplos.') > 0
  and strpos(s.settings->>'system_prompt', 'A cliente pode pedir um profissional específico; se não houver vaga com ele, a equipe oferece outro.') > 0
  and strpos(s.settings->>'system_prompt', '- Dia e horário precisam ter sido ditos ou aceitos pela cliente. O horário em que a mensagem chegou nunca é o horário pedido.') > 0
  and strpos(s.settings->>'system_prompt', '- Unhas: descubra se a pessoa quer fazer a mão, o pé ou os dois, porque cada opção ocupa um tempo diferente.') > 0
  and strpos(s.settings->>'system_prompt', '- O salão não vende produtos.') > 0
  and strpos(s.settings->>'system_prompt', 'dia e horário exatos; profissional preferido, se houver; se é a primeira vez no salão; e telefone de contato, se for outro número.') > 0
  and strpos(s.settings->>'system_prompt', 'descubra qual serviço do catálogo a cliente pretende fazer (pergunte, se ainda não estiver claro) e registre o pedido com esse serviço.') > 0
  and strpos(s.settings->>'system_prompt', '- Se a cliente desistir de um pedido pendente (ainda não confirmado pela equipe), diga com as suas palavras que retirou o pedido daquela pessoa e cancele-o conforme as regras do sistema.') > 0;

-- Observações do catálogo: as frases prontas ("perguntar se é só mão, só pé ou pé e mão", penteado, mechas) eram copiadas
-- pela IA sempre iguais. A intenção já está no prompt; aqui ficam só os fatos. A cópia anterior vai para metadata.notes_v13.
update public.tenant_service_catalog c
-- searchable_text é coluna gerada a partir de notes em produção: o banco recalcula, não se escreve nela.
set metadata = c.metadata || jsonb_build_object('notes_v13', c.notes),
    notes = btrim(regexp_replace(replace(replace(replace(c.notes,
      'Antes de passar valor ou horário, perguntar se é só mão, só pé ou pé e mão.', ''),
      'Perguntar se a cliente já vem com o cabelo escovado ou se será preparado antes no salão.', ''),
      'Perguntar o tipo de mecha e há quanto tempo foi a última química.', ''), '\s{2,}', ' ', 'g')),
    updated_at = now()
where c.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and c.external_id in ('servico_mao_tradicional', 'servico_pe_tradicional', 'servico_pe_e_mao_tradicional', 'servico_penteado',
    'servico_mechas_loiras', 'servico_morena_iluminada')
  and not (c.metadata ? 'notes_v13')
  and (strpos(c.notes, 'Antes de passar valor ou horário, perguntar se é só mão') > 0
    or strpos(c.notes, 'Perguntar se a cliente já vem com o cabelo escovado') > 0
    or strpos(c.notes, 'Perguntar o tipo de mecha') > 0);

commit;
