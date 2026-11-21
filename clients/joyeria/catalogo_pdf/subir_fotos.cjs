#!/usr/bin/env node
'use strict';
// JOYERÍA — envia as imagens do catálogo PDF ao bucket product-catalog do Supabase (API de Storage).
// Lê o plano gerado (carga/plano-upload.json), confere SHA-256, MIME e tamanho de cada arquivo local antes do envio
// e nunca sobrescreve: objeto já existente com o mesmo conteúdo é aceito; com conteúdo diferente, aborta.
// Credenciais: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY do .env da raiz (nunca impressas).
// Uso: node clients/joyeria/catalogo_pdf/subir_fotos.cjs <tenant_id> [--aplicar]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const [tenantId, flag] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/.test(String(tenantId || ''))) throw new Error('Informe o tenant_id');
const apply = flag === '--aplicar';
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(base) || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env');
const auth = { Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, apikey: env.SUPABASE_SERVICE_ROLE_KEY };
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'carga/plano-upload.json'), 'utf8'));

(async () => {
  let sent = 0, existing = 0;
  for (const entry of plan) {
    const file = fs.readFileSync(path.join(root, entry.local_file));
    const sha = crypto.createHash('sha256').update(file).digest('hex');
    if (sha !== entry.sha256 || file.length !== entry.file_size_bytes) throw new Error('Arquivo local diverge do plano: ' + entry.local_file);
    const objectPath = entry.storage_path_template.replace('{tenant_id}', tenantId);
    if (!objectPath.startsWith('catalog/' + tenantId + '/')) throw new Error('Caminho fora do tenant: ' + objectPath);
    const publicUrl = base + '/storage/v1/object/public/' + entry.storage_bucket + '/' + objectPath;
    const head = await fetch(publicUrl, { method: 'GET' });
    if (head.ok) {
      const remote = Buffer.from(await head.arrayBuffer());
      if (crypto.createHash('sha256').update(remote).digest('hex') !== entry.sha256) throw new Error('Objeto remoto diferente: ' + objectPath);
      existing++; continue;
    }
    if (!apply) { console.log('enviaria', objectPath); continue; }
    const response = await fetch(base + '/storage/v1/object/' + entry.storage_bucket + '/' + objectPath, {
      method: 'POST', headers: { ...auth, 'Content-Type': entry.mime_type, 'x-upsert': 'false', 'cache-control': '3600' }, body: file,
    });
    if (!response.ok) throw new Error('Upload falhou ' + objectPath + ': HTTP ' + response.status + ' ' + (await response.text()).slice(0, 200));
    const check = await fetch(publicUrl);
    const remote = Buffer.from(await check.arrayBuffer());
    if (!check.ok || crypto.createHash('sha256').update(remote).digest('hex') !== entry.sha256) throw new Error('Conferência pós-upload falhou: ' + objectPath);
    sent++;
  }
  console.log(JSON.stringify({ plano: plan.length, enviados: sent, ja_existentes: existing, modo: apply ? 'aplicar' : 'conferir' }));
})().catch(error => { console.error('ERRO:', error.message); process.exit(1); });
