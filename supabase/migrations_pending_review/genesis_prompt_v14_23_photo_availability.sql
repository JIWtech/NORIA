-- Gênesis (wesley_automoveis) — prompt v14.23: o modelo não afirma disponibilidade de foto.
-- Caso real de 21/10 21h13: a foto da Tornado foi autorizada e enviada, mas o texto dizia que as fotos
-- "não estão disponíveis". O modelo escreve ANTES de a EXT autorizar a imagem, então não sabe se ela sai.
-- Pré-requisito: Motor com PHOTO_AVAILABILITY_CONTRADICTION (o CORE barra a contradição de qualquer forma).
-- Guarda o prompt atual em prompt_snapshot_before_v14_23 e falha se o texto esperado não existir.

begin;

do $$
declare
  t uuid;
  current_prompt text;
  old_sentence text := $noria$Se não houver imagem autorizada ou veículo inequívoco, diga com naturalidade o que falta, sem detalhes técnicos.$noria$;
  new_sentence text := $noria$Você escreve antes de o sistema decidir se a imagem pode ser enviada: nunca diga que a foto está ou não está disponível. Se o veículo não for inequívoco, pergunte qual.$noria$;
begin
  select id into t from public.tenants where slug = 'wesley_automoveis';
  if t is null then raise exception 'TENANT_NOT_FOUND'; end if;
  select settings->>'system_prompt' into current_prompt from public.tenant_settings where tenant_id = t for update;
  if position($noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.22$noria$ in current_prompt) <> 1 then raise exception 'PROMPT_NOT_V14_22'; end if;
  if position(old_sentence in current_prompt) = 0 then raise exception 'PROMPT_PHOTOS_SENTENCE_CHANGED'; end if;

  update public.tenant_settings
  set settings = settings
    || jsonb_build_object(
      'prompt_snapshot_before_v14_23', jsonb_build_object(
        'revision', settings->>'prompt_revision', 'captured_at', now(), 'system_prompt', settings->>'system_prompt'),
      'system_prompt', replace(replace(current_prompt, old_sentence, new_sentence),
        $noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.22$noria$, $noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.23$noria$),
      'prompt_revision', 'wesley-sales-v14.23-photo-availability-2026-10-21'),
    updated_at = now()
  where tenant_id = t;
end $$;

commit;

-- Rollback:
-- update public.tenant_settings s set settings = settings
--   || jsonb_build_object('system_prompt', settings#>>'{prompt_snapshot_before_v14_23,system_prompt}',
--                         'prompt_revision', settings#>>'{prompt_snapshot_before_v14_23,revision}')
-- from public.tenants t where t.id = s.tenant_id and t.slug = 'wesley_automoveis';
