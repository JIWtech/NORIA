// Gênesis 24/10 16:48 (…9745): "Vocês compram carro?" + 4 áudios + texto travou o turno em revisão humana
// (audio_batch_limit, limite fixo de 2). Mais áudios que o limite não podem silenciar o atendimento.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };

function harness(count, settings = {}) {
  const turn = { messages: Array.from({ length: count }, (_, i) => ({ event_id: 'e' + i, id: 'm' + i, text: '[audio]' })) };
  const rows = Object.fromEntries(turn.messages.map(m => [m.event_id, { id: m.event_id, external_message_id: m.id,
    raw_payload: { content_type: 'audio', audio_processing: { version: 'whatsapp_audio_v1', status: 'transcribed', text: 'fala ' + m.event_id } } }]));
  const run = new Function('turn', 'settingsFor', 'supabaseGet', 'encodeFilter', 'chatId', 'setCurrentText',
    slice('salesAudioBatchLimit') + 'async ' + slice('transcribeTurnAudio') + '; return { transcribeTurnAudio, salesAudioBatchLimit };');
  const api = run(turn, () => ({ whatsapp_audio_enabled: true, ...settings }), async p => [rows[/&id=eq\.([^&]+)/.exec(p)[1]]], v => v, 'chat', () => {});
  return { turn, ...api };
}

test('quatro áudios no mesmo turno são transcritos (produção …9745)', async () => {
  const { turn, transcribeTurnAudio } = harness(4);
  await transcribeTurnAudio({ tenant: { id: 't' } }, { tolerateUnintelligible: true });
  assert.deepEqual(turn.messages.map(m => m.text), ['fala e0', 'fala e1', 'fala e2', 'fala e3']);
  assert.deepEqual(turn.audio_skipped, []);
});

test('acima do limite não trava: os mais recentes são transcritos e os antigos registrados como não processados', async () => {
  const { turn, transcribeTurnAudio } = harness(6);
  await transcribeTurnAudio({ tenant: { id: 't' } }, { tolerateUnintelligible: true });
  assert.deepEqual(turn.audio_skipped, ['e0', 'e1']);
  assert.deepEqual(turn.messages.slice(2).map(m => m.text), ['fala e2', 'fala e3', 'fala e4', 'fala e5']);
  assert.deepEqual(turn.audio_unintelligible, ['e0', 'e1']);
});

test('limite configurável por cliente, entre 1 e 6, padrão 4', () => {
  const { salesAudioBatchLimit } = harness(0);
  const ctx = s => ({ settings: s });
  assert.equal(new Function('settingsFor', slice('salesAudioBatchLimit') + '; return salesAudioBatchLimit;')(() => ({}))({}), 4);
  assert.equal(new Function('settingsFor', slice('salesAudioBatchLimit') + '; return salesAudioBatchLimit;')(() => ({ whatsapp_audio_batch_limit: 2 }))({}), 2);
  assert.equal(new Function('settingsFor', slice('salesAudioBatchLimit') + '; return salesAudioBatchLimit;')(() => ({ whatsapp_audio_batch_limit: 50 }))({}), 4);
  assert.ok(salesAudioBatchLimit && ctx);
  assert.doesNotMatch(slice('transcribeTurnAudio'), /throw new Error\('audio_batch_limit'\)/);
});
