import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyClearedBefore } from '../../src/features/notifications/operatorEvents.js';

const item = (id, createdAt, extra = {}) => ({ id, createdAt, title: id, ...extra });

test('limpar esconde o histórico até o instante da limpeza e mantém pendências e avisos novos', () => {
  const clearedAt = Date.parse('2026-11-12T20:00:00Z');
  const items = [item('velho', '2026-11-12T19:00:00Z'), item('pendente', '2026-11-12T10:00:00Z', { pending: true }), item('novo', '2026-11-12T20:00:01Z')];
  assert.deepEqual(applyClearedBefore(items, clearedAt).map(entry => entry.id), ['pendente', 'novo']);
  assert.equal(applyClearedBefore(items, 0).length, 3, 'sem limpeza nada some');
  assert.equal(applyClearedBefore(items, NaN).length, 3);
});

test('o painel tem o botão de limpar com confirmação e o selo de mensagem usa o símbolo do canal', () => {
  const panel = fs.readFileSync(new URL('../../src/features/notifications/NotificationPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /aria-label=\{confirmClear \? 'Confirmar: limpar notificações' : 'Limpar notificações'\}/);
  assert.match(panel, /item\.kind === 'message' \? <ChannelIcon channel=\{item\.channel\}/);
  const toast = fs.readFileSync(new URL('../../src/features/notifications/NotificationToasts.jsx', import.meta.url), 'utf8');
  assert.match(toast, /<ChannelIcon channel=\{latest\.channel\}/);
  assert.doesNotMatch(toast, /MessageCircle/, 'o pop-up não usa mais o balão genérico');
  const center = fs.readFileSync(new URL('../../src/features/notifications/NotificationCenter.jsx', import.meta.url), 'utf8');
  assert.match(center, /onClear=\{clearAll\}/);
});
