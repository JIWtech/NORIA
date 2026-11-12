-- NORIA (tenant noria): atendimento da IA 24 horas e frase de transferência para humano.
-- IA-07 da auditoria de 12/11/2026. Aplicado em produção em 12/11/2026 com autorização do responsável.
-- Rollback: 01_atendimento_24h_e_transferencia_rollback.sql
--
-- 1. business_hours = { is_24h: true }: o CORE deixa de assumir "aberto" por falta de configuração e passa a tratar o
--    atendimento como 24h de forma explícita.
-- 2. O prompt ganha uma regra: quando o cliente quiser falar com uma pessoa, a IA avisa que a equipe entrará em contato
--    o mais breve possível, sem prometer horário nem tempo.
begin;

update public.tenant_settings s
set settings = s.settings
    || jsonb_build_object(
      'business_hours', jsonb_build_object('is_24h', true),
      'system_prompt', s.settings->>'system_prompt'
        || E'\n\nQuando a pessoa pedir para falar com um atendente ou com uma pessoa da equipe, diga com naturalidade que a equipe entrará em contato o mais breve possível. Não prometa horário nem prazo. Fora disso, você atende normalmente, a qualquer hora.',
      'prompt_revision', 'noria_recepcao_v2_24h')
  , updated_at = now()
where s.tenant_id = (select id from public.tenants where slug = 'noria')
  and s.settings->>'prompt_revision' = 'noria_recepcao_v1'
  and position('entrará em contato o mais breve possível' in s.settings->>'system_prompt') = 0;

commit;
