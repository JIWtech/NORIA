'use strict';

// Reações, edições/apagamentos e outros eventos de protocolo do WhatsApp não são
// mensagens do cliente nem do atendente: não podem abrir turno da IA, nem virar
// "resposta manual" que trava a conversa (21/10: reação do cliente → revisão).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
const normalizer = workflow.nodes.find(node => node.name === 'Normalizar Entrada WhatsApp');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const run = new AsyncFunction('$json', '$env', '$vars', normalizer.parameters.jsCode);

const inbound = (message, extra = {}) => ({
  event: 'messages.upsert', instance: 'wesley-carros',
  data: { key: { remoteJid: '5521900000000@s.whatsapp.net', id: 'msg-1', fromMe: false, ...(extra.key || {}) }, message, ...(extra.data || {}) },
});

test('reação do cliente não é processada', async () => {
  const out = await run.call({}, inbound({ reactionMessage: { key: { id: 'x' }, text: '👍' } }, { data: { messageType: 'reactionMessage' } }), {}, {});
  assert.equal(out.json.shouldProcess, false);
  assert.equal(out.json.ignoredReason, 'non_conversational_message');
});

test('reação do atendente pelo celular não vira resposta manual', async () => {
  const out = await run.call({}, inbound({ reactionMessage: { key: { id: 'x' }, text: '❤️' } }, { key: { fromMe: true }, data: { messageType: 'reactionMessage' } }), {}, {});
  assert.equal(out.json.shouldProcess, false);
});

test('apagamento/edição (protocolMessage) e voto de enquete não são processados', async () => {
  for (const [type, message] of [['protocolMessage', { protocolMessage: { type: 0 } }], ['pollUpdateMessage', { pollUpdateMessage: {} }]]) {
    const out = await run.call({}, inbound(message, { data: { messageType: type } }), {}, {});
    assert.equal(out.json.shouldProcess, false, type);
  }
});

test('texto, figurinha e mídia continuam sendo processados', async () => {
  for (const [type, message] of [['conversation', { conversation: 'Tem foto?' }], ['stickerMessage', { stickerMessage: {} }], ['imageMessage', { imageMessage: { caption: '' } }]]) {
    const out = await run.call({}, inbound(message, { data: { messageType: type } }), {}, {});
    assert.equal(out.json.shouldProcess, true, type);
  }
});
