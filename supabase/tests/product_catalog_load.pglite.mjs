// Integração da carga do catálogo (migration + SQL gerado da JOYERÍA) em Postgres local (PGlite), sem tocar no Supabase.
// O PGlite NÃO é dependência do projeto: instale numa pasta temporária, copie este arquivo para lá e rode:
//   npm i @electric-sql/pglite@0.2.17 && node run-load.mjs <caminho-do-repositorio>
// Requer a pasta clients/joyeria (manifesto, imagens e inventário do site).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const repo = (process.argv[2] || '').split('\\').join('/').replace(/\/+$/, '');
if (!repo) { console.error('Uso: node run-load.mjs <caminho-do-repositorio>'); process.exit(2); }
const { buildCatalogLoadSql } = require(repo + '/scripts/product_catalog_load.cjs');
const { buildSpec } = require(repo + '/clients/joyeria/catalogo_pdf/gerar_carga_catalogo.cjs');

let failures = 0;
const ok = n => console.log('OK  ', n);
const bad = (n, d) => { failures++; console.log('FALHA', n, d || ''); };
const db = new PGlite();
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
  CREATE TABLE public.tenants (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL);
  CREATE TABLE public.tenant_members (tenant_id uuid, user_id uuid, status text);
  CREATE FUNCTION public.is_active_tenant_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
  CREATE FUNCTION public.prevent_tenant_reparent() RETURNS trigger LANGUAGE plpgsql AS $$ begin if tg_op='UPDATE' and old.tenant_id is distinct from new.tenant_id then raise exception 'tenant_id nao pode ser alterado'; end if; return new; end; $$;
  CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ begin new.updated_at := clock_timestamp(); return new; end; $$;
  INSERT INTO public.tenants VALUES ('${B}', 'outro');
`);
await db.exec(fs.readFileSync(repo + '/supabase/migrations_pending_review/20261120200000_product_catalog.sql', 'utf8'));
const base = 'https://gfwwawazivmuqyctjsxj.supabase.co';
const { spec } = buildSpec(base);
const sql = buildCatalogLoadSql(spec);
const count = async () => (await db.query(`SELECT
  (SELECT count(*)::int FROM product_catalog_items) i, (SELECT count(*)::int FROM product_catalog_item_sources) s,
  (SELECT count(*)::int FROM product_catalog_assets) a, (SELECT count(*)::int FROM product_catalog_item_images) l,
  (SELECT max(updated_at) FROM product_catalog_items) u`)).rows[0];

// Tenant ausente: carga aborta sem gravar nada
try { await db.exec(sql); bad('carga sem tenant'); } catch (e) { await db.exec('ROLLBACK').catch(() => {}); /Tenant da carga não encontrado/.test(e.message) ? ok('sem tenant joyeria a carga aborta → ' + e.message) : bad('aborto sem tenant', e.message); }
const empty = await count(); empty.i === 0 ? ok('nada gravado após abortar') : bad('gravou parcialmente');

await db.exec(`INSERT INTO public.tenants VALUES ('${A}', 'joyeria')`);
// Item de outro tenant com mesmo código não interfere
await db.exec(`INSERT INTO product_catalog_items (tenant_id, item_code, name, category, sale_unit) VALUES ('${B}','blend-essence-2mm','Outro','x','par')`);
await db.exec(sql);
let c = await count();
(c.i === 17 && c.s === 32 && c.a === 30 && c.l === 32) ? ok(`primeira carga: 16 itens (+1 de outro tenant), 32 origens, 30 imagens, 32 vínculos`) : bad('contagens', JSON.stringify(c));
const r = (await db.query(`SELECT item_code, price_cents, offerable, material_class FROM product_catalog_items WHERE tenant_id='${A}' AND item_code IN ('blend-essence-2mm','blend-elegance-6mm') ORDER BY 1`)).rows;
(r.find(x=>x.item_code==='blend-essence-2mm').price_cents == 98000 && r.find(x=>x.item_code==='blend-elegance-6mm').price_cents == 188500 && r.every(x => x.offerable && x.material_class === 'blend')) ? ok('preços confirmados: abaulada 2 mm 98000, Elegance 6 mm 188500') : bad('preços', JSON.stringify(r));
const other = (await db.query(`SELECT name FROM product_catalog_items WHERE tenant_id='${B}'`)).rows[0];
other.name === 'Outro' ? ok('item do outro tenant intacto') : bad('outro tenant alterado');
const path = (await db.query(`SELECT a.storage_path, a.public_url FROM product_catalog_assets a LIMIT 1`)).rows[0];
(path.storage_path.startsWith('catalog/' + A + '/') && path.public_url === base + '/storage/v1/object/public/product-catalog/' + path.storage_path) ? ok('caminho e URL derivados do tenant e do hash') : bad('caminho', JSON.stringify(path));
const shared = (await db.query(`SELECT count(DISTINCT l.item_id)::int n FROM product_catalog_item_images l JOIN product_catalog_assets a ON a.id=l.asset_id GROUP BY a.id ORDER BY n DESC LIMIT 1`)).rows[0];
shared.n === 2 ? ok('foto do Prisma compartilhada por 2 variantes, arquivo único') : bad('compartilhamento', JSON.stringify(shared));

// Idempotência
await new Promise(res => setTimeout(res, 20));
await db.exec(sql);
const c2 = await count();
(c2.i === c.i && c2.s === c.s && c2.a === c.a && c2.l === c.l && String(c2.u) === String(c.u)) ? ok('segunda carga idêntica: nenhuma linha alterada (updated_at igual)') : bad('não idempotente', JSON.stringify([c, c2]));

// Mudança de preço na fonte atualiza só o item gerenciado
const spec2 = structuredClone(spec);
spec2.items.find(i => i.item_code === 'blend-classic-4mm').price_cents = 155000;
spec2.items = spec2.items.filter(i => i.item_code !== 'blend-harmony-2mm');
spec2.sources = spec2.sources.filter(s => s.item_code !== 'blend-harmony-2mm');
spec2.item_images = spec2.item_images.filter(l => l.item_code !== 'blend-harmony-2mm');
await db.exec(buildCatalogLoadSql(spec2));
const changed = (await db.query(`SELECT item_code, price_cents, active, offerable FROM product_catalog_items WHERE tenant_id='${A}' AND item_code IN ('blend-classic-4mm','blend-harmony-2mm') ORDER BY 1`)).rows;
(changed[0].price_cents == 155000 && !changed[1].active && !changed[1].offerable) ? ok('preço alterado atualiza; item retirado é desativado (não apagado)') : bad('atualização', JSON.stringify(changed));
await db.exec(sql);
const back = (await db.query(`SELECT active, offerable, price_cents FROM product_catalog_items WHERE tenant_id='${A}' AND item_code IN ('blend-harmony-2mm','blend-classic-4mm') ORDER BY item_code`)).rows;
(back[0].price_cents == 154000 && back[1].active && back[1].offerable) ? ok('recarga original restaura preço e reativa o item') : bad('restauração', JSON.stringify(back));

// Revisão humana de imagem não é sobrescrita
await db.exec(`UPDATE product_catalog_item_images SET review_status='rejeitada' WHERE tenant_id='${A}' AND display_order=1 AND item_id=(SELECT id FROM product_catalog_items WHERE tenant_id='${A}' AND item_code='blend-essence-3mm')`);
await db.exec(sql);
const rev = (await db.query(`SELECT review_status FROM product_catalog_item_images l JOIN product_catalog_items i ON i.id=l.item_id WHERE i.tenant_id='${A}' AND i.item_code='blend-essence-3mm' AND l.display_order=1`)).rows[0];
rev.review_status === 'rejeitada' ? ok('rejeição humana de imagem preservada na recarga') : bad('revisão sobrescrita');

// Item manual (não gerenciado) com o mesmo código bloqueia a carga
await db.exec(`UPDATE product_catalog_items SET metadata='{}'::jsonb WHERE tenant_id='${A}' AND item_code='blend-versati-4mm'`);
try { await db.exec(sql); bad('carga sobrescreveu item manual'); } catch (e) { await db.exec('ROLLBACK').catch(() => {}); /pertencente a outro cadastro/.test(e.message) ? ok('item manual com mesmo código bloqueia a carga → ' + e.message) : bad('bloqueio item manual', e.message); }
await db.exec(`UPDATE product_catalog_items SET metadata='{"managed_by":"joyeria-pdf-2026","pdf_id":"pdf-2026-p13"}'::jsonb WHERE tenant_id='${A}' AND item_code='blend-versati-4mm'`);

// Origem já ligada a outro item aborta
await db.exec(`UPDATE product_catalog_item_sources SET item_id=(SELECT id FROM product_catalog_items WHERE tenant_id='${A}' AND item_code='blend-prisma-4mm') WHERE tenant_id='${A}' AND source_ref LIKE '%:p05'`);
try { await db.exec(sql); bad('aceitou origem trocada'); } catch (e) { await db.exec('ROLLBACK').catch(() => {}); /Origem já vinculada a outro item/.test(e.message) ? ok('origem ligada a outro item aborta → ' + e.message) : bad('origem trocada', e.message); }

console.log(failures ? `\n${failures} FALHA(S)` : '\nTODOS OS TESTES DE CARGA PASSARAM');
process.exit(failures ? 1 : 0);
