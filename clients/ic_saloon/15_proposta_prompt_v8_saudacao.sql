-- PROPOSTA (não aplicada): prompt v8 do I&C Salon — saudação que acompanha a pessoa e pedido amigável para repetir.
-- Aplicar somente com autorização explícita do responsável. Rollback: 15_proposta_prompt_v8_saudacao_rollback.sql.
-- Só aplica sobre o v7 (ic_salon_recepcao_v7_publico_misto); se algum trecho exato não existir, nada é alterado.
--
-- Causa da saudação padronizada (investigação de 12/11/2026): é o PROMPT, não o workflow. O motor não escreve a saudação.
-- 1. O v7 dá a frase “que bom ter você por aqui” como exemplo de tratamento neutro, e o modelo a copia em todo atendimento novo.
-- 2. A regra da primeira mensagem manda "cumprimentar com calor", sem dizer para responder ao “bom dia / boa tarde / boa noite”.
-- Esta versão tira o exemplo literal, manda devolver o cumprimento da pessoa e pede, quando não entender, que ela repita.
-- Também grava price_check_retry_template, o texto usado quando a conferência de preço falha tecnicamente (em vez de
-- “a equipe pode confirmar o valor”, que só vale quando o preço foi reprovado).
begin;

update public.tenant_settings s
set settings = s.settings || jsonb_build_object(
    'system_prompt',
      replace(replace(replace(s.settings->>'system_prompt',
        ' (por exemplo, “que bom ter você por aqui”)',
        ' (use um cumprimento acolhedor que não indique gênero)'),
        '- Na primeira mensagem de um atendimento, cumprimente com calor, conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar.',
        '- Na primeira mensagem de um atendimento, responda ao cumprimento da pessoa: se ela disse “bom dia”, “boa tarde” ou “boa noite”, devolva o mesmo cumprimento; se disse só “oi” ou “olá”, responda com um “oi” ou “olá” acolhedor; se foi direto ao assunto, cumprimente com o do horário local. Depois conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar. Se ela já fez uma pergunta, responda a pergunta na mesma mensagem.'),
        '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas.',
        '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas, nem a abertura de atendimentos anteriores.' || E'\n' ||
        '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.'),
    'prompt_revision', 'ic_salon_recepcao_v8_saudacao',
    'price_check_retry_template', 'Não consegui conferir essa informação agora. Pode me mandar sua pergunta de novo, por favor? 😊'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v7_publico_misto'
  and strpos(s.settings->>'system_prompt', ' (por exemplo, “que bom ter você por aqui”)') > 0
  and strpos(s.settings->>'system_prompt', '- Na primeira mensagem de um atendimento, cumprimente com calor, conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar.') > 0
  and strpos(s.settings->>'system_prompt', '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas.') > 0;

commit;
