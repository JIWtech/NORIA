-- I&C Salon: ajustes depois da revisão do Cesar (05/11/2026).
-- Seguro de reaplicar. Só toca o tenant ic_salon. Não ativa a IA (isso é o 04_ativar.sql).
--
--  * endereço confirmado: Av. das Acácias, 209 - Cidade Jardim (sem "Loja 4");
--  * emojis permitidos com moderação;
--  * o salão NÃO aplica coloração trazida pela cliente;
--  * todos os serviços sem valor são "a partir de" (valor ainda não informado -> PENDENCIAS.md);
--  * liga o registro de desfecho de agendamento ("Compareceu" / "Cliente não veio").

do $do$
declare
  v_tid uuid;
  v_prompt text;
  v_new text;
begin
  select id into v_tid from public.tenants where slug = 'ic_salon';
  if v_tid is null then raise exception 'TENANT_NOT_FOUND'; end if;
  select settings->>'system_prompt' into v_prompt from public.tenant_settings where tenant_id = v_tid;
  if v_prompt is null then raise exception 'PROMPT_NOT_FOUND'; end if;

  v_new := replace(v_prompt, 'Av. das Acácias, 207, Loja 4, Cidade Jardim', 'Av. das Acácias, 209, Cidade Jardim');
  v_new := replace(v_new, 'Não use gírias, abreviações de internet nem emojis.', 'Não use gírias nem abreviações de internet. Emojis são permitidos com moderação: no máximo um por mensagem e só quando combinarem com o assunto.');
  v_new := replace(v_new, '- Se perguntarem se o salão aplica coloração que a cliente trouxer, diga que a equipe confirma.', '- O salão não aplica coloração trazida pela cliente. Se perguntarem, explique isso com gentileza e ofereça a coloração do próprio salão.');

  -- Reaplicação: se já estiver tudo ajustado, não é erro.
  if v_new = v_prompt and (position('209, Cidade Jardim' in v_prompt) = 0 or position('Emojis são permitidos com moderação' in v_prompt) = 0
      or position('não aplica coloração trazida pela cliente' in v_prompt) = 0) then
    raise exception 'PROMPT_REPLACE_INCOMPLETE';
  end if;
  if position('207' in v_new) > 0 then raise exception 'PROMPT_STILL_HAS_OLD_ADDRESS'; end if;

  update public.tenant_settings
  set settings = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(settings,
        '{system_prompt}', to_jsonb(v_new)),
        '{prompt_revision}', '"ic_salon_recepcao_v2"'),
        '{tone}', '"Tom amigável, humanizado e próximo, sem gírias; emojis com moderação."'),
        '{business_facts,address}', '"Av. das Acácias, 209, Cidade Jardim"'),
        '{business_facts,address_verified}', 'true'),
        '{appointment_outcome_tracking}', 'true')
  where tenant_id = v_tid;

  update public.tenant_service_catalog
  set notes = 'Valor a partir de (o valor inicial ainda não foi informado pelo salão: a equipe confirma).',
      metadata = jsonb_set(metadata, '{price_type}', '"from"')
  where tenant_id = v_tid and external_id in ('servico_corte','servico_terapia_capilar','servico_limpeza_de_pele','servico_drenagem','servico_massagem_modeladora','servico_massagem_relaxante');

  update public.tenant_service_catalog
  set notes = notes || ' O salão não aplica coloração trazida pela cliente.'
  where tenant_id = v_tid and external_id = 'servico_coloracao' and position('trazida pela cliente' in notes) = 0;
end
$do$;
