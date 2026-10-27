// Núbia/Gênesis 24-27/10: follow-up depois de o cliente encerrar ("Não, obrigada" → 3 follow-ups em …67228) e
// despedidas atrasadas enviadas como follow-up ("Por nada! Tenha um ótimo dia." às 09:02). Duas regras:
// 1. encerramento validado pelo modelo, com prova na mensagem atual do cliente, cancela e não agenda follow-up;
// 2. o follow-up é uma retomada: o gerador pode recusar (skip) e uma despedida nunca é enviada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dispatch = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_follow_up_dispatch.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };

function withClock(iso, fn) {
  const Real = Date, fixed = new Real(iso).getTime();
  class Fixed extends Real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }
  globalThis.Date = Fixed;
  return fn().finally(() => { globalThis.Date = Real; });
}

async function run({ sales = false, modelText = '{"action":"send","reply":"Oi! Ficou alguma dúvida sobre os serviços?"}', anchor = {} } = {}) {
  const calls = [], finishes = []; let sends = 0, models = 0, prompt = null;
  const job = { id: 'job', lease_token: 'lease', tenant_id: 'tenant', tenant_slug: 'client', channel_type: 'whatsapp',
    external_conversation_id: '5521988887777@s.whatsapp.net', anchor_created_at: '2026-10-01T12:00:00Z', anchor_event_id: 'anchor', step_key: '3h' };
  const settings = { ...(sales ? { conversation_capability: 'sales_v1' } : {}), ai_model: 'gemini-2.5-flash', system_prompt: 'Prompt',
    sales_follow_up: { enabled: true, messages: { '3h': 'Podemos continuar seu atendimento?' } } };
  const request = async ({ url, method, body }) => {
    calls.push({ url, method, body }); const u = new URL(url), table = u.pathname.split('/').at(-1);
    if (table === 'magia_claim_followup_jobs') return [job];
    if (table === 'tenant_settings') return [{ settings }];
    if (table === 'magia_validate_sales_followup') return { allowed: true };
    if (table === 'magia_finish_followup_job') { finishes.push(body); return true; }
    if (table === 'magia_gemini_reserve') return { allowed: true };
    if (table === 'magia_gemini_release') return true;
    if (table === 'appointments') return [];
    if (table === 'channel_events') {
      if (method === 'POST') return [{ id: 'sent' }];
      if (u.search.includes('id=eq.anchor')) {
        assert.match(u.search, /tenant_id=eq\.tenant/);
        return [{ id: 'anchor', raw_payload: anchor }];
      }
      return [];
    }
    if (table === 'channels') return [{ external_id: 'client' }];
    if (u.hostname === 'evo.test') { sends++; return { key: { id: 'msg' } }; }
    if (u.hostname === 'generativelanguage.googleapis.com') {
      models++; prompt = body;
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: modelText }] } }] };
    }
    throw Error('Unexpected ' + url);
  };
  const result = await withClock('2026-10-24T18:00:00Z', () => new AsyncFunction('$env', dispatch).call({ helpers: { httpRequest: request } },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', GEMINI_API_KEY: 'fake',
      EVOLUTION_API_URL_CLIENT: 'https://evo.test', EVOLUTION_API_KEY_CLIENT: 'fake', EVOLUTION_INSTANCE_CLIENT: 'client' }));
  return { result, calls, finishes, sends, models, prompt };
}

test('despachante: cliente encerrou na conversa de origem → cancela sem gerar nem enviar', async () => {
  for (const value of ['closed', 'declined', 'deferred']) {
    const r = await run({ anchor: { grounding: { customer_disposition: { value, evidence_ids: ['in-1'] } } } });
    assert.equal(r.sends, 0); assert.equal(r.models, 0);
    assert.equal(r.finishes[0].p_status, 'cancelled');
    assert.equal(r.finishes[0].p_error, 'customer_' + value);
  }
});

test('despachante: conversa ativa segue o fluxo normal', async () => {
  const r = await run({ anchor: { grounding: { customer_disposition: { value: 'active', evidence_ids: [] } } } });
  assert.equal(r.sends, 1); assert.equal(r.finishes[0].p_status, 'sent');
});

test('despachante: o gerador pode recusar; recusa cancela sem enviar', async () => {
  const r = await run({ modelText: '{"action":"skip","reply":""}' });
  assert.equal(r.models, 1); assert.equal(r.sends, 0);
  assert.equal(r.finishes[0].p_status, 'cancelled');
  assert.equal(r.finishes[0].p_error, 'follow_up_not_applicable');
});

test('despachante: o gerador é instruído a retomar, nunca a se despedir ou responder a última mensagem', async () => {
  const r = await run();
  const input = JSON.parse(r.prompt.contents[0].parts[0].text);
  const rules = input.rules.join(' ');
  assert.match(rules, /retomada/i);
  assert.match(rules, /despedida|agradecimento/i);
  assert.match(rules, /skip/);
  assert.deepEqual(r.prompt.generationConfig.responseSchema.properties.action.enum, ['send', 'skip']);
});

test('despachante: resposta no formato antigo (só reply) continua enviando', async () => {
  const r = await run({ modelText: '{"reply":"Oi! Ficou alguma dúvida?"}' });
  assert.equal(r.sends, 1);
});

test('despachante: vendas (mensagem configurada) não muda', async () => {
  const r = await run({ sales: true });
  assert.equal(r.sends, 1); assert.equal(r.models, 0);
});

test('CORE: encerramento só vale com prova na mensagem atual do cliente', () => {
  const disposition = new Function(slice('groundingCustomerDisposition') + '; return groundingCustomerDisposition;')();
  const current = ['in-1', 'in-2'];
  assert.deepEqual(disposition({ value: 'closed', evidence_ids: ['in-2'] }, current), { value: 'closed', evidence_ids: ['in-2'] });
  assert.deepEqual(disposition({ value: 'deferred', evidence_ids: ['in-1'] }, current), { value: 'deferred', evidence_ids: ['in-1'] });
  for (const raw of [{ value: 'closed', evidence_ids: [] }, { value: 'closed', evidence_ids: ['antiga'] }, { value: 'closed', evidence_ids: ['in-1', 'antiga'] },
    { value: 'bye', evidence_ids: ['in-1'] }, null, undefined, { value: 'active', evidence_ids: ['in-1'] }]) {
    assert.equal(disposition(raw, current).value, 'active', JSON.stringify(raw));
  }
});

test('CORE: o modelo da Núbia declara o encerramento no contrato estruturado', () => {
  const schema = slice('groundingResponseSchema');
  assert.match(schema, /customer_disposition: \{ type: 'OBJECT'/);
  assert.match(schema, /enum: \['active', 'closed', 'declined', 'deferred'\]/);
  assert.match(schema, /required: \['action', 'reply', 'message_keys', 'state', 'price_claims', 'customer_disposition'\]/);
  assert.match(slice('callGroundedGemini'), /audit\.customer_disposition = groundingCustomerDisposition\(value\.customer_disposition, turn\.messages\.map/);
});

test('CORE: encerramento validado cancela pendentes e não agenda; conversa ativa agenda', async () => {
  const build = (grounding, sales = false) => {
    const log = { cancelled: [], scheduled: 0 };
    const fn = new AsyncFunction('settingsFor', 'salesEnabled', 'salesUsesStructuredDialogue', 'cancelPendingFollowUps', 'httpJson', 'supabaseUrl', 'supabaseHeaders', 'chatId', 'turn', 'firstName',
      'async ' + slice('scheduleFollowUps') + '; return scheduleFollowUps(...arguments[10]);');
    return { log, call: () => fn(() => ({ follow_up_enabled: true }), () => sales, () => true,
      async (_, reason) => { log.cancelled.push(reason); }, async () => { log.scheduled++; return 2; }, p => p, () => ({}), 'chat', { messages: [{ name: 'Ana' }] }, 'Ana',
      [{ tenant: { id: 'tenant' } }, { id: 'sent' }, { service: 'geral', handoff: false, raw_payload: { grounding } }]) };
  };
  for (const value of ['closed', 'declined', 'deferred']) {
    const { log, call } = build({ customer_disposition: { value, evidence_ids: ['in-1'] } });
    assert.equal(await call(), 0);
    assert.deepEqual(log.cancelled, ['customer_' + value]);
    assert.equal(log.scheduled, 0);
  }
  const active = build({ customer_disposition: { value: 'active', evidence_ids: [] } });
  assert.equal(await active.call(), 2);
  assert.equal(active.log.cancelled.length, 0);
});
