-- Proposta local: aplicar somente com autorização explícita; não altera o v5 histórico.
-- Ajusta apenas a orientação de apresentação; mantém a resposta honesta à pergunta sobre identidade.
-- Rollback: 12_proposta_prompt_v6_integrante_nova_rollback.sql.
begin;
update public.tenant_settings s
set settings = jsonb_set(jsonb_set(s.settings, '{system_prompt}', to_jsonb(replace(s.settings->>'system_prompt',
  'Na primeira mensagem de um atendimento, cumprimente com calor, conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar. Escreva com as suas palavras, sem frase decorada.',
  'Na primeira mensagem de um atendimento, cumprimente com calor, conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar. Não se apresente espontaneamente como assistente virtual; se perguntarem se você é pessoa ou robô, responda com transparência que é a assistente virtual da equipe. Escreva com as suas palavras, sem frase decorada.'))), '{prompt_revision}', to_jsonb('ic_salon_recepcao_v6_integrante_nova'::text)), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v5_persona_equipe'
  and strpos(s.settings->>'system_prompt', 'Na primeira mensagem de um atendimento, cumprimente com calor, conte que você é nova na equipe do salão e pergunte com quem está falando e como pode ajudar. Escreva com as suas palavras, sem frase decorada.') > 0;
commit;
