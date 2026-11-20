-- Migration: 20261120200000_product_catalog.sql
-- Catálogo canônico de produtos por tenant, com origens rastreáveis e imagens autorizadas.
-- Primeiro uso: JOYERÍA (alianças blend do PDF e produtos do site). Estrutura genérica: nenhum
-- tenant, produto ou regra comercial é fixado aqui.
--
-- PENDENTE DE REVISÃO: não aplicar em produção sem autorização explícita.
-- Rollback: 20261120200000_product_catalog.rollback.sql (recusa apagar tabelas com dados).
--
-- Decisões de modelagem:
-- * Toda tabela tem tenant_id e as FKs entre tabelas são compostas (tenant_id, id): uma linha
--   nunca referencia item ou imagem de outro tenant, mesmo conhecendo o UUID.
-- * Preço em centavos inteiros; NULL significa desconhecido (zero não vira "sob consulta").
-- * Composição tipada; 'desconhecido' é explícito e nunca conta como alto padrão.
-- * Disponibilidade separada de "ativo": produto ativo não significa estoque.
-- * Arquivo de imagem (asset) separado do vínculo com o item: a mesma foto pode servir a mais de
--   uma variante sem duplicar o arquivo (caso Prisma 5 mm e 6 mm do PDF da JOYERÍA).
-- * FKs com ON DELETE RESTRICT: dado comercial sai por desativação, não por cascata.
-- * Leitura no painel apenas para membros ativos do tenant; escrita só pelo service_role
--   (importador e workflows). Os privilégios padrão do schema public concedem ALL a anon e
--   authenticated em tabelas novas, por isso o REVOKE explícito.

BEGIN;

-- 1. Itens comerciais (produto ou variante ofertável)
CREATE TABLE public.product_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  item_code text NOT NULL,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  product_line text,
  model text,
  width_mm numeric(5,2),
  sale_unit text NOT NULL,
  material_class text NOT NULL DEFAULT 'desconhecido',
  material_evidence text,
  price_cents bigint,
  currency text NOT NULL DEFAULT 'BRL',
  price_status text NOT NULL DEFAULT 'nao_informado',
  price_source text,
  price_valid_from date,
  price_valid_until date,
  availability text NOT NULL DEFAULT 'desconhecida',
  availability_checked_at timestamptz,
  site_url text,
  offerable boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_catalog_items_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_product_catalog_items_code UNIQUE (tenant_id, item_code),
  CONSTRAINT ck_product_catalog_items_code CHECK (item_code ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  CONSTRAINT ck_product_catalog_items_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT ck_product_catalog_items_category CHECK (length(btrim(category)) BETWEEN 1 AND 80),
  CONSTRAINT ck_product_catalog_items_width CHECK (width_mm IS NULL OR width_mm > 0),
  CONSTRAINT ck_product_catalog_items_unit CHECK (sale_unit IN ('par', 'unidade', 'conjunto')),
  CONSTRAINT ck_product_catalog_items_material CHECK (material_class IN (
    'ouro_macico', 'material_nobre', 'blend', 'banhado_revestido', 'prata', 'aco', 'outro', 'desconhecido')),
  -- Classificação diferente de "desconhecido" precisa dizer de onde veio.
  CONSTRAINT ck_product_catalog_items_material_evidence CHECK (
    material_class = 'desconhecido' OR length(btrim(coalesce(material_evidence, ''))) > 0),
  CONSTRAINT ck_product_catalog_items_price CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT ck_product_catalog_items_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_product_catalog_items_price_status CHECK (price_status IN ('aprovado', 'pendente_revisao', 'nao_informado')),
  -- Preço aprovado exige valor e origem; sem valor, o status é obrigatoriamente "não informado".
  CONSTRAINT ck_product_catalog_items_price_consistency CHECK (
    (price_cents IS NULL AND price_status = 'nao_informado')
    OR (price_cents IS NOT NULL AND price_status <> 'nao_informado'
        AND (price_status <> 'aprovado' OR length(btrim(coalesce(price_source, ''))) > 0))),
  CONSTRAINT ck_product_catalog_items_price_validity CHECK (
    price_valid_until IS NULL OR price_valid_from IS NULL OR price_valid_until >= price_valid_from),
  CONSTRAINT ck_product_catalog_items_availability CHECK (
    availability IN ('desconhecida', 'disponivel', 'indisponivel', 'sob_encomenda')),
  CONSTRAINT ck_product_catalog_items_site_url CHECK (
    site_url IS NULL OR (site_url ~ '^https://[^/\s]+/\S*$' AND length(site_url) <= 500)),
  -- Só se oferta item ativo, com preço aprovado.
  CONSTRAINT ck_product_catalog_items_offerable CHECK (
    NOT offerable OR (active AND price_status = 'aprovado')),
  CONSTRAINT ck_product_catalog_items_metadata CHECK (jsonb_typeof(metadata) = 'object')
);

COMMENT ON TABLE public.product_catalog_items IS
  'Catálogo canônico por tenant: um item comercial (produto ou variante) com preço em centavos, composição tipada e disponibilidade independente de ativo.';
COMMENT ON COLUMN public.product_catalog_items.offerable IS
  'A IA só pode oferecer o item quando true: ativo e com preço aprovado.';
COMMENT ON COLUMN public.product_catalog_items.material_class IS
  'Composição comprovada. desconhecido nunca é tratado como alto padrão.';

CREATE INDEX idx_product_catalog_items_offer
  ON public.product_catalog_items (tenant_id, category, product_line)
  WHERE active AND offerable;

-- 2. Origens de cada item (PDF, site, cadastro manual), para conciliação e auditoria
CREATE TABLE public.product_catalog_item_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  source_url text,
  captured_at timestamptz NOT NULL,
  reconciliation_status text NOT NULL DEFAULT 'pendente',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_product_catalog_item_sources_item FOREIGN KEY (tenant_id, item_id)
    REFERENCES public.product_catalog_items (tenant_id, id) ON DELETE RESTRICT,
  -- Uma mesma origem (ex.: página do PDF ou ID do site) aponta para um único item.
  CONSTRAINT uq_product_catalog_item_sources_ref UNIQUE (tenant_id, source_type, source_ref),
  CONSTRAINT ck_product_catalog_item_sources_type CHECK (source_type IN ('pdf', 'site', 'manual')),
  CONSTRAINT ck_product_catalog_item_sources_ref CHECK (length(btrim(source_ref)) BETWEEN 1 AND 200),
  CONSTRAINT ck_product_catalog_item_sources_url CHECK (
    source_url IS NULL OR (source_url ~ '^https://[^/\s]+/\S*$' AND length(source_url) <= 500)),
  CONSTRAINT ck_product_catalog_item_sources_status CHECK (
    reconciliation_status IN ('confirmado', 'provavel', 'divergente', 'pendente')),
  CONSTRAINT ck_product_catalog_item_sources_payload CHECK (jsonb_typeof(payload) = 'object')
);

COMMENT ON TABLE public.product_catalog_item_sources IS
  'Proveniência de cada item do catálogo (PDF, site ou manual) e estado da conciliação entre fontes.';

CREATE INDEX idx_product_catalog_item_sources_item
  ON public.product_catalog_item_sources (tenant_id, item_id);

-- 3. Arquivos de imagem no Storage (um registro por arquivo, deduplicado por hash)
CREATE TABLE public.product_catalog_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  storage_bucket text NOT NULL DEFAULT 'product-catalog',
  storage_path text NOT NULL,
  public_url text NOT NULL,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes integer NOT NULL,
  width integer,
  height integer,
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_catalog_assets_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_product_catalog_assets_path UNIQUE (tenant_id, storage_bucket, storage_path),
  CONSTRAINT uq_product_catalog_assets_sha256 UNIQUE (tenant_id, sha256),
  CONSTRAINT ck_product_catalog_assets_bucket CHECK (storage_bucket = 'product-catalog'),
  -- Caminho sempre dentro da pasta do próprio tenant, sem travessia de diretório.
  CONSTRAINT ck_product_catalog_assets_path CHECK (
    storage_path LIKE 'catalog/' || tenant_id::text || '/%'
    AND storage_path !~ '(^|/)\.\.?(/|$)'
    AND storage_path !~ '[%?#[:space:]\\]'
    AND length(storage_path) <= 300),
  -- A URL pública precisa apontar exatamente para o objeto registrado.
  CONSTRAINT ck_product_catalog_assets_url CHECK (
    public_url ~ '^https://[^/\s]+/storage/v1/object/public/'
    AND right(public_url, length('/storage/v1/object/public/' || storage_bucket || '/' || storage_path))
      = '/storage/v1/object/public/' || storage_bucket || '/' || storage_path),
  CONSTRAINT ck_product_catalog_assets_sha256 CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_product_catalog_assets_mime CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT ck_product_catalog_assets_size CHECK (file_size_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT ck_product_catalog_assets_dimensions CHECK (
    (width IS NULL OR width > 0) AND (height IS NULL OR height > 0))
);

COMMENT ON TABLE public.product_catalog_assets IS
  'Arquivos de imagem do catálogo no bucket product-catalog, um por hash e tenant.';

-- 4. Vínculo item ↔ imagem (ordem, principal e revisão)
CREATE TABLE public.product_catalog_item_images (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  display_order integer NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'pendente',
  shared_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_product_catalog_item_images PRIMARY KEY (tenant_id, item_id, asset_id),
  CONSTRAINT fk_product_catalog_item_images_item FOREIGN KEY (tenant_id, item_id)
    REFERENCES public.product_catalog_items (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_product_catalog_item_images_asset FOREIGN KEY (tenant_id, asset_id)
    REFERENCES public.product_catalog_assets (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT uq_product_catalog_item_images_order UNIQUE (tenant_id, item_id, display_order),
  CONSTRAINT ck_product_catalog_item_images_order CHECK (display_order >= 0),
  CONSTRAINT ck_product_catalog_item_images_review CHECK (review_status IN ('aprovada', 'pendente', 'rejeitada'))
);

COMMENT ON TABLE public.product_catalog_item_images IS
  'Liga cada item às suas imagens. Só imagens aprovadas podem ser enviadas ao cliente.';
COMMENT ON COLUMN public.product_catalog_item_images.shared_note IS
  'Explica quando a mesma foto ilustra mais de uma variante (ex.: larguras diferentes).';

CREATE UNIQUE INDEX uq_product_catalog_item_images_primary
  ON public.product_catalog_item_images (tenant_id, item_id) WHERE is_primary;
CREATE INDEX idx_product_catalog_item_images_asset
  ON public.product_catalog_item_images (tenant_id, asset_id);

-- 5. Gatilhos: updated_at e tenant_id imutável (mesmas funções usadas em channels e tenant_service_catalog)
CREATE TRIGGER trg_product_catalog_items_touch BEFORE UPDATE ON public.product_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_product_catalog_items_tenant BEFORE UPDATE ON public.product_catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reparent();
CREATE TRIGGER trg_product_catalog_item_sources_touch BEFORE UPDATE ON public.product_catalog_item_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_product_catalog_item_sources_tenant BEFORE UPDATE ON public.product_catalog_item_sources
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reparent();
CREATE TRIGGER trg_product_catalog_assets_touch BEFORE UPDATE ON public.product_catalog_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_product_catalog_assets_tenant BEFORE UPDATE ON public.product_catalog_assets
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reparent();
CREATE TRIGGER trg_product_catalog_item_images_touch BEFORE UPDATE ON public.product_catalog_item_images
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_product_catalog_item_images_tenant BEFORE UPDATE ON public.product_catalog_item_images
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_reparent();

-- 6. Privilégios e RLS: leitura por membro ativo do tenant; escrita só por service_role.
ALTER TABLE public.product_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog_item_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_catalog_item_images ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.product_catalog_items, public.product_catalog_item_sources,
  public.product_catalog_assets, public.product_catalog_item_images FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_catalog_items, public.product_catalog_item_sources,
  public.product_catalog_assets, public.product_catalog_item_images TO authenticated;
GRANT ALL ON public.product_catalog_items, public.product_catalog_item_sources,
  public.product_catalog_assets, public.product_catalog_item_images TO service_role;

-- Uma única política por tabela e comando, para não somar regras permissivas por OR.
CREATE POLICY product_catalog_items_member_read ON public.product_catalog_items
  FOR SELECT TO authenticated USING (public.is_active_tenant_member(tenant_id));
CREATE POLICY product_catalog_item_sources_member_read ON public.product_catalog_item_sources
  FOR SELECT TO authenticated USING (public.is_active_tenant_member(tenant_id));
CREATE POLICY product_catalog_assets_member_read ON public.product_catalog_assets
  FOR SELECT TO authenticated USING (public.is_active_tenant_member(tenant_id));
CREATE POLICY product_catalog_item_images_member_read ON public.product_catalog_item_images
  FOR SELECT TO authenticated USING (public.is_active_tenant_member(tenant_id));

COMMIT;
