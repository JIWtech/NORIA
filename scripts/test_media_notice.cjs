// Avisos sobre mídia (vídeo, foto sem texto, áudio não compreendido, arquivo não suportado) são escritos pelo modelo
// com o contexto da conversa. A frase fixa só vale como reserva quando o modelo não está disponível.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
const instructions = core.slice(core.indexOf('const MEDIA_NOTICE_INSTRUCTIONS'), core.indexOf('\n', core.indexOf('const MEDIA_NOTICE_INSTRUCTIONS')) + 1);

function compose({ reply = 'Que legal! Por aqui não consigo assistir vídeo, me manda uma foto?', fail = false, allowed = true } = {}) {
  const calls = [];
  const fn = new Function('settingsFor', 'usageGate', 'markUsage', 'httpJson', 'env', 'turn', 'salesRedactPersonalData',
    instructions + 'async ' + slice('composeMediaNotice') + '; return composeMediaNotice;')(
    () => ({ ai_model: 'gemini-3.5-flash-lite' }), () => ({ allowed }), () => {},
    async (method, url, headers, body) => { calls.push(body); if (fail) throw new Error('down');
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply }) }] } }] }; },
    () => 'k', { messages: [{ event_id: 'e1', text: '[video]' }] }, v => v);
  return { fn, calls };
}
const history = [{ direction: 'outbound', ai_provider: 'sales_core', message_text: 'Pode me mandar como ela está?' }];

test('o modelo escreve o aviso com a conversa e a situação', async () => {
  const { fn, calls } = compose();
  const text = await fn({}, history, 'video_only', 'Recebi o vídeo. Como posso ajudar você?');
  assert.equal(text, 'Que legal! Por aqui não consigo assistir vídeo, me manda uma foto?');
  const payload = JSON.parse(calls[0].contents[0].parts[0].text);
  assert.equal(payload.situation, 'video_only');
  assert.equal(payload.recent_conversation.at(-1).text, 'Pode me mandar como ela está?');
  assert.match(calls[0].system_instruction.parts[0].text, /não descreva/i);
});

test('falha, orçamento esgotado ou resposta fora das regras usam a frase de reserva', async () => {
  const fallback = 'Recebi o vídeo. Como posso ajudar você?';
  assert.equal(await compose({ fail: true }).fn({}, history, 'video_only', fallback), fallback);
  const denied = compose({ allowed: false });
  assert.equal(await denied.fn({}, history, 'video_only', fallback), fallback);
  assert.equal(denied.calls.length, 0, 'sem orçamento nenhuma chamada sai');
  assert.equal(await compose({ reply: 'Ele custa 30 mil' }).fn({}, history, 'video_only', fallback), fallback);
  assert.equal(await compose({ reply: 'veja https://x.y' }).fn({}, history, 'video_only', fallback), fallback);
  assert.equal(await compose({ reply: '' }).fn({}, history, 'video_only', fallback), fallback);
});

test('os avisos de mídia de Gênesis e Núbia passam pelo modelo', () => {
  assert.match(core, /composeMediaNotice\(context, history, 'media_not_transcribed'/);
  assert.match(core, /composeMediaNotice\(context, history, 'audio_failed_handoff'/);
  assert.match(core, /composeMediaNotice\(context, history, 'audio_unintelligible'/);
  assert.match(core, /composeMediaNotice\(context, history, mediaCapability\.kind === 'contact'/);
  assert.match(core, /composeMediaNotice\(context, history, salesNeutralMediaSituation\(/);
});
