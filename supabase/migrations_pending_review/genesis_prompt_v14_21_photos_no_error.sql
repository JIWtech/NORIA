-- SUBSTITUÍDA por genesis_prompt_v14_22_photo_flow.sql (aplicada em 21/10/2026, 19h49). NÃO APLICAR.
-- Gênesis (wesley_automoveis) — prompt v14.21: fotos naturais e nenhuma menção a erro ao cliente.
-- APLICAR SOMENTE DEPOIS de publicar o CORE com a revisão que aceita reply vazio em turno só de foto
-- (salesValidatePrimaryDialogue: photoAnswersTurn). Com o CORE antigo, reply vazio vira INVALID_PRIMARY_REPLY.
-- Guarda o prompt atual em prompt_snapshot_before_v14_21 e falha se o trecho esperado não existir.

begin;

do $$
declare
  t uuid;
  old_photos text := 'FOTOS E MÍDIAS
Quando o cliente pedir foto de um veículo identificado, a imagem pode ser a resposta; se houver texto, que seja curto, natural e útil, sem “Aqui está a foto…” nem “Segue a imagem” por reflexo.';
  new_photos text := 'FOTOS E MÍDIAS
Quando o cliente pedir foto de um veículo identificado e houver imagem autorizada, a própria foto é a resposta: deixe reply vazio, ou escreva só algo que acrescente à conversa (um detalhe oficial relevante desse veículo ou uma pergunta curta sobre o interesse do cliente). Nunca escreva frases de entrega como “segue a foto”, “aqui está”, “olha ela aqui” ou “para você conferir”. Se o cliente pedir foto de OUTRO veículo, trate o novo veículo como foco da resposta, sem misturar fatos do anterior. Se a referência (“essa 4”, “a outra”) não identificar um único veículo, pergunte qual, de forma curta.';
  old_contract text := 'Se a validação rejeitar uma resposta, reformule a partir dos fatos autorizados, sem trocar a dúvida do cliente por menu ou fallback genérico.';
  new_contract text := 'Se a validação rejeitar uma resposta, reformule a partir dos fatos autorizados, sem trocar a dúvida do cliente por menu ou fallback genérico. Nunca mencione erro, instabilidade, sistema ou validação, e nunca peça para o cliente repetir a mensagem: se faltar uma informação, diga com naturalidade que ela não está confirmada.';
  current_prompt text;
begin
  select id into t from public.tenants where slug = 'wesley_automoveis';
  if t is null then raise exception 'TENANT_NOT_FOUND'; end if;
  select settings->>'system_prompt' into current_prompt from public.tenant_settings where tenant_id = t for update;
  if position(old_photos in current_prompt) = 0 then raise exception 'PROMPT_PHOTOS_SECTION_CHANGED'; end if;
  if position(old_contract in current_prompt) = 0 then raise exception 'PROMPT_CONTRACT_SECTION_CHANGED'; end if;

  update public.tenant_settings
  set settings = settings
    || jsonb_build_object(
      'prompt_snapshot_before_v14_21', jsonb_build_object(
        'revision', settings->>'prompt_revision', 'captured_at', now(), 'system_prompt', settings->>'system_prompt'),
      'system_prompt', replace(replace(replace(current_prompt, old_photos, new_photos), old_contract, new_contract),
        'SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.20', 'SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.21'),
      'prompt_revision', 'wesley-sales-v14.21-photos-no-error-2026-10-21')
  where tenant_id = t;
end $$;

commit;

-- Rollback:
-- update public.tenant_settings s set settings = settings
--   || jsonb_build_object('system_prompt', settings#>>'{prompt_snapshot_before_v14_21,system_prompt}',
--                         'prompt_revision', settings#>>'{prompt_snapshot_before_v14_21,revision}')
-- from public.tenants t where t.id = s.tenant_id and t.slug = 'wesley_automoveis';
