import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { broadcastErrorMessage, broadcastPauseReason } from '../../src/features/broadcasts/utils/broadcastMessages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('códigos do servidor viram mensagens de interface (sem expor diagnóstico)', () => {
  assert.match(broadcastErrorMessage({ message: 'BROADCAST_CAMPAIGN_LIMIT' }, 'x'), /limite de contatos por campanha/i);
  assert.match(broadcastErrorMessage({ message: 'BROADCAST_FORBIDDEN' }, 'x'), /permissão/i);
  assert.match(broadcastErrorMessage({ message: 'BROADCAST_CONSENT_REQUIRED' }, 'x'), /consentimento/i);
  assert.match(broadcastErrorMessage({ message: 'BROADCAST_NO_RECIPIENTS' }, 'x'), /contato/i);
  assert.equal(broadcastErrorMessage({ message: 'relation "x" does not exist' }, 'Falhou.'), 'Falhou.');
});

test('motivo de pausa automática é explicado para o operador', () => {
  assert.match(broadcastPauseReason('consecutive_failures'), /falhas seguidas/i);
  for (const code of ['provider_rejected_http_401', 'provider_rejected_http_403', 'whatsapp_credentials_missing']) {
    assert.match(broadcastPauseReason(code), /conexão|credencia/i, code);
  }
  assert.match(broadcastPauseReason('provider_rejected_http_429'), /limite/i);
  assert.equal(broadcastPauseReason(null), '');
  assert.match(broadcastPauseReason('algo_novo'), /pausada/i);
});

test('a tela usa as mensagens de disparo e mostra o motivo da pausa', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../../src/features/broadcasts/components/Broadcasts.jsx'), 'utf8');
  assert.match(screen, /broadcastErrorMessage/);
  assert.match(screen, /broadcastPauseReason\(recoverableCampaign\.last_error\)/);
});
