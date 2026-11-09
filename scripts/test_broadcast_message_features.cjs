// Etapa 5 dos disparos: variável {nome} renderizada por destinatário no servidor, igual à prévia do painel.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { bootstrap, createCampaign, createProvider, runWorker, TENANT_A } = require('./broadcast_test_harness.cjs');

const makeDue = (db, id) => db.query(`update broadcast_campaigns set next_send_at = clock_timestamp() - interval '1 second' where id = $1`, [id]);

test('worker troca {nome} pelo primeiro nome de cada destinatário e grava o texto enviado', async () => {
  const db = await bootstrap();
  const campaignId = await createCampaign(db, { contacts: 3, text: 'Oi {nome}, temos horário amanhã. {{ NOME }}, responda SAIR se não quiser mais.' });
  await db.query(`update broadcast_campaign_recipients set contact_name = case external_conversation_id
      when '5521990000000' then 'Maria Silva' when '5521990000001' then '5521990000001@s.whatsapp.net' else '' end
    where campaign_id = $1`, [campaignId]);
  const provider = createProvider();
  for (let i = 0; i < 3; i += 1) { await runWorker(db, { provider }); await makeDue(db, campaignId); }
  assert.deepEqual(provider.sent.map(request => request.body.text), [
    'Oi Maria, temos horário amanhã. Maria, responda SAIR se não quiser mais.',
    'Oi, temos horário amanhã. Responda SAIR se não quiser mais.',
    'Oi, temos horário amanhã. Responda SAIR se não quiser mais.',
  ]);
  const { rows } = await db.query(`select message_text from channel_events where tenant_id = $1 order by created_at`, [TENANT_A.id]);
  assert.equal(rows[0].message_text, provider.sent[0].body.text);
});

test('prévia do painel usa a mesma regra de renderização do worker', async () => {
  const { renderBroadcastMessage } = await import(pathToFileURL(path.join(__dirname, '../app/src/features/broadcasts/utils/broadcastTemplate.js')).href);
  const worker = require('node:fs').readFileSync(path.join(__dirname, '../n8n/code/broadcast_campaign_worker.js'), 'utf8');
  const source = worker.slice(worker.indexOf('// >>> broadcast_template'), worker.indexOf('// <<< broadcast_template'));
  assert.ok(source.length > 0, 'bloco de template marcado no worker');
  const workerRender = new Function(source + '\nreturn renderBroadcastMessage;')();
  const cases = [
    ['Oi {nome}!', 'Ana Paula'], ['Oi {nome}!', ''], ['{nome}, tudo bem?', null], ['Olá {{nome}} e {NOME}.', 'joão'],
    ['Sem variável.', 'Ana'], ['Oi {nome}', 'Contato'], ['Oi {nome}', '+55 21 99999-0000'],
  ];
  for (const [template, name] of cases) assert.equal(renderBroadcastMessage(template, name), workerRender(template, name), template + ' / ' + name);
});
