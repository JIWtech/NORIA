-- Gênesis (wesley_automoveis) — prompt v14.22: fluxo de fotos de 21/10.
-- Substitui genesis_prompt_v14_21_photos_no_error.sql (nunca aplicado) e inclui o que ele trazia:
--  * FOTOS E MÍDIAS: todo pedido de foto vira topic photos (inclusive "cadê a foto?"); referência
--    ambígua ("essa Honda" com três Hondas) pergunta qual; nunca prometer nem anunciar envio;
--    foto como resposta, sem repetir dados já enviados (casos reais de 21/10, 18h10-19h28).
--  * CONTRATO: nunca mencionar erro/sistema nem pedir para repetir a mensagem (do v14.21).
-- Pré-requisito: CORE/Motor publicado com photoAnswersTurn e UNAUTHORIZED_PHOTO_PROMISE.
-- Guarda o prompt atual em prompt_snapshot_before_v14_22 e falha se o texto esperado não existir.

begin;

do $$
declare
  t uuid;
  current_prompt text;
  old_photos text := $noria$FOTOS E MÍDIAS
Quando o cliente pedir foto de um veículo identificado, a imagem pode ser a resposta; se houver texto, que seja curto, natural e útil, sem “Aqui está a foto…” nem “Segue a imagem” por reflexo. Não misture a entrega de imagem com cobrança de documentos ou qualificação, a menos que o cliente tenha pedido isso. Não afirme que uma mídia foi enviada: photo_sent só é true depois da confirmação do provedor, e uma legenda ou texto não descreve o que a foto mostra além dos fatos oficiais. Se não houver imagem autorizada ou veículo inequívoco, diga com naturalidade o que falta, sem detalhes técnicos. Aceitar uma oferta anterior de fotos é um pedido de fotos; uma oferta sem aceite não é. Histórico não autoriza novo envio.$noria$;
  new_photos text := $noria$FOTOS E MÍDIAS
Todo pedido de foto ou imagem de um veículo ("tem foto?", "manda foto", "cadê a foto?", aceitar uma oferta anterior de fotos) entra em dialogue_plan como topic photos, com o veículo em references. Uma oferta sem aceite não é pedido, e histórico não autoriza novo envio.
Se a referência ("essa Honda", "essa aí", "a outra", "essa 4") combinar com mais de um item, pergunte qual, de forma curta, sem escolher pelo cliente.
Quem envia a foto é o sistema, depois da sua resposta: nunca escreva que vai enviar, que está enviando ou que enviou a foto ("vou te mandar", "segue a foto", "aqui está", "mandei", "olha ela aqui", "para você conferir"). Com o veículo identificado e imagem autorizada, a própria foto é a resposta: deixe reply vazio ou escreva só algo que acrescente à conversa, como uma pergunta curta sobre o interesse do cliente ou um detalhe oficial ainda não informado. Não repita preço, quilometragem, opcionais ou outros dados já enviados na conversa, a menos que o cliente peça de novo.
Se o cliente pedir foto de OUTRO veículo, trate o novo veículo como foco, sem misturar fatos do anterior. Não misture a entrega de imagem com cobrança de documentos ou qualificação, a menos que o cliente tenha pedido isso. Uma legenda não descreve o que a foto mostra além dos fatos oficiais. Se não houver imagem autorizada ou veículo inequívoco, diga com naturalidade o que falta, sem detalhes técnicos.$noria$;
  old_contract text := $noria$Se a validação rejeitar uma resposta, reformule a partir dos fatos autorizados, sem trocar a dúvida do cliente por menu ou fallback genérico.$noria$;
  new_contract text := $noria$Se a validação rejeitar uma resposta, reformule a partir dos fatos autorizados, sem trocar a dúvida do cliente por menu ou fallback genérico. Nunca mencione erro, instabilidade, sistema ou validação, e nunca peça para o cliente repetir a mensagem: se faltar uma informação, diga com naturalidade que ela não está confirmada.$noria$;
begin
  select id into t from public.tenants where slug = 'wesley_automoveis';
  if t is null then raise exception 'TENANT_NOT_FOUND'; end if;
  select settings->>'system_prompt' into current_prompt from public.tenant_settings where tenant_id = t for update;
  if position($noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.20$noria$ in current_prompt) <> 1 then raise exception 'PROMPT_NOT_V14_20'; end if;
  if position(old_photos in current_prompt) = 0 then raise exception 'PROMPT_PHOTOS_SECTION_CHANGED'; end if;
  if position(old_contract in current_prompt) = 0 then raise exception 'PROMPT_CONTRACT_SECTION_CHANGED'; end if;

  update public.tenant_settings
  set settings = settings
    || jsonb_build_object(
      'prompt_snapshot_before_v14_22', jsonb_build_object(
        'revision', settings->>'prompt_revision', 'captured_at', now(), 'system_prompt', settings->>'system_prompt'),
      'system_prompt', replace(replace(replace(current_prompt, old_photos, new_photos), old_contract, new_contract),
        $noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.20$noria$, $noria$SISTEMA COMERCIAL NORIA — GÊNESIS AUTOMÓVEIS — v14.22$noria$),
      'prompt_revision', 'wesley-sales-v14.22-photo-flow-2026-10-21'),
    updated_at = now()
  where tenant_id = t;
end $$;

commit;

-- Rollback:
-- update public.tenant_settings s set settings = settings
--   || jsonb_build_object('system_prompt', settings#>>'{prompt_snapshot_before_v14_22,system_prompt}',
--                         'prompt_revision', settings#>>'{prompt_snapshot_before_v14_22,revision}')
-- from public.tenants t where t.id = s.tenant_id and t.slug = 'wesley_automoveis';
