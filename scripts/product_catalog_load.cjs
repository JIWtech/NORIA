#!/usr/bin/env node
'use strict';
// Gera SQL idempotente de carga do catálogo de produtos (migration 20261120200000_product_catalog).
//
// Entrada: uma especificação JSON normalizada (ver validateSpec). Saída: um script SQL que roda numa
// única transação, resolve o tenant pelo slug (nunca por UUID fixo), faz upsert apenas das linhas
// marcadas como gerenciadas por esta carga (metadata.managed_by), desativa itens gerenciados que
// saíram da especificação e verifica o resultado antes do COMMIT. Qualquer divergência aborta tudo.
//
// O script não acessa banco nem Storage. Executar o SQL em produção exige autorização explícita.
// Uso: node scripts/product_catalog_load.cjs <spec.json> <saida.sql>

const fs = require('node:fs');

const ITEM_CODE = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const HTTPS_URL = /^https:\/\/[^/\s]+\/\S*$/;
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ENUMS = {
  sale_unit: ['par', 'unidade', 'conjunto'],
  material_class: ['ouro_macico', 'material_nobre', 'blend', 'banhado_revestido', 'prata', 'aco', 'outro', 'desconhecido'],
  price_status: ['aprovado', 'pendente_revisao', 'nao_informado'],
  availability: ['desconhecida', 'disponivel', 'indisponivel', 'sob_encomenda'],
  source_type: ['pdf', 'site', 'manual'],
  reconciliation_status: ['confirmado', 'provavel', 'divergente', 'pendente'],
  review_status: ['aprovada', 'pendente', 'rejeitada'],
};

function fail(message) { throw new Error('Especificação inválida: ' + message); }
function text(value, field, { required = true, max = 4000 } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) fail(field + ' é obrigatório');
    return null;
  }
  if (typeof value !== 'string' || value.includes('\u0000') || value.length > max) fail(field + ' deve ser texto de até ' + max + ' caracteres');
  return value;
}
function oneOf(value, field) { if (!ENUMS[field].includes(value)) fail(field + ' inválido: ' + value); return value; }

// Valida e normaliza a especificação; tudo que não for reconhecido é rejeitado.
function validateSpec(spec) {
  if (!spec || typeof spec !== 'object') fail('objeto ausente');
  if (!SLUG.test(spec.tenant_slug || '')) fail('tenant_slug');
  if (!ITEM_CODE.test(spec.managed_by || '')) fail('managed_by');
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(spec.storage_base_url || '')) fail('storage_base_url deve ser a origem https do projeto, sem barra final');
  const items = (spec.items || []).map((item, index) => {
    const at = 'items[' + index + ']';
    if (!ITEM_CODE.test(item.item_code || '')) fail(at + '.item_code');
    const price = item.price_cents ?? null;
    if (price !== null && (!Number.isSafeInteger(price) || price < 0)) fail(at + '.price_cents deve ser inteiro >= 0');
    const width = item.width_mm ?? null;
    if (width !== null && !(typeof width === 'number' && Number.isFinite(width) && width > 0 && width < 1000)) fail(at + '.width_mm');
    if (item.site_url && !HTTPS_URL.test(item.site_url)) fail(at + '.site_url');
    if (item.metadata !== undefined && (typeof item.metadata !== 'object' || Array.isArray(item.metadata) || item.metadata === null)) fail(at + '.metadata');
    return {
      item_code: item.item_code,
      name: text(item.name, at + '.name', { max: 200 }),
      description: text(item.description, at + '.description', { required: false }),
      category: text(item.category, at + '.category', { max: 80 }),
      product_line: text(item.product_line, at + '.product_line', { required: false, max: 120 }),
      model: text(item.model, at + '.model', { required: false, max: 120 }),
      width_mm: width,
      sale_unit: oneOf(item.sale_unit, 'sale_unit'),
      material_class: oneOf(item.material_class || 'desconhecido', 'material_class'),
      material_evidence: text(item.material_evidence, at + '.material_evidence', { required: false, max: 500 }),
      price_cents: price,
      currency: item.currency || 'BRL',
      price_status: oneOf(item.price_status || 'nao_informado', 'price_status'),
      price_source: text(item.price_source, at + '.price_source', { required: false, max: 300 }),
      availability: oneOf(item.availability || 'desconhecida', 'availability'),
      site_url: item.site_url || null,
      offerable: item.offerable === true,
      active: item.active !== false,
      metadata: { ...(item.metadata || {}), managed_by: spec.managed_by },
    };
  });
  const codes = new Set();
  for (const item of items) { if (codes.has(item.item_code)) fail('item_code repetido: ' + item.item_code); codes.add(item.item_code); }

  const sources = (spec.sources || []).map((source, index) => {
    const at = 'sources[' + index + ']';
    if (!codes.has(source.item_code)) fail(at + '.item_code sem item correspondente');
    if (source.source_url && !HTTPS_URL.test(source.source_url)) fail(at + '.source_url');
    if (Number.isNaN(Date.parse(source.captured_at || ''))) fail(at + '.captured_at');
    return {
      item_code: source.item_code,
      source_type: oneOf(source.source_type, 'source_type'),
      source_ref: text(source.source_ref, at + '.source_ref', { max: 200 }),
      source_url: source.source_url || null,
      captured_at: new Date(source.captured_at).toISOString(),
      reconciliation_status: oneOf(source.reconciliation_status || 'pendente', 'reconciliation_status'),
      payload: source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload) ? source.payload : {},
    };
  });
  const sourceKeys = new Set();
  for (const s of sources) {
    const key = s.source_type + '|' + s.source_ref;
    if (sourceKeys.has(key)) fail('origem repetida: ' + key);
    sourceKeys.add(key);
  }

  const assets = (spec.assets || []).map((asset, index) => {
    const at = 'assets[' + index + ']';
    if (!SHA256.test(asset.sha256 || '')) fail(at + '.sha256');
    if (!MIME_EXT[asset.mime_type]) fail(at + '.mime_type');
    if (!Number.isSafeInteger(asset.file_size_bytes) || asset.file_size_bytes < 1 || asset.file_size_bytes > 10485760) fail(at + '.file_size_bytes');
    return { sha256: asset.sha256, mime_type: asset.mime_type, file_size_bytes: asset.file_size_bytes,
      source_ref: text(asset.source_ref, at + '.source_ref', { required: false, max: 300 }) };
  });
  const hashes = new Set();
  for (const a of assets) { if (hashes.has(a.sha256)) fail('asset repetido: ' + a.sha256); hashes.add(a.sha256); }

  const itemImages = (spec.item_images || []).map((link, index) => {
    const at = 'item_images[' + index + ']';
    if (!codes.has(link.item_code)) fail(at + '.item_code sem item');
    if (!hashes.has(link.asset_sha256)) fail(at + '.asset_sha256 sem asset');
    if (!Number.isSafeInteger(link.display_order) || link.display_order < 0) fail(at + '.display_order');
    return { item_code: link.item_code, asset_sha256: link.asset_sha256, display_order: link.display_order,
      is_primary: link.is_primary === true, review_status: oneOf(link.review_status || 'pendente', 'review_status'),
      shared_note: text(link.shared_note, at + '.shared_note', { required: false, max: 500 }) };
  });
  const linkKeys = new Set(), orderKeys = new Set(), primary = new Set();
  for (const l of itemImages) {
    const key = l.item_code + '|' + l.asset_sha256, order = l.item_code + '|' + l.display_order;
    if (linkKeys.has(key)) fail('vínculo repetido: ' + key);
    if (orderKeys.has(order)) fail('ordem repetida: ' + order);
    if (l.is_primary && primary.has(l.item_code)) fail('mais de uma imagem principal: ' + l.item_code);
    linkKeys.add(key); orderKeys.add(order); if (l.is_primary) primary.add(l.item_code);
  }
  return { tenant_slug: spec.tenant_slug, managed_by: spec.managed_by, storage_base_url: spec.storage_base_url,
    items, sources, assets, item_images: itemImages };
}

// Literal SQL seguro (standard_conforming_strings = on, padrão do Postgres).
function lit(value, type) {
  if (value === null || value === undefined) return 'NULL::' + type;
  if (type === 'jsonb') return lit(JSON.stringify(value), 'text') + '::jsonb';
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'bigint' || type === 'integer' || type === 'numeric') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('número inválido');
    return String(value) + '::' + type;
  }
  const s = String(value);
  if (s.includes('\u0000')) throw new Error('texto com NUL');
  return "'" + s.replace(/'/g, "''") + "'::" + type;
}
const rows = (list, columns) => list.map(row => '  (' + columns.map(([key, type]) => lit(row[key], type)).join(', ') + ')').join(',\n');

function storagePathSql(sha, mime) {
  return "'catalog/' || t.id::text || '/' || " + lit(sha, 'text') + " || '." + MIME_EXT[mime] + "'";
}

function buildCatalogLoadSql(rawSpec) {
  const spec = validateSpec(rawSpec);
  const slug = lit(spec.tenant_slug, 'text');
  const managed = lit(spec.managed_by, 'text');
  const itemCols = [['item_code', 'text'], ['name', 'text'], ['description', 'text'], ['category', 'text'], ['product_line', 'text'],
    ['model', 'text'], ['width_mm', 'numeric'], ['sale_unit', 'text'], ['material_class', 'text'], ['material_evidence', 'text'],
    ['price_cents', 'bigint'], ['currency', 'text'], ['price_status', 'text'], ['price_source', 'text'], ['availability', 'text'],
    ['site_url', 'text'], ['offerable', 'boolean'], ['active', 'boolean'], ['metadata', 'jsonb']];
  const names = itemCols.map(([k]) => k);
  const updatable = names.filter(k => k !== 'item_code');
  const out = [];
  out.push('-- Carga gerada por scripts/product_catalog_load.cjs. Não editar à mão: regenerar a partir da especificação.');
  out.push('-- Tenant: ' + spec.tenant_slug + ' | managed_by: ' + spec.managed_by + ' | itens: ' + spec.items.length
    + ' | origens: ' + spec.sources.length + ' | imagens: ' + spec.assets.length + ' | vínculos: ' + spec.item_images.length);
  out.push('-- Pré-requisito: objetos já enviados ao bucket product-catalog nos caminhos catalog/<tenant_id>/<sha256>.<ext>.');
  out.push('-- Idempotente: reexecutar sem mudanças não altera dados. Linhas não gerenciadas por esta carga nunca são sobrescritas.');
  out.push('BEGIN;');
  out.push('SET LOCAL lock_timeout = \'5s\';');
  out.push('CREATE TEMP TABLE _pc_tenant ON COMMIT DROP AS SELECT id FROM public.tenants WHERE slug = ' + slug + ';');
  out.push("DO $$ BEGIN IF (SELECT count(*) FROM _pc_tenant) <> 1 THEN RAISE EXCEPTION 'Tenant da carga não encontrado'; END IF; END $$;");

  if (spec.items.length) {
    out.push('\n-- Itens: insere novos; atualiza só os gerenciados por esta carga.');
    out.push('INSERT INTO public.product_catalog_items (tenant_id, ' + names.join(', ') + ')');
    out.push('SELECT t.id, v.* FROM _pc_tenant t CROSS JOIN (VALUES\n' + rows(spec.items, itemCols) + '\n) AS v(' + names.join(', ') + ')');
    out.push('ON CONFLICT (tenant_id, item_code) DO UPDATE SET ' + updatable.map(k => k + ' = EXCLUDED.' + k).join(', '));
    out.push("WHERE product_catalog_items.metadata->>'managed_by' = " + managed);
    out.push('  AND (' + updatable.map(k => 'product_catalog_items.' + k + ' IS DISTINCT FROM EXCLUDED.' + k).join(' OR ') + ');');
  }
  // ARRAY[]::text[] (e não NOT IN (NULL)) para que uma especificação vazia desative tudo o que for gerenciado.
  const codesArray = 'ARRAY[' + spec.items.map(i => lit(i.item_code, 'text')).join(', ') + ']::text[]';
  out.push('\n-- Itens gerenciados que saíram da especificação são desativados, nunca apagados.');
  out.push('UPDATE public.product_catalog_items i SET active = false, offerable = false FROM _pc_tenant t');
  out.push("WHERE i.tenant_id = t.id AND i.metadata->>'managed_by' = " + managed + ' AND (i.active OR i.offerable)');
  out.push('  AND i.item_code <> ALL (' + codesArray + ');');
  out.push('\n-- Conferência: cada item da especificação existe e pertence a esta carga.');
  out.push('DO $$ BEGIN IF (SELECT count(*) FROM public.product_catalog_items i JOIN _pc_tenant t ON t.id = i.tenant_id');
  out.push("  WHERE i.item_code = ANY (" + codesArray + ") AND i.metadata->>'managed_by' = " + managed + ') <> ' + spec.items.length);
  out.push("  THEN RAISE EXCEPTION 'Item da carga ausente ou pertencente a outro cadastro'; END IF; END $$;");

  if (spec.sources.length) {
    const cols = [['item_code', 'text'], ['source_type', 'text'], ['source_ref', 'text'], ['source_url', 'text'],
      ['captured_at', 'timestamptz'], ['reconciliation_status', 'text'], ['payload', 'jsonb']];
    out.push('\n-- Origens: uma origem nunca muda de item; se já apontar para outro, a conferência aborta a carga.');
    out.push('CREATE TEMP TABLE _pc_sources ON COMMIT DROP AS SELECT * FROM (VALUES\n' + rows(spec.sources, cols)
      + '\n) AS v(' + cols.map(([k]) => k).join(', ') + ');');
    out.push('INSERT INTO public.product_catalog_item_sources (tenant_id, item_id, source_type, source_ref, source_url, captured_at, reconciliation_status, payload)');
    out.push('SELECT t.id, i.id, s.source_type, s.source_ref, s.source_url, s.captured_at, s.reconciliation_status, s.payload');
    out.push('FROM _pc_sources s CROSS JOIN _pc_tenant t JOIN public.product_catalog_items i ON i.tenant_id = t.id AND i.item_code = s.item_code');
    out.push('ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET source_url = EXCLUDED.source_url,');
    out.push('  captured_at = EXCLUDED.captured_at, reconciliation_status = EXCLUDED.reconciliation_status, payload = EXCLUDED.payload');
    out.push('WHERE product_catalog_item_sources.item_id = EXCLUDED.item_id AND (product_catalog_item_sources.source_url IS DISTINCT FROM EXCLUDED.source_url');
    out.push('  OR product_catalog_item_sources.captured_at IS DISTINCT FROM EXCLUDED.captured_at');
    out.push('  OR product_catalog_item_sources.reconciliation_status IS DISTINCT FROM EXCLUDED.reconciliation_status');
    out.push('  OR product_catalog_item_sources.payload IS DISTINCT FROM EXCLUDED.payload);');
    out.push('DO $$ BEGIN IF EXISTS (SELECT 1 FROM _pc_sources s CROSS JOIN _pc_tenant t');
    out.push('  JOIN public.product_catalog_items i ON i.tenant_id = t.id AND i.item_code = s.item_code');
    out.push('  LEFT JOIN public.product_catalog_item_sources x ON x.tenant_id = t.id AND x.source_type = s.source_type AND x.source_ref = s.source_ref');
    out.push("  WHERE x.item_id IS DISTINCT FROM i.id) THEN RAISE EXCEPTION 'Origem já vinculada a outro item'; END IF; END $$;");
  }

  if (spec.assets.length) {
    out.push('\n-- Arquivos: um por hash; caminho e URL derivados do tenant e do hash. Divergência aborta.');
    const values = spec.assets.map(a => '  (' + [lit(a.sha256, 'text'), lit(a.mime_type, 'text'), lit(a.file_size_bytes, 'integer'),
      lit(a.source_ref, 'text'), lit(MIME_EXT[a.mime_type], 'text')].join(', ') + ')').join(',\n');
    out.push('CREATE TEMP TABLE _pc_assets ON COMMIT DROP AS SELECT v.*, \'catalog/\' || t.id::text || \'/\' || v.sha256 || \'.\' || v.ext AS storage_path');
    out.push('FROM _pc_tenant t CROSS JOIN (VALUES\n' + values + '\n) AS v(sha256, mime_type, file_size_bytes, source_ref, ext);');
    out.push('INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes, source_ref)');
    out.push('SELECT t.id, a.storage_path, ' + lit(spec.storage_base_url + '/storage/v1/object/public/product-catalog/', 'text')
      + ' || a.storage_path, a.sha256, a.mime_type, a.file_size_bytes, a.source_ref');
    out.push('FROM _pc_assets a CROSS JOIN _pc_tenant t ON CONFLICT (tenant_id, sha256) DO NOTHING;');
    out.push('DO $$ BEGIN IF EXISTS (SELECT 1 FROM _pc_assets a CROSS JOIN _pc_tenant t');
    out.push('  LEFT JOIN public.product_catalog_assets x ON x.tenant_id = t.id AND x.sha256 = a.sha256');
    out.push('  WHERE x.id IS NULL OR x.storage_path <> a.storage_path OR x.mime_type <> a.mime_type OR x.file_size_bytes <> a.file_size_bytes)');
    out.push("  THEN RAISE EXCEPTION 'Arquivo de imagem divergente do registrado'; END IF; END $$;");
  }

  if (spec.item_images.length) {
    const cols = [['item_code', 'text'], ['asset_sha256', 'text'], ['display_order', 'integer'], ['is_primary', 'boolean'],
      ['review_status', 'text'], ['shared_note', 'text']];
    out.push('\n-- Vínculos item-imagem: criados uma vez; revisão humana posterior não é sobrescrita.');
    out.push('CREATE TEMP TABLE _pc_links ON COMMIT DROP AS SELECT * FROM (VALUES\n' + rows(spec.item_images, cols)
      + '\n) AS v(' + cols.map(([k]) => k).join(', ') + ');');
    out.push('INSERT INTO public.product_catalog_item_images (tenant_id, item_id, asset_id, display_order, is_primary, review_status, shared_note)');
    out.push('SELECT t.id, i.id, a.id, v.display_order, v.is_primary, v.review_status, v.shared_note');
    out.push('FROM _pc_links v CROSS JOIN _pc_tenant t');
    out.push('JOIN public.product_catalog_items i ON i.tenant_id = t.id AND i.item_code = v.item_code');
    out.push('JOIN public.product_catalog_assets a ON a.tenant_id = t.id AND a.sha256 = v.asset_sha256');
    out.push('ON CONFLICT (tenant_id, item_id, asset_id) DO NOTHING;');
    out.push('DO $$ BEGIN IF EXISTS (SELECT 1 FROM _pc_links v CROSS JOIN _pc_tenant t');
    out.push('  JOIN public.product_catalog_items i ON i.tenant_id = t.id AND i.item_code = v.item_code');
    out.push('  JOIN public.product_catalog_assets a ON a.tenant_id = t.id AND a.sha256 = v.asset_sha256');
    out.push('  LEFT JOIN public.product_catalog_item_images l ON l.tenant_id = t.id AND l.item_id = i.id AND l.asset_id = a.id');
    out.push("  WHERE l.item_id IS NULL) THEN RAISE EXCEPTION 'Vínculo de imagem ausente após a carga'; END IF; END $$;");
  }
  out.push('\nCOMMIT;');
  return out.join('\n') + '\n';
}

// Lista do que precisa estar no Storage antes da carga (o upload é etapa separada e autorizada).
function buildUploadPlan(rawSpec, localFilesBySha = {}) {
  const spec = validateSpec(rawSpec);
  return spec.assets.map(a => ({
    sha256: a.sha256, mime_type: a.mime_type, file_size_bytes: a.file_size_bytes,
    local_file: localFilesBySha[a.sha256] || null,
    storage_bucket: 'product-catalog',
    storage_path_template: 'catalog/{tenant_id}/' + a.sha256 + '.' + MIME_EXT[a.mime_type],
  }));
}

module.exports = { validateSpec, buildCatalogLoadSql, buildUploadPlan, lit };

if (require.main === module) {
  const [specPath, outPath] = process.argv.slice(2);
  if (!specPath || !outPath) { console.error('Uso: node scripts/product_catalog_load.cjs <spec.json> <saida.sql>'); process.exit(2); }
  const sql = buildCatalogLoadSql(JSON.parse(fs.readFileSync(specPath, 'utf8')));
  fs.writeFileSync(outPath, sql);
  console.log('SQL gerado em ' + outPath);
}
