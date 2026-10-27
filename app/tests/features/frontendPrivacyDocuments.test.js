import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';
import { applyIncomingEventToConversations } from '../../src/services/conversations/applyIncomingEvent.js';
import { groupTimelineMessages } from '../../src/features/conversations/utils/chatTimelineHelpers.js';

const event = { id: 'review', tenant_slug: 'test', channel_type: 'whatsapp', external_conversation_id: '5500000000000',
  created_at: '2026-10-27T12:47:05Z', direction: 'outbound', sender_type: 'system', service: 'technical_error',
  ai_provider: 'core_operator_review', message_text: 'DOCUMENT_REQUIRES_REVIEW: internal detail', delivery_status: 'internal' };

test('revisão técnica tem apresentação humana no histórico e no Realtime', () => {
  for (const conversations of [eventsToConversations([event], 'test'), applyIncomingEventToConversations([], event, 'test')]) {
    assert.doesNotMatch(conversations[0].lastMessage, /DOCUMENT_|internal detail/);
    const [message] = groupTimelineMessages(conversations[0].messages);
    assert.equal(message.systemEvent.title, 'Atendimento precisa da equipe');
    assert.doesNotMatch(message.systemEvent.detail, /DOCUMENT_|internal detail/);
  }
});

test('evento técnico sem texto informa que o atendimento precisa da equipe', () => {
  const [conversation] = eventsToConversations([{ ...event, message_text: '' }], 'test');
  assert.equal(groupTimelineMessages(conversation.messages)[0].systemEvent.title, 'Atendimento precisa da equipe');
});

test('mensagem legítima de cliente não perde códigos que o próprio cliente escreveu', () => {
  const [conversation] = eventsToConversations([{ ...event, direction: 'inbound', sender_type: 'contact', service: 'sales_qualification', ai_provider: 'sales_core' }], 'test');
  assert.equal(conversation.messages[0].text, event.message_text);
});

test('erros públicos não repetem detalhes arbitrários do servidor', async () => {
  const { userFacingError } = await import('../../src/utils/userFacingError.js');
  assert.equal(userFacingError(new Error('relation private_table not found token=secret'), 'Não foi possível salvar.'), 'Não foi possível salvar.');
  assert.equal(userFacingError({ code: 'invalid_credentials' }, 'Falha.'), 'E-mail ou senha incorretos.');
  assert.match(userFacingError(new Error('SLOT_UNAVAILABLE'), 'Falha.'), /horário/i);
});

test('tela de falha do painel não renderiza a mensagem técnica recebida', async () => {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const ts = (await import('typescript')).default;
  const file = new URL('../../src/app/AppErrorBoundary.jsx', import.meta.url);
  const require = createRequire(file);
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, module, module.exports);
  const boundary = new module.exports.AppErrorBoundary({});
  boundary.state = { error: new Error('TypeError internal_table token=secret') };
  const html = require('react-dom/server').renderToStaticMarkup(boundary.render());
  assert.match(html, /Não foi possível abrir o painel/);
  assert.doesNotMatch(html, /TypeError|internal_table|token=secret/);
});

test('prévia distingue formatos seguros de conteúdo ativo e arquivos sem suporte', async () => {
  const { documentPreviewType } = await import('../../src/services/media/documentPreview.js');
  assert.equal(documentPreviewType({ mimeType: 'application/pdf', fileName: 'CRLV.pdf' }), 'pdf');
  assert.equal(documentPreviewType({ mimeType: 'application/octet-stream', fileName: 'CRLV.PDF' }), 'pdf');
  assert.equal(documentPreviewType({ mimeType: 'image/jpeg', fileName: 'documento.jpg' }), 'image');
  assert.equal(documentPreviewType({ mimeType: 'text/plain' }), 'text');
  assert.equal(documentPreviewType({ mimeType: 'text/html', fileName: 'enganoso.pdf' }), null);
  assert.equal(documentPreviewType({ mimeType: 'image/svg+xml' }), null);
  assert.equal(documentPreviewType({ fileName: 'documento.docx' }), null);
});

test('PDF com cabeçalho de download vira conteúdo local; HTML disfarçado é rejeitado', async () => {
  const { loadDocumentPreview } = await import('../../src/services/media/documentPreview.js');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://storage.example/arquivo');
      assert.equal(options.credentials, 'omit');
      return new Response('%PDF-1.4\nfixture', { headers: { 'content-disposition': 'attachment; filename="arquivo.pdf"' } });
    };
    const result = await loadDocumentPreview('https://storage.example/arquivo', { mimeType: 'application/pdf' });
    assert.equal(result.blob.type, 'application/pdf');
    assert.match(await result.blob.text(), /^%PDF-/);
    globalThis.fetch = async () => new Response('<html>conteúdo ativo</html>');
    await assert.rejects(loadDocumentPreview('https://storage.example/arquivo', { mimeType: 'application/pdf' }), /PREVIEW_INVALID/);
    await assert.rejects(loadDocumentPreview('javascript:alert(1)', { mimeType: 'application/pdf' }), /PREVIEW_SOURCE_INVALID/);
  } finally { globalThis.fetch = originalFetch; }
});

test('prévia limita bytes reais mesmo sem Content-Length confiável', async () => {
  const { loadDocumentPreview, DOCUMENT_PREVIEW_LIMIT } = await import('../../src/services/media/documentPreview.js');
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(DOCUMENT_PREVIEW_LIMIT));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } }));
    await assert.rejects(loadDocumentPreview('https://storage.example/arquivo', { mimeType: 'application/pdf' }), /PREVIEW_TOO_LARGE/);
    globalThis.fetch = async () => new Response('<script>texto, não código</script>');
    const result = await loadDocumentPreview('https://storage.example/arquivo', { mimeType: 'text/plain' });
    assert.equal(result.text, '<script>texto, não código</script>');
  } finally { globalThis.fetch = originalFetch; }
});
