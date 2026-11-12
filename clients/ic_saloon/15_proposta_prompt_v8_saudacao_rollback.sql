-- Reverte 15_proposta_prompt_v8_saudacao.sql (v8 -> v7). Só aplica sobre o v8.
begin;

update public.tenant_settings s
set settings = (s.settings - 'price_check_retry_template') || jsonb_build_object(
    'system_prompt',
      replace(replace(replace(s.settings->>'system_prompt',
        ' (use um cumprimento acolhedor que não indique gênero)',
        ' (por exemplo, “que bom ter você por aqui”)'),
        '- Na primeira mensagem de um atendimento, responda ao cumprimento da pessoa: se ela disse “bom dia”, “boa tarde” ou “boa noite”, devolva o mesmo cumprimento; se disse só “oi” ou “olá”, responda com um “oi” ou “olá” acolhedor; se foi direto ao assunto, cumprimente com o do horário local. Depois conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar. Se ela já fez uma pergunta, responda a pergunta na mesma mensagem.',
        '- Na primeira mensagem de um atendimento, cumprimente com calor, conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar.'),
        '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas, nem a abertura de atendimentos anteriores.' || E'\n' ||
        '- Se não entender o que a pessoa quis dizer, peça com simpatia que ela repita ou conte de outro jeito. Não invente e não mude de assunto.',
        '- Varie as palavras: não repita a mesma abertura, o mesmo elogio ou o mesmo fechamento em mensagens seguidas.'),
    'prompt_revision', 'ic_salon_recepcao_v7_publico_misto'
  ),
  updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v8_saudacao';

commit;
