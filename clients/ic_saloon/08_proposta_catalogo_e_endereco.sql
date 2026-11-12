-- Correção restrita ao ic_salon, com pré-condições para a configuração revisada.
-- Aplicar somente sobre a configuração conferida em 09/11/2026. O bloco é atômico.
do $do$
declare
  v_tid constant uuid := '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
  v_old_address constant text := 'Av. das Acácias, 209, Cidade Jardim';
  v_address constant text := 'Av. das Acácias, 207, Loja 4, Cidade Jardim';
  v_revision constant text := 'ic_salon_recepcao_v4_catalogo_endereco';
  v_price_fallback constant text := 'A equipe pode confirmar o valor certinho para você.';
  v_cut_old constant text := 'Valor a partir de (o valor inicial ainda não foi informado pelo salão: a equipe confirma).';
  v_cut constant text := 'Preço fixo para pagamento no Pix ou em dinheiro.';
  v_highlights_old constant text := 'Valor a partir de (o valor inicial ainda não foi informado pelo salão: a equipe informa na avaliação). O valor final só pode subir depois da avaliação presencial, nunca baixar, e depende da quantidade de produto usada.';
  v_highlights constant text := 'Orçamento definido na avaliação presencial gratuita, conforme a quantidade de produto necessária. Preço sob consulta.';
  v_settings jsonb;
  v_prompt text;
  v_new text;
  v_services integer;
  v_service_ids integer;
  v_cut_matches integer;
  v_highlights_matches integer;
begin
  if not exists (select 1 from public.tenants where id = v_tid and slug = 'ic_salon') then
    raise exception 'IC_SALON_TENANT_NOT_FOUND';
  end if;

  select settings into strict v_settings from public.tenant_settings where tenant_id = v_tid for update;
  v_prompt := v_settings->>'system_prompt';

  perform 1 from public.tenant_service_catalog
  where tenant_id = v_tid and active is true
    and external_id in ('servico_corte', 'servico_mechas_loiras', 'servico_morena_iluminada')
  for update;

  select count(*), count(distinct external_id) into v_services, v_service_ids
  from public.tenant_service_catalog
  where tenant_id = v_tid and active is true
    and external_id in ('servico_corte', 'servico_mechas_loiras', 'servico_morena_iluminada');
  if v_services <> 3 or v_service_ids <> 3 then
    raise exception 'IC_SALON_CATALOG_IDENTITY_CHANGED';
  end if;

  if v_settings->>'prompt_revision' = v_revision then
    select count(*) filter (where external_id = 'servico_corte' and price = 140
             and metadata->>'price_type' = 'fixed' and notes = v_cut),
           count(*) filter (where external_id <> 'servico_corte' and price is null
             and starts_with(notes, v_highlights))
      into v_cut_matches, v_highlights_matches
    from public.tenant_service_catalog
    where tenant_id = v_tid and active is true and external_source = 'ic_salon_scope_v1'
      and external_id in ('servico_corte', 'servico_mechas_loiras', 'servico_morena_iluminada');
    if v_cut_matches = 1 and v_highlights_matches = 2
        and v_settings#>>'{business_facts,address}' = v_address
        and strpos(v_prompt, v_address) > 0 and strpos(v_prompt, v_old_address) = 0
        and strpos(v_prompt, 'valor final só pode subir') = 0
        and strpos(v_prompt, 'Preço ausente ou sob consulta') > 0
        and v_settings->>'price_rejection_template' = v_price_fallback then
      return;
    end if;
    raise exception 'IC_SALON_APPLIED_STATE_CHANGED';
  end if;

  if v_settings->>'prompt_revision' is distinct from 'ic_salon_recepcao_v3'
      or md5(v_prompt) is distinct from 'd9ac00a55cc9d98ce4bb9119a9e54d2d'
      or v_settings#>>'{business_facts,address}' is distinct from v_old_address then
    raise exception 'IC_SALON_SETTINGS_CHANGED';
  end if;

  v_new := replace(v_prompt, v_old_address, v_address);
  v_new := replace(v_new, '- Os valores do catálogo são para pagamento no Pix ou em dinheiro. Informe sempre esse valor.',
    '- Quando houver preço numérico para o serviço exato, informe o valor cadastrado para Pix ou dinheiro. Se o catálogo indicar preço fixo, apresente o valor como fixo, sem dizer “a partir de”.');
  v_new := replace(v_new, '- Se o catálogo disser "preço sob consulta", não dê valor nem faça estimativa: diga que a equipe confirma o valor (e, nos serviços que exigem avaliação, o valor é definido na avaliação presencial).',
    '- Preço ausente ou sob consulta: explique que a equipe confirma o valor, sem prometer quando, ou, se o serviço exige avaliação, que o orçamento é definido presencialmente. Essa regra também vale se a cliente insistir em uma faixa ou valor inicial. Use o histórico só para entender a pergunta. Não repita valores de mensagens anteriores, não estime e não use valores de outro serviço.');
  v_new := replace(v_new, '- Valores "a partir de" em química e mechas são o mínimo: o valor final só pode subir depois da avaliação presencial, nunca baixar.',
    '- Em química e mechas, só informe um valor inicial quando o catálogo trouxer um número para o serviço exato e indicar que ele é inicial. Para mechas loiras e morena iluminada, explique com naturalidade que o orçamento depende da avaliação presencial gratuita e da quantidade de produto necessária. Sem um preço numérico cadastrado, fale apenas da avaliação e do orçamento, sem divulgar faixa, valor inicial ou instruções comerciais internas.');
  v_new := replace(v_new, 'Pergunte o tipo de mecha e há quanto tempo foi a última química. Explique a balança, diga que o valor depende da avaliação e convide para a avaliação presencial gratuita.',
    'Se a dúvida for sobre preço, responda primeiro sobre a avaliação e o orçamento. Se a cliente quiser marcar as mechas, deixe claro que o procedimento só pode ser marcado após aprovação no teste de mechas. Antes disso, ofereça marcar a avaliação presencial e diferencie as duas etapas ao pedir dados. Pergunte sobre o tipo de mecha ou a última química apenas se a informação ainda for necessária.');

  update public.tenant_service_catalog
  set price = 140, metadata = jsonb_set(metadata, '{price_type}', '"fixed"'),
      notes = v_cut, updated_at = now()
  where tenant_id = v_tid and active is true and external_source = 'ic_salon_scope_v1'
    and external_id = 'servico_corte' and price is null and metadata->>'price_type' = 'from'
    and metadata->'professionals' = '["Ítalo"]'::jsonb and notes = v_cut_old;
  get diagnostics v_cut_matches = row_count;

  update public.tenant_service_catalog
  set notes = v_highlights || substr(notes, length(v_highlights_old) + 1), updated_at = now()
  where tenant_id = v_tid and active is true and external_source = 'ic_salon_scope_v1'
    and external_id in ('servico_mechas_loiras', 'servico_morena_iluminada') and price is null
    and metadata->>'evaluation' = 'required' and metadata->>'price_type' = 'from'
    and starts_with(notes, v_highlights_old);
  get diagnostics v_highlights_matches = row_count;

  if v_cut_matches <> 1 or v_highlights_matches <> 2 then
    raise exception 'IC_SALON_CATALOG_CHANGED';
  end if;

  update public.tenant_settings
  set settings = jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_settings,
    '{system_prompt}', to_jsonb(v_new)), '{business_facts,address}', to_jsonb(v_address)),
    '{prompt_revision}', to_jsonb(v_revision)),
    '{price_rejection_template}', to_jsonb(v_price_fallback)), updated_at = now()
  where tenant_id = v_tid;
end
$do$;
