// Teste da migration 20261120200000_product_catalog em Postgres local (PGlite), sem tocar no Supabase.
// O PGlite NÃO é dependência do projeto: instale numa pasta temporária e rode a partir dela:
//   mkdir tmp-pg && cd tmp-pg && npm init -y && npm i @electric-sql/pglite@0.2.17
//   cp <repo>/supabase/tests/product_catalog_migration.pglite.mjs run.mjs
//   node run.mjs <repo>/supabase/migrations_pending_review/20261120200000_product_catalog.sql \
//     <repo>/supabase/migrations_pending_review/20261120200000_product_catalog.rollback.sql
// Simula os privilégios padrão do NORIA-prod (ALL para anon/authenticated em tabelas novas).
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const [migrationPath, rollbackPath] = process.argv.slice(2);
const db = new PGlite();
let failures = 0;
const ok = (name) => console.log('OK  ', name);
const bad = (name, detail) => { failures++; console.log('FALHA', name, detail || ''); };
async function expectError(name, sql, pattern) {
  try { await db.exec(sql); bad(name, '(não falhou)'); }
  catch (e) { (pattern && !pattern.test(e.message)) ? bad(name, e.message) : ok(name + ' → ' + e.message.slice(0, 90)); }
}

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const UA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Ambiente mínimo equivalente ao Supabase: papéis, auth.uid(), tenants, membros e helpers reais.
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE TABLE public.tenants (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL);
  CREATE TABLE public.tenant_members (tenant_id uuid REFERENCES public.tenants(id), user_id uuid, status text);
  -- Simula os privilégios padrão do NORIA-prod: ALL para anon e authenticated em tabelas novas.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  CREATE FUNCTION public.is_active_tenant_member(p_tenant_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
    select auth.uid() is not null and exists (select 1 from public.tenant_members tm where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status = 'active'); $$;
  CREATE FUNCTION public.prevent_tenant_reparent() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
    begin if tg_op = 'UPDATE' and old.tenant_id is distinct from new.tenant_id then raise exception 'tenant_id nao pode ser alterado' using errcode = '23514'; end if; return new; end; $$;
  CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$ begin new.updated_at := now(); return new; end; $$;
  INSERT INTO public.tenants VALUES ('${A}', 'joyeria'), ('${B}', 'outro');
  INSERT INTO public.tenant_members VALUES ('${A}', '${UA}', 'active');
`);

await db.exec(fs.readFileSync(migrationPath, 'utf8'));
ok('migration aplicada');

const item = (tenant, code, extra = '') => `INSERT INTO public.product_catalog_items
  (tenant_id, item_code, name, category, sale_unit, material_class, material_evidence, price_cents, price_status, price_source, offerable${extra ? ', ' + extra.split('|')[0] : ''})
  VALUES ('${tenant}', '${code}', 'Aliança ${code}', 'aliancas', 'par', 'blend', 'PDF p. 3', 98000, 'aprovado', 'PDF 2026 p. 5', true${extra ? ', ' + extra.split('|')[1] : ''}) RETURNING id`;
const ia = (await db.query(item(A, 'essence-2mm'))).rows[0].id;
const ib = (await db.query(item(B, 'outro-item'))).rows[0].id;
ok('itens válidos em dois tenants');

// Regras de integridade do item
await expectError('código duplicado no mesmo tenant', item(A, 'essence-2mm'), /uq_product_catalog_items_code/);
await db.query(item(B, 'essence-2mm')); ok('mesmo código em outro tenant é permitido');
await expectError('preço aprovado sem valor', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit, price_status, price_source) VALUES ('${A}','x1','X','c','par','aprovado','pdf')`, /price_consistency/);
await expectError('preço aprovado sem origem', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit, price_cents, price_status) VALUES ('${A}','x2','X','c','par',100,'aprovado')`, /price_consistency/);
await expectError('valor com status não informado', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit, price_cents) VALUES ('${A}','x3','X','c','par',100)`, /price_consistency/);
await expectError('ofertável sem preço aprovado', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit, offerable) VALUES ('${A}','x4','X','c','par',true)`, /offerable/);
await expectError('ofertável inativo', item(A, 'x5', 'active|false'), /offerable/);
await expectError('composição sem evidência', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit, material_class) VALUES ('${A}','x6','X','c','par','ouro_macico')`, /material_evidence/);
await expectError('unidade inválida', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit) VALUES ('${A}','x7','X','c','kg')`, /unit/);
await expectError('preço negativo', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit, price_cents, price_status) VALUES ('${A}','x8','X','c','par',-1,'pendente_revisao')`, /price/);
await expectError('URL do site sem https', item(A, 'x9', 'site_url|\'http://joyeria.com.br/x\''), /site_url/);
await db.query(`INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit) VALUES ('${A}','sem-dados','Peça','semijoias','unidade')`);
ok('item sem preço e com composição desconhecida é aceito (não ofertável)');
await expectError('mudar tenant_id do item', `UPDATE public.product_catalog_items SET tenant_id='${B}' WHERE id='${ia}'`, /tenant_id nao pode ser alterado/);

// Origens e imagens com FK composta
await db.query(`INSERT INTO public.product_catalog_item_sources (tenant_id, item_id, source_type, source_ref, captured_at, reconciliation_status) VALUES ('${A}','${ia}','pdf','sha:1ffa/p05',now(),'confirmado')`);
ok('origem do PDF registrada');
await expectError('origem apontando item de outro tenant', `INSERT INTO public.product_catalog_item_sources (tenant_id, item_id, source_type, source_ref, captured_at) VALUES ('${A}','${ib}','site','99',now())`, /fk_product_catalog_item_sources_item/);
await expectError('mesma origem em dois itens', `INSERT INTO public.product_catalog_item_sources (tenant_id, item_id, source_type, source_ref, captured_at) VALUES ('${A}','${ia}','pdf','sha:1ffa/p05',now())`, /uq_product_catalog_item_sources_ref/);

const h = 'a'.repeat(64);
const path = `catalog/${A}/pdf-2026/pagina-05-imagem-01.jpg`;
const url = `https://proj.supabase.co/storage/v1/object/public/product-catalog/${path}`;
const asset = (await db.query(`INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes) VALUES ('${A}','${path}','${url}','${h}','image/jpeg',179594) RETURNING id`)).rows[0].id;
ok('asset válido');
await expectError('asset na pasta de outro tenant', `INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes) VALUES ('${A}','catalog/${B}/x.jpg','https://p.supabase.co/storage/v1/object/public/product-catalog/catalog/${B}/x.jpg','${'b'.repeat(64)}','image/jpeg',10)`, /ck_product_catalog_assets_path/);
await expectError('travessia de diretório', `INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes) VALUES ('${A}','catalog/${A}/../x.jpg','https://p.supabase.co/storage/v1/object/public/product-catalog/catalog/${A}/../x.jpg','${'c'.repeat(64)}','image/jpeg',10)`, /ck_product_catalog_assets_path/);
await expectError('URL diferente do caminho', `INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes) VALUES ('${A}','catalog/${A}/y.jpg','https://p.supabase.co/storage/v1/object/public/product-catalog/catalog/${A}/outro.jpg','${'d'.repeat(64)}','image/jpeg',10)`, /ck_product_catalog_assets_url/);
await expectError('MIME não permitido', `INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes) VALUES ('${A}','catalog/${A}/z.gif','https://p.supabase.co/storage/v1/object/public/product-catalog/catalog/${A}/z.gif','${'e'.repeat(64)}','image/gif',10)`, /mime/);
await expectError('mesmo hash duas vezes no tenant', `INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes) VALUES ('${A}','catalog/${A}/dup.jpg','https://p.supabase.co/storage/v1/object/public/product-catalog/catalog/${A}/dup.jpg','${h}','image/jpeg',10)`, /sha256/);

const ia2 = (await db.query(item(A, 'essence-3mm'))).rows[0].id;
await db.query(`INSERT INTO public.product_catalog_item_images (tenant_id, item_id, asset_id, display_order, is_primary, review_status) VALUES ('${A}','${ia}','${asset}',0,true,'aprovada'), ('${A}','${ia2}','${asset}',0,true,'aprovada')`);
ok('mesma foto compartilhada por duas variantes');
await expectError('vínculo com item de outro tenant', `INSERT INTO public.product_catalog_item_images (tenant_id, item_id, asset_id, display_order) VALUES ('${A}','${ib}','${asset}',1)`, /fk_product_catalog_item_images_item/);
await expectError('vínculo com asset de outro tenant', `INSERT INTO public.product_catalog_item_images (tenant_id, item_id, asset_id, display_order) VALUES ('${B}','${ib}','${asset}',0)`, /fk_product_catalog_item_images_asset/);
await expectError('duas imagens principais no item', `INSERT INTO public.product_catalog_assets (tenant_id, storage_path, public_url, sha256, mime_type, file_size_bytes) VALUES ('${A}','catalog/${A}/p2.png','https://p.supabase.co/storage/v1/object/public/product-catalog/catalog/${A}/p2.png','${'f'.repeat(64)}','image/png',10);
  INSERT INTO public.product_catalog_item_images (tenant_id, item_id, asset_id, display_order, is_primary) SELECT '${A}','${ia}', id, 1, true FROM public.product_catalog_assets WHERE sha256='${'f'.repeat(64)}'`, /uq_product_catalog_item_images_primary/);
await expectError('apagar item com imagem (RESTRICT)', `DELETE FROM public.product_catalog_items WHERE id='${ia}'`, /foreign key/);

// Privilégios e RLS
const asRole = async (role, sub, sql) => {
  await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.sub', '${sub || ''}', false);`);
  try { return await db.query(sql); } finally { await db.exec('RESET ROLE;'); }
};
for (const t of ['product_catalog_items', 'product_catalog_item_sources', 'product_catalog_assets', 'product_catalog_item_images']) {
  try { await asRole('anon', '', `SELECT 1 FROM public.${t}`); bad('anon lê ' + t); } catch (e) { ok('anon sem acesso a ' + t); }
}
const seenA = await asRole('authenticated', UA, 'SELECT DISTINCT tenant_id FROM public.product_catalog_items');
(seenA.rows.length === 1 && seenA.rows[0].tenant_id === A) ? ok('membro do tenant A vê só A') : bad('isolamento de leitura', JSON.stringify(seenA.rows));
const seenNone = await asRole('authenticated', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'SELECT count(*)::int n FROM public.product_catalog_items');
seenNone.rows[0].n === 0 ? ok('usuário sem vínculo não vê nada') : bad('usuário sem vínculo vê linhas');
const imgsA = await asRole('authenticated', UA, 'SELECT count(*)::int n FROM public.product_catalog_item_images');
imgsA.rows[0].n === 2 ? ok('membro de A vê os vínculos de imagem de A') : bad('vínculos de A', JSON.stringify(imgsA.rows));
for (const [name, sql] of [
  ['authenticated não insere', `INSERT INTO public.product_catalog_items (tenant_id, item_code, name, category, sale_unit) VALUES ('${A}','hack','X','c','par')`],
  ['authenticated não altera', `UPDATE public.product_catalog_items SET name='hack'`],
  ['authenticated não apaga', `DELETE FROM public.product_catalog_items`],
  ['authenticated não trunca', `TRUNCATE public.product_catalog_items CASCADE`],
]) {
  try { await asRole('authenticated', UA, sql); bad(name); } catch (e) { ok(name + ' → ' + e.message.slice(0, 60)); }
}
const svc = await asRole('service_role', '', 'SELECT count(*)::int n FROM public.product_catalog_items');
svc.rows[0].n >= 4 ? ok('service_role lê todos os tenants (importador/workflows)') : bad('service_role');

// Rollback: recusa com dados, executa vazio
const rollback = fs.readFileSync(rollbackPath, 'utf8');
await expectError('rollback recusa com dados', rollback, /Rollback recusado/);
await db.exec('ROLLBACK').catch(() => {});
await db.exec('DELETE FROM public.product_catalog_item_images; DELETE FROM public.product_catalog_item_sources; DELETE FROM public.product_catalog_assets; DELETE FROM public.product_catalog_items;');
await db.exec(rollback);
const left = await db.query(`SELECT count(*)::int n FROM pg_class WHERE relname LIKE 'product_catalog%' AND relkind = 'r'`);
left.rows[0].n === 0 ? ok('rollback com tabelas vazias remove tudo') : bad('rollback deixou tabelas');
await db.exec(fs.readFileSync(migrationPath, 'utf8'));
ok('migration reaplicável após rollback');

console.log(failures ? `\n${failures} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
process.exit(failures ? 1 : 0);
