const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../n8n/sources/noria_core.js'), 'utf8');
const start = source.indexOf('const salesNaturalDialogue = ');
const end = source.indexOf('const salesDialogueTopics');
assert.ok(start >= 0 && end > start, 'salesNaturalDialogue não encontrado em noria_core.js');
const sandbox = { console, Date, Map, Set, JSON, Intl };
vm.createContext(sandbox);
vm.runInContext(source.slice(start, end).replace('const salesNaturalDialogue', 'var salesNaturalDialogue'), sandbox);
const dialogue = sandbox.salesNaturalDialogue;

// O CORE só envia imagens de produto; não existe capacidade de enviar vídeo.
// Isso é fato de plataforma, não intenção inferida de palavra do cliente.
test('contrato de resposta declara que vídeo do veículo não é enviável', () => {
  assert.equal(dialogue.responseContract({}, {}, {}).vehicle_video_allowed, false);
});

test('resposta que oferece ou cita vídeo inexistente é rejeitada pelo comportamento', () => {
  const guards = { ...dialogue.responseContract({}, {}, {}) };
  const issues = dialogue.validateBehavior({ asserts_unavailable_media: true }, guards);
  assert.ok(issues.includes('UNAVAILABLE_MEDIA_ASSERTION'), issues.join(','));
});

test('resposta sem afirmação de mídia indisponível não gera issue', () => {
  const guards = { ...dialogue.responseContract({}, {}, {}) };
  const issues = dialogue.validateBehavior({ asserts_unavailable_media: false }, guards);
  assert.ok(!issues.includes('UNAVAILABLE_MEDIA_ASSERTION'));
});

test('redator e auditor recebem a restrição de mídia', () => {
  const extension = fs.readFileSync(path.resolve(__dirname, '../n8n/sources/genesis_extension.js'), 'utf8');
  assert.match(extension, /vehicle_video_allowed=false/);
  assert.match(source, /dialogue\?\.composition_instruction/);
  assert.match(source, /asserts_unavailable_media: \{ type: 'BOOLEAN' \}/);
});
