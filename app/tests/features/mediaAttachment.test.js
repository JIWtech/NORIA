import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as lucide from 'lucide-react';
import * as mediaPresentation from '../../src/services/media/mediaPresentation.js';
import * as audioUtils from '../../src/utils/audioUtils.js';
import * as mediaUrlService from '../../src/services/media/mediaUrlService.js';
import * as authService from '../../src/services/auth/authService.js';
import * as storageErrors from '../../src/services/media/storageErrors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mediaAttachmentPath = path.resolve(__dirname, '../../src/features/conversations/components/MediaAttachment.jsx');
const sourceCode = fs.readFileSync(mediaAttachmentPath, 'utf8');

function loadMediaAttachment() {
  const { outputText } = ts.transpileModule(sourceCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const stubComponent = (name) => function StubComponent(props) {
    return React.createElement('div', { 'data-component': name, 'data-kind': props?.media?.kind || props?.kind || '' });
  };

  const mocks = {
    react: React,
    'lucide-react': lucide,
    './DocumentAttachment.jsx': { DocumentAttachment: stubComponent('DocumentAttachment') },
    './ProductAttachment.jsx': { ProductAttachment: stubComponent('ProductAttachment') },
    './AudioRecoveryNotice.jsx': { AudioRecoveryNotice: stubComponent('AudioRecoveryNotice') },
    './TranscribedAudioCard.jsx': { TranscribedAudioCard: stubComponent('TranscribedAudioCard') },
    './MediaCaption.jsx': { MediaCaption: stubComponent('MediaCaption') },
    './MediaMeta.jsx': { MediaMeta: stubComponent('MediaMeta') },
    './MediaViewer.jsx': { MediaViewer: stubComponent('MediaViewer') },
    '../../../components/AudioMessagePlayer.jsx': { AudioMessagePlayer: stubComponent('AudioMessagePlayer') },
    '../../../services/media/mediaPresentation.js': mediaPresentation,
    '../../../utils/audioUtils.js': audioUtils,
    '../../../services/media/mediaUrlService.js': mediaUrlService,
    '../../../services/auth/authService.js': authService,
    '../../../services/media/storageErrors.js': storageErrors,
  };

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', outputText);
  fn((id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    throw new Error(`Unexpected import in MediaAttachment.jsx: ${id}`);
  }, mod, mod.exports);

  return mod.exports.MediaAttachment;
}

const HOOK_NAMES = new Set([
  'useState',
  'useEffect',
  'useRef',
  'useMemo',
  'useCallback',
  'useContext',
  'useReducer',
  'useLayoutEffect',
]);

function collectNodes(node, predicate, out = []) {
  if (predicate(node)) out.push(node);
  ts.forEachChild(node, (child) => { collectNodes(child, predicate, out); });
  return out;
}

test('C1: MediaAttachment é um wrapper sem hooks e o componente interno chama todos os hooks antes de qualquer return', () => {
  const sf = ts.createSourceFile(mediaAttachmentPath, sourceCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const functions = collectNodes(sf, (n) => ts.isFunctionDeclaration(n) && Boolean(n.name));
  const wrapper = functions.find((n) => n.name.text === 'MediaAttachment');
  const inner = functions.find((n) => n.name.text === 'MediaAttachmentContent');

  assert.ok(wrapper, 'MediaAttachment precisa existir');
  assert.ok(inner, 'MediaAttachmentContent precisa existir');

  const wrapperHooks = collectNodes(
    wrapper.body,
    (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK_NAMES.has(n.expression.text),
  );
  assert.equal(wrapperHooks.length, 0, 'O wrapper MediaAttachment não pode chamar hooks antes dos returns');

  // No componente interno, todo return top-level (fora de callbacks aninhados) deve vir DEPOIS do último hook.
  const topLevelReturns = [];
  const topLevelHooks = [];
  for (const stmt of inner.body.statements) {
    for (const ret of collectNodes(stmt, (n) => ts.isReturnStatement(n))) {
      // Ignora returns dentro de arrow functions / callbacks passados a hooks.
      let parent = ret.parent;
      let insideNestedFunction = false;
      while (parent && parent !== inner) {
        if (ts.isFunctionLike(parent)) {
          insideNestedFunction = true;
          break;
        }
        parent = parent.parent;
      }
      if (!insideNestedFunction) topLevelReturns.push(ret);
    }
    for (const call of collectNodes(stmt, (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK_NAMES.has(n.expression.text))) {
      let parent = call.parent;
      let insideNestedFunction = false;
      while (parent && parent !== inner) {
        if (ts.isFunctionLike(parent)) {
          insideNestedFunction = true;
          break;
        }
        parent = parent.parent;
      }
      if (!insideNestedFunction) topLevelHooks.push(call);
    }
  }

  assert.ok(topLevelHooks.length > 0, 'MediaAttachmentContent deve conter hooks');
  const lastHookPos = Math.max(...topLevelHooks.map((h) => h.pos));
  const firstReturnPos = Math.min(...topLevelReturns.map((r) => r.pos));
  assert.ok(firstReturnPos > lastHookPos, 'Nenhum return pode preceder hooks em MediaAttachmentContent');
});

test('C1: MediaAttachment retorna null para mídia ausente/texto e delega ao componente interno para mídia real', () => {
  const MediaAttachment = loadMediaAttachment();

  assert.equal(MediaAttachment({ media: null }), null);
  assert.equal(MediaAttachment({ media: { kind: 'text' } }), null);
  assert.equal(MediaAttachment({ media: { kind: 'conversation' } }), null);
  assert.equal(MediaAttachment({ media: { kind: 'none' } }), null);

  const realElement = MediaAttachment({ media: { kind: 'image', url: 'https://example.com/foto.jpg' } });
  assert.ok(realElement, 'Mídia real deve retornar elemento React');
  assert.equal(realElement.type.name, 'MediaAttachmentContent');

  assert.equal(renderToStaticMarkup(React.createElement(MediaAttachment, { media: { kind: 'text' } })), '');
  const html = renderToStaticMarkup(
    React.createElement(MediaAttachment, { media: { kind: 'image', url: 'https://example.com/foto.jpg' } }),
  );
  assert.match(html, /media-image/);
});
