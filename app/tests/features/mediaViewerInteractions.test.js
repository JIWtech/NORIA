import test from 'node:test';
import assert from 'node:assert/strict';

test('soltar arraste, imagem e controles não fecha; clique direto no fundo fecha', async () => {
  const { shouldCloseMediaViewer } = await import('../../src/features/conversations/utils/viewerInteractions.js');
  const stage = {}, image = {}, control = {};
  assert.equal(shouldCloseMediaViewer({ target: stage, currentTarget: stage }, { moved: false, startedOnBackdrop: true }), true);
  assert.equal(shouldCloseMediaViewer({ target: image, currentTarget: stage }, { moved: false, startedOnBackdrop: false }), false);
  assert.equal(shouldCloseMediaViewer({ target: control, currentTarget: stage }, { moved: false, startedOnBackdrop: true }), false);
  assert.equal(shouldCloseMediaViewer({ target: stage, currentTarget: stage }, { moved: true, startedOnBackdrop: false }), false);
  // A captura de ponteiro pode redirecionar o click ao palco mesmo sem arraste.
  assert.equal(shouldCloseMediaViewer({ target: stage, currentTarget: stage }, { moved: false, startedOnBackdrop: false }), false);
  assert.equal(shouldCloseMediaViewer({ target: stage, currentTarget: stage }, { moved: true, startedOnBackdrop: true }), false);
});
