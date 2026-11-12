import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyClearedBefore, applyDismissed, dismissKey } from '../../src/features/notifications/operatorEvents.js';

const item = (id, createdAt, extra = {}) => ({ id, createdAt, title: id, ...extra });
const read = (file) => fs.readFileSync(new URL('../../src/features/notifications/' + file, import.meta.url), 'utf8');

test('limpar todas esconde o histórico até o instante da limpeza e mantém pendências e avisos novos', () => {
  const clearedAt = Date.parse('2026-11-12T20:00:00Z');
  const items = [item('velho', '2026-11-12T19:00:00Z'), item('pendente', '2026-11-12T10:00:00Z', { pending: true }), item('novo', '2026-11-12T20:00:01Z')];
  assert.deepEqual(applyClearedBefore(items, clearedAt).map(entry => entry.id), ['pendente', 'novo']);
  assert.equal(applyClearedBefore(items, 0).length, 3, 'sem limpeza nada some');
  assert.equal(applyClearedBefore(items, NaN).length, 3);
});

test('dispensar um aviso esconde só ele; se o aviso voltar atualizado, reaparece', () => {
  const a = item('a', '2026-11-12T19:00:00Z'), b = item('b', '2026-11-12T19:01:00Z');
  const dismissed = new Set([dismissKey(a)]);
  assert.deepEqual(applyDismissed([a, b], dismissed).map(entry => entry.id), ['b']);
  assert.deepEqual(applyDismissed([{ ...a, createdAt: '2026-11-12T21:00:00Z' }, b], dismissed).map(entry => entry.id), ['a', 'b'], 'outra data = aviso novo');
  assert.equal(applyDismissed([a, b], new Set()).length, 2);
});

test('o painel tem o menu Limpar todas e Selecionar para limpar, e a seleção uma por uma', () => {
  const panel = read('NotificationPanel.jsx');
  assert.ok(panel.includes('Limpar todas<small>As pendências ficam'));
  assert.ok(panel.includes('Selecionar para limpar<small>Escolha uma por uma'));
  assert.ok(panel.includes('type="checkbox" checked={checked} onChange={toggleSelected}'));
  assert.ok(panel.includes('onClearSelected(filtered.filter('));
  assert.ok(panel.includes('Limpar selecionadas'));
  const center = read('NotificationCenter.jsx');
  assert.ok(center.includes('onClearAll={clearAll} onClearSelected={clearSelected}'));
  assert.ok(center.includes('activity.dismissItems(selected)'));
});

test('o selo usa o símbolo do canal e nenhuma classe global .channel-* (que pinta fundo e texto de verde)', () => {
  const panel = read('NotificationPanel.jsx');
  assert.ok(panel.includes("item.kind === 'message' ? <ChannelIcon channel={item.channel}"));
  assert.ok(!panel.includes('getChannelClass'));
  const toast = read('NotificationToasts.jsx');
  assert.ok(toast.includes('<ChannelIcon channel={latest.channel}'));
  assert.ok(toast.includes('data-channel={channel}'));
  assert.ok(!toast.includes('MessageCircle') && !toast.includes('getChannelClass'));
});

test('o CSS repõe o tamanho do avatar e não usa as classes globais de canal', () => {
  for (const file of ['notifications.css', 'notificationToasts.css']) {
    const css = read(file);
    assert.match(css, /max-width: (36|44)px/, file + ': repõe os máximos de .conversation-avatar');
    assert.doesNotMatch(css, /\.channel-(whatsapp|instagram|telegram)/, file);
  }
  assert.match(read('notificationToasts.css'), /background: #0f182b/, 'fundo sólido: nada do chat aparece por trás do pop-up');
});
