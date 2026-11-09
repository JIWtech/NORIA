import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBroadcastMessage } from '../../src/features/broadcasts/utils/broadcastTemplate.js';
import { scheduleInputToIso } from '../../src/features/broadcasts/utils/broadcastSchedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screen = () => fs.readFileSync(path.join(__dirname, '../../src/features/broadcasts/components/Broadcasts.jsx'), 'utf8');

test('{nome} vira o primeiro nome; sem nome a frase continua natural', () => {
  assert.equal(renderBroadcastMessage('Oi {nome}, tudo bem?', 'ana paula'), 'Oi Ana, tudo bem?');
  assert.equal(renderBroadcastMessage('Oi {nome}, tudo bem?', '5521999990000'), 'Oi, tudo bem?');
  assert.equal(renderBroadcastMessage('{{nome}}, sua vez chegou.', ''), 'Sua vez chegou.');
});

test('agendamento converte o horário local escolhido para ISO; vazio ou inválido envia agora', () => {
  const iso = scheduleInputToIso('2026-11-10T09:30');
  assert.equal(new Date(iso).getTime(), new Date(2026, 10, 10, 9, 30).getTime());
  assert.equal(scheduleInputToIso(''), null);
  assert.equal(scheduleInputToIso('amanhã'), null);
});

test('a tela mostra prévia personalizada e envia o agendamento ao servidor', () => {
  const code = screen();
  assert.match(code, /renderBroadcastMessage\(messageText, previewName\)/);
  assert.match(code, /type="datetime-local"/);
  assert.match(code, /enqueueBroadcastCampaign\(campaign\.id, \{ consentConfirmed, scheduledAt \}\)/);
  assert.match(code, /\{nome\}/, 'a tela explica a variável');
});
