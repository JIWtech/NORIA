const assert = require('node:assert/strict');
const { test } = require('node:test');
const { wrapSalonEngine } = require('./conversation_adapter.cjs');

const tenant = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const chat = '5511000000000@s.whatsapp.net';
const name = 'João Victor Santos';
// A transferência sempre acompanha texto visível (padrão do código quando o tenant não configura o seu).
const handoff = 'Não consegui concluir isso por aqui agora. Vou pedir para a equipe conferir e continuar seu atendimento. [HUMANO_SOLICITADO]';
const priceFallback = 'A equipe pode confirmar o valor certinho para você.';
const tag = '[ACAO: CRIAR_AGENDAMENTO|nome=' + name + '|servico=Corte|data=2099-09-29|hora=10:00|status=pending_confirmation]';
const core = [
  'const NORIA_NODE_PHASE = $json.noria_engine_phase;',
  'const helpers = this.helpers;',
  'for (const options of $json.calls) await helpers.httpRequest(options);',
  'return helpers.httpRequest($json.modelRequest);',
].join('\n');

const base = 'https://db.test';
const eventUrl = base + '/rest/v1/channel_events?select=*&tenant_slug=eq.ic_salon&channel_type=eq.whatsapp'
  + '&external_conversation_id=eq.' + encodeURIComponent(chat) + '&created_at=gt.2026-11-10T00%3A00%3A00Z&limit=50';
const input = {
  tenant_id: tenant, tenant_slug: 'ic_salon', instance: 'ic_saloon', remoteJid: chat, noria_engine_phase: 'single',
  calls: [
    { method: 'GET', url: base + '/rest/v1/tenant_settings?select=*&tenant_id=eq.' + tenant },
    { method: 'GET', url: eventUrl },
  ],
  modelRequest: {
    method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    body: {
      system_instruction: { parts: [{ text: 'AGENDAMENTOS CONHECIDOS PELO SISTEMA\nREGRAS OPERACIONAIS CURTAS' }] },
      contents: [{ role: 'user', parts: [{ text: 'Quero marcar corte para mim.' }] }],
    },
  },
};
const execute = Object.getPrototypeOf(async function () {}).constructor('$json', '$env', wrapSalonEngine(core));
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });

test('o adaptador usa a mesma fronteira de atendimento e só libera ação com evidência', async () => {
  async function run({ draft = tag, evidence = true, audit = { allowed: true, evidence_id: 'event-old' },
    priceReport, currentText, scope = input, finishReason = 'STOP', repaired } = {}) {
    const requests = [];
    if (currentText) {
      scope = structuredClone(scope);
      scope.modelRequest.body.contents[0].parts[0].text = currentText;
    }
    const output = await execute.call({ helpers: { async httpRequest(options) {
      const url = new URL(options.url);
      requests.push(options);
      if (url.pathname.endsWith('tenant_settings')) {
        return [{ settings: { price_rejection_template: priceFallback } }];
      }
      if (url.searchParams.get('limit') === '50') return [];
      if (url.pathname.endsWith('channel_events')) {
        assert.equal(url.searchParams.get('tenant_id'), 'eq.' + tenant);
        assert.equal(url.searchParams.get('external_conversation_id'), 'eq.' + chat);
        assert.equal(url.searchParams.get('created_at'), 'gt.2026-11-10T00:00:00Z');
        assert.equal(url.searchParams.get('direction'), 'eq.inbound');
        assert.equal(url.searchParams.get('sender_type'), 'eq.contact');
        return evidence ? [{ id: 'event-old', message_text: name }] : [];
      }
      if (url.pathname.endsWith('/appointments')) {
        assert.equal(url.searchParams.get('tenant_id'), 'eq.' + tenant);
        return [];
      }
      if (url.pathname.endsWith('tenant_service_catalog')) {
        assert.equal(url.searchParams.get('tenant_id'), 'eq.' + tenant);
        assert.equal(url.searchParams.get('active'), 'eq.true');
        return [{ tenant_id: tenant, active: true, external_id: 'corte', name: 'Corte', price: 140, metadata: { price_type: 'fixed' } }];
      }
      if (options.body.system_instruction.parts[0].text.startsWith('Você é um auditor de mensagens')) {
        const { message } = JSON.parse(options.body.contents[0].parts[0].text);
        return reply(JSON.stringify({ complete: true, segments: priceReport || [{ kind: 'non_price', text: message }] }));
      }
      if (options.body.system_instruction.parts.length === 1) {
        return reply(JSON.stringify(typeof audit === 'function' ? audit(JSON.parse(options.body.contents[0].parts[0].text)) : audit));
      }
      if (options.body.system_instruction.parts.length === 3) return reply(repaired || '', finishReason);
      assert.equal(JSON.stringify(options.body.contents).includes(name), false);
      assert.equal(options.body.system_instruction.parts[1].text.includes(name), evidence);
      return reply(draft, finishReason);
    } } }, scope, { SUPABASE_URL: base });
    return { text: output.candidates[0].content.parts[0].text, requests };
  }

  assert.equal((await run({ draft: 'Já anotei seu pedido! ' + tag })).text, tag);
  assert.equal((await run({ draft: 'Já anotei seu pedido.' })).text, handoff);
  assert.equal((await run({ draft: 'Tudo pronto com a sua marcação.', audit: { allowed: false, evidence_id: '' } })).text, handoff);
  assert.equal((await run({ draft: 'Tudo bem? Como posso ajudar?', audit: { allowed: true, evidence_id: '' } })).text, 'Tudo bem? Como posso ajudar?');
  assert.equal((await run({ draft: 'Já anotei', finishReason: 'MAX_TOKENS' })).text, handoff);
  // Serviço, dia e hora claros sem nome comprovado: pede o nome completo, não é falha técnica.
  assert.equal((await run({ evidence: false })).text, 'Para eu anotar certinho, qual é o seu nome completo?');
  assert.equal((await run({ audit: { allowed: true, evidence_id: 'invented' } })).text, handoff);
  const range = await run({ currentText: 'Entre 9 e 12', repaired: 'Qual horário nesse intervalo você prefere?',
    audit: payload => {
      if (payload.booking) {
        assert.equal(payload.booking.time, '10:00');
        assert.equal(payload.booking.date, '2099-09-29');
        assert.equal(payload.booking.service, 'Corte');
        assert.equal(payload.recent_context.at(-1).parts[0].text, 'Entre 9 e 12');
      }
      return { allowed: !payload.booking, evidence_id: '' };
    } });
  assert.equal(range.text, 'Qual horário nesse intervalo você prefere?');
  const priceText = 'O corte custa R$ 140,00.';
  assert.equal((await run({ draft: priceText, priceReport: [
    { kind: 'catalog_price', text: priceText, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' },
  ] })).text, priceText);
  assert.equal((await run({ draft: 'O corte custa R$ 50,00.' })).text, priceFallback);
  const repeatedQuestion = 'Qual horário você prefere para amanhã?';
  const withFollowup = priceText + '\n\n' + repeatedQuestion;
  const priceSegment = { kind: 'catalog_price', text: priceText, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' };
  const filtered = await run({ draft: withFollowup, currentText: 'Quanto custa o corte?',
    audit: { allowed: true, evidence_id: '', remove_suffix: repeatedQuestion }, priceReport: [priceSegment] });
  assert.equal(filtered.text, priceText);
  const requested = await run({ draft: withFollowup, currentText: 'Quanto custa o corte? Quero marcar para amanhã.',
    audit: { allowed: true, evidence_id: '', remove_suffix: '' }, priceReport: [
      priceSegment, { kind: 'non_price', text: '\n\n' + repeatedQuestion },
    ] });
  assert.equal(requested.text, withFollowup);
  const emoji = await run({ draft: 'Tudo bem? 😊',
    audit: { allowed: true, evidence_id: '', remove_suffix: '😊' } });
  assert.equal(emoji.text, 'Tudo bem? 😊');
  await assert.rejects(run({ scope: { ...input, tenant_id: 'other' } }), /IC_SALON_ADAPTER_SCOPE_INVALID/);
});
