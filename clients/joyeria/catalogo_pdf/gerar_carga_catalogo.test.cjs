'use strict';
// Teste da carga da JOYERÍA (sem banco). Rodar: node --test clients/joyeria/catalogo_pdf/gerar_carga_catalogo.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCatalogLoadSql } = require('../../../scripts/product_catalog_load.cjs');
const { buildSpec } = require('./gerar_carga_catalogo.cjs');

const BASE = 'https://exemplo.supabase.co';

test('JOYERÍA: 16 alianças blend, preços confirmados, 30 imagens únicas e foto do Prisma compartilhada', () => {
  const { spec: joy } = buildSpec(BASE);
  assert.equal(joy.tenant_slug, 'joyeria');
  assert.equal(joy.items.length, 16);
  assert.equal(joy.assets.length, 30);
  assert.equal(joy.item_images.length, 32);
  const byCode = Object.fromEntries(joy.items.map(i => [i.item_code, i]));
  assert.equal(byCode['blend-essence-2mm'].price_cents, 98000);
  assert.equal(byCode['blend-elegance-6mm'].price_cents, 188500);
  assert.ok(joy.items.every(i => i.material_class === 'blend' && i.sale_unit === 'par' && i.site_url === null));
  const elegance = joy.sources.find(s => s.item_code === 'blend-elegance-6mm' && s.source_type === 'site');
  assert.equal(elegance.reconciliation_status, 'confirmado');
  assert.equal(elegance.payload.preco_site_brl, 1185);
  const prisma = joy.item_images.filter(l => l.item_code.startsWith('blend-prisma-5') || l.item_code.startsWith('blend-prisma-6'));
  assert.ok(prisma.every(l => l.shared_note));
  assert.equal(new Set(prisma.map(l => l.asset_sha256)).size, 2);
  assert.doesNotThrow(() => buildCatalogLoadSql(joy));
});
