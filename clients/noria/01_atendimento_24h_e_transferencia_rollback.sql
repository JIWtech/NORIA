-- Reverte 01_atendimento_24h_e_transferencia.sql (tenant noria): remove business_hours e a regra de transferência.
begin;

update public.tenant_settings s
set settings = (s.settings - 'business_hours')
    || jsonb_build_object(
      'system_prompt', replace(s.settings->>'system_prompt',
        E'\n\nQuando a pessoa pedir para falar com um atendente ou com uma pessoa da equipe, diga com naturalidade que a equipe entrará em contato o mais breve possível. Não prometa horário nem prazo. Fora disso, você atende normalmente, a qualquer hora.', ''),
      'prompt_revision', 'noria_recepcao_v1')
  , updated_at = now()
where s.tenant_id = (select id from public.tenants where slug = 'noria')
  and s.settings->>'prompt_revision' = 'noria_recepcao_v2_24h';

commit;
