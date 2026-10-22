-- Gênesis (wesley_automoveis) — prompt v14.24: ano obrigatório na venda direta.
-- A loja não compra veículos anteriores a sdr_rules.minimum_purchase_year (1995): sem o ano a política
-- não pode ser aplicada. Se o cliente não souber o ano, a EXT passa a conversa a um atendente (lead frio).
-- Troca/entrada não muda: restrições de ano e marca não valem para veículo dado de entrada.
-- Guarda o prompt atual em prompt_snapshot_before_v14_24 e falha se o texto esperado não existir.

begin;

do $$
declare
  t uuid;
  current_prompt text;
  old_sentence text := $noria$Pré-avaliação REMOTA: modelo, ano se necessário, uma foto e um fato de manutenção OU condição/avarias; “quero vender” não basta.$noria$;
  new_sentence text := $noria$Pré-avaliação REMOTA: modelo, ano, uma foto e um fato de manutenção OU condição/avarias; “quero vender” não basta. Na venda direta peça sempre o ano, junto com o modelo quando couber; se o cliente não souber o ano, não insista nem estime: o sistema passa a conversa para um atendente.$noria$;
begin
  select id into t from public.tenants where slug = 'wesley_automoveis';
  if t is null then raise exception 'TENANT_NOT_FOUND'; end if;
  select settings->>'system_prompt' into current_prompt from public.tenant_settings where tenant_id = t for update;
  if position($noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.23$noria$ in current_prompt) <> 1 then raise exception 'PROMPT_NOT_V14_23'; end if;
  if position(old_sentence in current_prompt) = 0 then raise exception 'PROMPT_APPRAISAL_SENTENCE_CHANGED'; end if;

  update public.tenant_settings
  set settings = settings
    || jsonb_build_object(
      'prompt_snapshot_before_v14_24', jsonb_build_object(
        'revision', settings->>'prompt_revision', 'captured_at', now(), 'system_prompt', settings->>'system_prompt'),
      'system_prompt', replace(replace(current_prompt, old_sentence, new_sentence),
        $noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.23$noria$, $noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.24$noria$),
      'prompt_revision', 'wesley-sales-v14.24-sale-year-2026-10-21'),
    updated_at = now()
  where tenant_id = t;
end $$;

commit;

-- Rollback:
-- update public.tenant_settings s set settings = settings
--   || jsonb_build_object('system_prompt', settings#>>'{prompt_snapshot_before_v14_24,system_prompt}',
--                         'prompt_revision', settings#>>'{prompt_snapshot_before_v14_24,revision}')
-- from public.tenants t where t.id = s.tenant_id and t.slug = 'wesley_automoveis';
