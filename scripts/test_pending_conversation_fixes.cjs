const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const ts = require('../app/node_modules/typescript');
const source = fs.readFileSync(require.resolve('../n8n/sources/noria_core.js'), 'utf8');
const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(n => n.getText(ast)).join('\n');
function harness() {
  const c = { console, Date, JSON, Set, Map, Buffer, URL, tenantSlug: 'fixture', workflowStartedAtMs: Date.now(),
    turn: { boundary_id: 'session', token: 'token', messages: [] } };
  vm.createContext(c); vm.runInContext(functions, c);
  c.settingsFor = () => ({ sales: { document_ocr_enabled: true }, business_facts: { name: 'Empresa própria' } });
  c.salesLastPendingRequirement = () => ''; c.salesModeFor = () => 'sell';
  c.usageGate = () => ({ allowed: true }); c.markUsage = () => {};
  return c;
}
const body = value => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });

test('CRLV e quatro fotos preservam as fotos, sem extrair identidade do proprietário', async () => {
  const c = harness();
  c.turn.messages = Array.from({ length: 5 }, (_, i) => ({ event_id: 'm' + i, id: 'external' + i, text: '[image]' }));
  c.salesClassifyImages = async () => c.turn.messages.map((m, i) => ({ ...m, kind: i ? 'vehicle_photo' : 'vehicle_document', readable: !!i,
    extracted: {}, _asset: { mime: 'image/jpeg', base64: 'AAAA' } }));
  c.httpJson = async () => body({ kind: 'vehicle_document', name: 'Proprietário não é solicitante', cpf: '00000000000', cnh: '00585195056', birth_date: '',
    vehicle: { brand: 'Fiat', model: 'Siena', manufacture_year: '2013', model_year: '2014' } });
  const media = await c.salesReadMedia({}, [], null);
  assert.equal(media.filter(m => m.kind === 'vehicle_photo').length, 4);
  const doc = media.find(m => m.kind === 'vehicle_document');
  assert.equal(doc.extracted.vehicle.model, 'Siena');
  assert.equal(doc.extracted.cpf, undefined); assert.equal(doc.extracted.name, undefined);
  assert.equal(c.salesDocumentStatus(media).cpf_received, false);
});

test('falha de OCR veicular preserva o lote; CPF pessoal inválido continua bloqueado', async () => {
  const c = harness(); c.turn.messages = [{ event_id: 'doc', id: 'doc', text: '[image]' }];
  c.salesClassifyImages = async () => [{ ...c.turn.messages[0], kind: 'vehicle_document', _asset: { mime: 'image/jpeg', base64: 'AAAA' } },
    { event_id: 'foto', kind: 'vehicle_photo', readable: true, extracted: {} }];
  c.httpJson = async () => { throw new Error('SALES_OCR_INCOMPLETE'); };
  const media = await c.salesReadMedia({}, [], null);
  assert.equal(media.find(m => m.kind === 'vehicle_photo').readable, true);
  assert.equal(media.find(m => m.kind === 'vehicle_document').readable, false);
  c.salesClassifyImages = async () => [{ ...c.turn.messages[0], kind: 'document', _asset: { mime: 'image/jpeg', base64: 'AAAA' } }];
  c.httpJson = async () => body({ kind: 'document', name: '', cpf: '00000000000', cnh: '', birth_date: '' });
  await assert.rejects(c.salesReadMedia({}, [], null), /DOCUMENT_REQUIRES_REVIEW/);
});

test('histórico inclui IA antiga, follow-up e humano; falha não conta como abertura', () => {
  const c = harness();
  const history = [
    { id: 'a', direction: 'outbound', sender_type: 'assistant', ai_provider: 'gemini', message_text: 'Já me apresentei.', delivery_status: 'sent', raw_payload: { grounding: { prompt_revision: 'antigo' } } },
    { id: 'f', direction: 'outbound', ai_provider: 'gemini_follow_up', message_text: 'Oi, Nome inventado.', delivery_status: 'sent' },
    { id: 'h', direction: 'outbound', sender_type: 'agent', ai_provider: 'human_operator', message_text: 'Aqui é a equipe.', delivery_status: 'sent' },
    { id: 'err', direction: 'outbound', sender_type: 'system', service: 'technical_error', message_text: 'SEGREDO_TECNICO', delivery_status: 'failed' },
  ];
  const context = c.groundingConversationContext(history);
  assert.equal(context.opening, false);
  assert.deepEqual(Array.from(context.messages, m => m.author), ['assistant', 'follow_up', 'operator']);
  assert.equal(c.groundingConversationContext([history[3]]).opening, true);
  assert.equal(c.groundingKnownCustomerName({}, [{ id: 'f', text: 'Oi, Nome inventado.' }]), null);
  assert.equal(c.groundingKnownCustomerName({ customer_name: 'Nome real', name_evidence: 'in' }, [{ id: 'in', text: 'Sou Nome real' }]).value, 'Nome real');
});

test('contexto é limitado, ordenado e não mistura sessão anterior', () => {
  const c = harness();
  const history = Array.from({ length: 25 }, (_, i) => ({ id: String(i), direction: 'outbound', ai_provider: 'gemini', delivery_status: 'sent', message_text: 'fala ' + i }));
  history.push({ id: 'old', direction: 'outbound', ai_provider: 'gemini', delivery_status: 'sent', message_text: 'outra sessão', raw_payload: { conversation_session_id: 'old' } });
  const context = c.groundingConversationContext(history);
  assert.equal(context.messages.length, 12); assert.equal(context.messages[0].id, '13');
  assert.equal(context.messages.at(-1).id, '24');
});

test('diagnóstico de saída malformada contém só metadados e enum técnico', () => {
  const c = harness(); const b = body({ texto: 'CPF e conteúdo privado' });
  const d = c.modelOutputDiagnostic(b, 'invalid_json', 2);
  assert.equal(d.finish_reason, 'STOP'); assert.equal(d.attempt, 2); assert.ok(d.output_chars > 0);
  assert.equal(d.validation_reason, 'invalid_json');
  assert.ok(!JSON.stringify(d).includes('CPF')); assert.ok(!JSON.stringify(d).includes('privado'));
});

test('projeção comercial gerada inclui a dependência do diagnóstico', () => {
  const projection = fs.readFileSync(require.resolve('../n8n/code/whatsapp_sales.js'), 'utf8');
  assert.match(projection, /function modelOutputDiagnostic\(/);
});

test('robô externo exige evidência atual e ausência de pedido humano; citar empresa não silencia', () => {
  const c = harness(); c.turn.messages = [{ event_id: 'now', text: 'Bem-vinda ao Estúdio Exemplo. Responderemos em breve.', raw: {} }];
  const classification = { kind: 'external_automated_contact', other_business: 'Estúdio Exemplo', evidence_ids: ['now'], quoted_or_forwarded: false, contains_customer_request: false };
  assert.ok(c.groundingAutomatedContactVerdict(classification, {}));
  assert.equal(c.groundingAutomatedContactVerdict({ ...classification, contains_customer_request: true }, {}), null);
  assert.equal(c.groundingAutomatedContactVerdict({ ...classification, quoted_or_forwarded: true }, {}), null);
  assert.equal(c.groundingAutomatedContactVerdict({ ...classification, evidence_ids: ['old'] }, {}), null);
  c.turn.messages.push({ event_id: 'human', text: 'Quero agendar', raw: {} });
  assert.equal(c.groundingAutomatedContactVerdict(classification, {}), null);
});

test('modelo recebe contexto anterior e opening=false sem promover nome de follow-up a fato', async () => {
  const c = harness(); let request;
  c.turn.messages = [{ event_id: 'now', text: 'Bom dia, tudo bem?' }];
  c.settingsFor = () => ({ ai_model: 'gemini-fixture', system_prompt: 'Atenda naturalmente', prompt_revision: 'nova', business_facts: {} });
  c.groundingPreviousState = () => ({}); c.groundingApprovedView = () => null;
  c.buildDateContext = () => ({}); c.tenantBusinessRules = {}; c.env = () => '';
  c.salesGroundedMaxOutputTokens = () => 2048;
  c.httpJson = async (_method, _url, _headers, payload) => { request = payload; return body({ action: 'handoff', reply: 'Resposta validada', state: {} }); };
  c.groundingValidateResponse = () => ({ text: 'Resposta validada', handoff: true });
  c.parseAppointmentCreationTag = () => null; c.schedulingValidateAction = async (_context, value) => value;
  await c.callGroundedGemini({ tenant: { name: 'Empresa' } }, [
    { id: 'intro', direction: 'outbound', sender_type: 'assistant', ai_provider: 'gemini', message_text: 'Já me apresentei', delivery_status: 'sent' },
    { id: 'follow', direction: 'outbound', ai_provider: 'gemini_follow_up', message_text: 'Oi, Nome não comprovado', delivery_status: 'sent' }
  ], { matches: [] }, { rows: [] });
  const input = JSON.parse(request.contents[0].parts[0].text);
  assert.equal(input.opening, false); assert.equal(input.known_customer_name, null);
  assert.deepEqual(input.conversation_context.map(m => m.id), ['intro', 'follow']);
  assert.ok(!JSON.stringify(input.official_facts).includes('Nome não comprovado'));
});

test('ignorar contato só termina depois de confirmar a RPC atômica, sem enviar resposta', async () => {
  const c = harness(); let committed = false, request;
  c.chatId = 'chat'; c.commit = async () => { committed = true; return true; };
  c.supabasePost = async (route, payload) => { request = { route, payload }; return { contract: 'noria_semantic_contact_ignore_v1', finished: true, outcome: 'done' }; };
  const result = await c.ignoreAutomatedContact({ tenant: { id: 'tenant' } }, { model: 'gemini-fixture', ignored_contact: { contract: 'noria_semantic_contact_ignore_v1' } });
  assert.equal(committed, true); assert.equal(result.customer_reply_sent, false);
  assert.equal(request.payload.p_tenant, 'tenant'); assert.equal(request.payload.p_chat, 'chat');
  c.supabasePost = async () => ({ finished: false });
  await assert.rejects(c.ignoreAutomatedContact({ tenant: { id: 'tenant' } }, {}), /SEMANTIC_CONTACT_IGNORE_NOT_CONFIRMED/);
});

test('resposta automática validada sai da geração sem redigir mensagem nem executar agenda', async () => {
  const c = harness(); c.turn.messages = [{ event_id: 'now', text: 'Boas-vindas ao Estúdio Exemplo. Aguarde nosso atendimento.' }];
  c.settingsFor = () => ({ ai_model: 'gemini-fixture', system_prompt: 'Atenda naturalmente', prompt_revision: 'nova', business_facts: {} });
  c.groundingPreviousState = () => ({}); c.groundingApprovedView = () => null;
  c.buildDateContext = () => ({}); c.tenantBusinessRules = {}; c.env = () => ''; c.salesGroundedMaxOutputTokens = () => 2048;
  c.httpJson = async () => body({ contact_context: { kind: 'external_automated_contact', other_business: 'Estúdio Exemplo', evidence_ids: ['now'], quoted_or_forwarded: false, contains_customer_request: false } });
  c.groundingValidateResponse = () => { throw Error('Não deve executar ações de atendimento para esse turno'); };
  const generated = await c.callGroundedGemini({ tenant: { name: 'Empresa própria' } }, [], { matches: [] }, { rows: [] });
  assert.equal(generated.text, ''); assert.equal(generated.ignored_contact.contract, 'noria_semantic_contact_ignore_v1');
});
