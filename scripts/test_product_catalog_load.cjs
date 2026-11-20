'use strict';
// Testes do gerador de carga do catálogo (sem banco). Integração com Postgres:
// supabase/tests/product_catalog_load.pglite.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSpec, buildCatalogLoadSql, buildUploadPlan, lit } = require('./product_catalog_load.cjs');

const BASE = 'https://exemplo.supabase.co';
const SHA = 'a'.repeat(64);
function spec(overrides = {}) {
  return {
    tenant_slug: 'loja', managed_by: 'carga-teste', storage_base_url: BASE,
    items: [{ item_code: 'item-1', name: 'Item', category: 'cat', sale_unit: 'unidade', price_cents: 1000,
      price_status: 'aprovado', price_source: 'fonte', offerable: true }],
    sources: [{ item_code: 'item-1', source_type: 'manual', source_ref: 'ref-1', captured_at: '2026-11-20T00:00:00Z' }],
    assets: [{ sha256: SHA, mime_type: 'image/png', file_size_bytes: 10 }],
    item_images: [{ item_code: 'item-1', asset_sha256: SHA, display_order: 0, is_primary: true }],
    ...overrides,
  };
}

test('especificação válida é normalizada com managed_by no metadata', () => {
  const out = validateSpec(spec());
  assert.equal(out.items[0].metadata.managed_by, 'carga-teste');
  assert.equal(out.items[0].material_class, 'desconhecido');
  assert.equal(out.items[0].availability, 'desconhecida');
});

test('rejeita entradas inválidas antes de gerar SQL', () => {
  const item = spec().items[0];
  const cases = [
    { tenant_slug: "x'; drop table tenants; --" },
    { storage_base_url: 'http://inseguro.com' },
    { storage_base_url: BASE + '/' },
    { items: [{ ...item, item_code: 'Código Inválido' }] },
    { items: [{ ...item, price_cents: 10.5 }] },
    { items: [{ ...item, price_cents: -1 }] },
    { items: [{ ...item, site_url: 'http://site.com/x' }] },
    { items: [{ ...item, sale_unit: 'kg' }] },
    { items: [{ ...item, name: 'a\u0000b' }] },
    { items: [item, item] },
    { assets: [{ sha256: SHA, mime_type: 'image/gif', file_size_bytes: 10 }] },
    { assets: [{ sha256: 'xyz', mime_type: 'image/png', file_size_bytes: 10 }] },
    { assets: [{ sha256: SHA, mime_type: 'image/png', file_size_bytes: 20 * 1024 * 1024 }] },
    { item_images: [{ item_code: 'outro', asset_sha256: SHA, display_order: 0 }] },
    { item_images: [{ item_code: 'item-1', asset_sha256: 'b'.repeat(64), display_order: 0 }] },
    { sources: [{ item_code: 'item-1', source_type: 'manual', source_ref: 'r', captured_at: 'ontem' }] },
  ];
  for (const override of cases) assert.throws(() => validateSpec(spec(override)), /Especificação inválida/, JSON.stringify(override));
  const twoPrimary = spec({ assets: [{ sha256: SHA, mime_type: 'image/png', file_size_bytes: 10 }, { sha256: 'b'.repeat(64), mime_type: 'image/png', file_size_bytes: 10 }],
    item_images: [{ item_code: 'item-1', asset_sha256: SHA, display_order: 0, is_primary: true }, { item_code: 'item-1', asset_sha256: 'b'.repeat(64), display_order: 1, is_primary: true }] });
  assert.throws(() => validateSpec(twoPrimary), /mais de uma imagem principal/);
});

test('literais escapam aspas e tipam nulos', () => {
  assert.equal(lit("D'Ouro", 'text'), "'D''Ouro'::text");
  assert.equal(lit(null, 'bigint'), 'NULL::bigint');
  assert.equal(lit({ a: "x'y" }, 'jsonb'), `'{"a":"x''y"}'::text::jsonb`);
  assert.throws(() => lit(Number.NaN, 'bigint'));
});

test('SQL é transacional, resolve tenant por slug e é determinístico', () => {
  const sql = buildCatalogLoadSql(spec());
  assert.match(sql, /^-- Carga gerada/);
  assert.match(sql, /\nBEGIN;\n/);
  assert.match(sql, /\nCOMMIT;\n$/);
  assert.match(sql, /FROM public\.tenants WHERE slug = 'loja'::text/);
  assert.doesNotMatch(sql, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'nenhum UUID fixo');
  // ON COMMIT DROP só descarta as tabelas temporárias da própria transação.
  assert.doesNotMatch(sql, /\bDELETE\b|\bTRUNCATE\b|\bDROP\s+(TABLE|SCHEMA|INDEX|POLICY)\b/, 'carga nunca apaga');
  assert.equal(buildCatalogLoadSql(spec()), sql);
});

test('plano de upload usa caminho por tenant e hash', () => {
  const [entry] = buildUploadPlan(spec(), { [SHA]: 'local/x.png' });
  assert.equal(entry.storage_path_template, 'catalog/{tenant_id}/' + SHA + '.png');
  assert.equal(entry.local_file, 'local/x.png');
});
