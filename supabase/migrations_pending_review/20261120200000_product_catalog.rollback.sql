-- Rollback: 20261120200000_product_catalog.sql
-- Remove as tabelas do catálogo de produtos SOMENTE se estiverem vazias.
-- Com dados carregados, o rollback recusa: desative itens (active = false, offerable = false)
-- ou exporte os dados antes; nunca apagar catálogo de cliente por engano.
-- Objetos do Storage não são removidos aqui; inventariar e remover pela API de Storage.

BEGIN;

DO $$
DECLARE
  total bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM public.product_catalog_item_images)
    + (SELECT count(*) FROM public.product_catalog_item_sources)
    + (SELECT count(*) FROM public.product_catalog_assets)
    + (SELECT count(*) FROM public.product_catalog_items)
  INTO total;
  IF total > 0 THEN
    RAISE EXCEPTION 'Rollback recusado: o catálogo de produtos tem % linha(s). Exporte ou desative antes.', total
      USING ERRCODE = '55000';
  END IF;
END $$;

DROP TABLE public.product_catalog_item_images;
DROP TABLE public.product_catalog_item_sources;
DROP TABLE public.product_catalog_assets;
DROP TABLE public.product_catalog_items;

COMMIT;
