#!/usr/bin/env node
'use strict';
// JOYERÍA — gera a especificação e o SQL de carga das 16 alianças blend do catálogo PDF 2026.
// Fontes: manifesto-produtos.json (PDF) e ../fontes/inventario-site-2026-11-20.json (site).
// Não acessa banco nem Storage. Saídas em ./carga/ para revisão humana.
// Uso: node gerar_carga_catalogo.cjs https://<projeto>.supabase.co

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildCatalogLoadSql, buildUploadPlan } = require('../../../scripts/product_catalog_load.cjs');

const HERE = __dirname;
const MANAGED_BY = 'joyeria-pdf-2026';
const MATERIAL_EVIDENCE = 'Catálogo PDF 2026, p. 3: ouro 18k incorporado de forma permanente a base de aço (tecnologia BLEND); não é ouro maciço.';
// Preços confirmados pessoalmente por João em 20/11/2026 (registro em plano-implementacao.md).
const CONFIRMED_BY_JOAO = new Set(['pdf-2026-p05', 'pdf-2026-p17']);
// Correspondência PDF ↔ site confirmada por João (anúncio de R$ 1.185 é a Elegance 6 mm, preço correto R$ 1.885).
const SITE_MATCH_CONFIRMED = new Set(['pdf-2026-p17']);
// Modelo do PDF → padrão do nome do anúncio no site.
const SITE_MODEL = {
  'abaulada': /abaulada/i,
  'reta': /retas lisa/i,
  'reta com friso lateral': /friso lateral/i,
  'reta italiana chanfrada': /chanfrado/i,
};

function mimeOf(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  throw new Error('Formato de imagem não reconhecido');
}
const slugify = value => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function buildSpec(storageBaseUrl, { manifest, inventory } = {}) {
  manifest = manifest || JSON.parse(fs.readFileSync(path.join(HERE, 'manifesto-produtos.json'), 'utf8'));
  inventory = inventory || JSON.parse(fs.readFileSync(path.join(HERE, '../fontes/inventario-site-2026-11-20.json'), 'utf8'));
  if (manifest.unidade !== 'par' || manifest.moeda !== 'BRL' || manifest.composicao?.classe !== 'blend') {
    throw new Error('Manifesto fora do formato esperado (par, BRL, blend)');
  }
  const pdfRef = 'catalogo-aliancas-2026:' + manifest.sha256_pdf.slice(0, 16);
  const blendSite = inventory.produtos.filter(p => /blend/i.test(p.nome));
  const capturedAt = inventory.coleta + 'T00:00:00-03:00';
  const items = [], sources = [], assets = [], itemImages = [], localFiles = {}, seen = new Map();

  for (const p of manifest.produtos) {
    const cents = Math.round(p.preco_par_brl * 100);
    if (!Number.isSafeInteger(cents) || cents / 100 !== p.preco_par_brl) throw new Error('Preço não exato em centavos: ' + p.id_fonte);
    const code = 'blend-' + slugify(p.linha) + '-' + p.largura_mm + 'mm';
    const page = String(p.pagina_pdf).padStart(2, '0');
    items.push({
      item_code: code,
      name: 'Aliança Blend ' + p.linha + ' ' + p.largura_mm + ' mm',
      description: p.descricao_pdf,
      category: 'aliancas_blend',
      product_line: p.linha,
      model: p.modelo,
      width_mm: p.largura_mm,
      sale_unit: 'par',
      material_class: 'blend',
      material_evidence: MATERIAL_EVIDENCE,
      price_cents: cents,
      price_status: 'aprovado',
      price_source: 'Catálogo PDF 2026, p. ' + p.pagina_pdf + (CONFIRMED_BY_JOAO.has(p.id_fonte) ? '; valor confirmado por João em 20/11/2026' : ''),
      // Alianças fabricadas sob medida (PDF p. 4: fabricação e entrega em até 10 dias úteis).
      availability: 'sob_encomenda',
      // Sem link: blend segue para a Joyce, e o anúncio da Elegance 6 mm no site ainda mostra preço errado.
      site_url: null,
      offerable: true,
      metadata: { pdf_id: p.id_fonte, ...(p.linha === 'Queem' ? { grafia_alternativa: 'Queen' } : {}) },
    });
    sources.push({
      item_code: code, source_type: 'pdf', source_ref: pdfRef + ':p' + page, captured_at: capturedAt,
      reconciliation_status: 'confirmado',
      payload: { arquivo: manifest.origem, pagina: p.pagina_pdf, preco_par_brl: p.preco_par_brl, revisao: p.revisao },
    });

    // Anúncio do site: mesmo modelo e largura. Preço igual = provável; divergente só é aceito com confirmação de João.
    const candidates = blendSite.filter(s => SITE_MODEL[p.modelo]?.test(s.nome) && new RegExp('\\b' + p.largura_mm + 'mm\\b').test(s.nome));
    if (candidates.length !== 1) throw new Error('Correspondência no site ambígua para ' + p.id_fonte + ': ' + candidates.length);
    const site = candidates[0];
    const samePrice = Math.round(Number(site.preco) * 100) === cents;
    sources.push({
      item_code: code, source_type: 'site', source_ref: 'joyeria.com.br:' + site.id, source_url: site.url, captured_at: capturedAt,
      reconciliation_status: SITE_MATCH_CONFIRMED.has(p.id_fonte) ? 'confirmado' : samePrice ? 'provavel' : 'divergente',
      payload: { nome: site.nome, preco_site_brl: Number(site.preco),
        ...(samePrice ? {} : { observacao: 'Preço do site diverge do PDF; prevalece o PDF confirmado. Site ainda não corrigido.' }) },
    });

    p.imagens.forEach((img, order) => {
      const file = path.join(HERE, img.arquivo);
      const buffer = fs.readFileSync(file);
      const sha = crypto.createHash('sha256').update(buffer).digest('hex');
      if (sha !== img.sha256) throw new Error('Hash divergente do manifesto: ' + img.arquivo);
      if (!seen.has(sha)) {
        seen.set(sha, p.id_fonte);
        assets.push({ sha256: sha, mime_type: mimeOf(buffer), file_size_bytes: buffer.length,
          source_ref: pdfRef + ':p' + page + ':' + path.basename(img.arquivo) });
        localFiles[sha] = path.posix.join('clients/joyeria/catalogo_pdf', img.arquivo);
      }
      const sharedWith = seen.get(sha) !== p.id_fonte ? seen.get(sha) : null;
      itemImages.push({
        item_code: code, asset_sha256: sha, display_order: order, is_primary: order === 0, review_status: 'aprovada',
        shared_note: sharedWith ? 'Mesma foto usada no PDF para ' + sharedWith + '; informar a largura no texto.' : null,
      });
    });
  }
  // A foto compartilhada também precisa da nota no primeiro item que a usa.
  const sharedHashes = new Set(itemImages.filter(l => l.shared_note).map(l => l.asset_sha256));
  for (const link of itemImages) {
    if (sharedHashes.has(link.asset_sha256) && !link.shared_note) link.shared_note = 'Mesma foto usada no PDF em outra largura; informar a largura no texto.';
  }
  return { spec: { tenant_slug: 'joyeria', managed_by: MANAGED_BY, storage_base_url: storageBaseUrl,
    items, sources, assets, item_images: itemImages }, localFiles };
}

module.exports = { buildSpec };

if (require.main === module) {
  const base = process.argv[2];
  if (!base) { console.error('Uso: node gerar_carga_catalogo.cjs https://<projeto>.supabase.co'); process.exit(2); }
  const { spec, localFiles } = buildSpec(base);
  const outDir = path.join(HERE, 'carga');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'spec-catalogo-pdf.json'), JSON.stringify(spec, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'carga-catalogo-pdf.sql'), buildCatalogLoadSql(spec));
  fs.writeFileSync(path.join(outDir, 'plano-upload.json'), JSON.stringify(buildUploadPlan(spec, localFiles), null, 2) + '\n');
  console.log('Itens: ' + spec.items.length + ' | origens: ' + spec.sources.length + ' | imagens únicas: ' + spec.assets.length
    + ' | vínculos: ' + spec.item_images.length + '\nArquivos em ' + outDir);
}
