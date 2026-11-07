// Comandos do dono sobre o pedido de agendamento: confirmar e recusar o horário. Conferem versão e horário no servidor,
// enviam só o modelo do tenant, resolvem entrega incerta sem reenvio e não travam a IA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// O painel chama o nó "Executar Comando1" da Entrada, não o arquivo: os dois precisam passar.
const entrada = JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
const routers = [
  ['arquivo', fs.readFileSync(path.join(__dirname, '../n8n/code/command_router.js'), 'utf8')],
  ['nó publicado', entrada.nodes.find(node => node.name === 'Executar Comando1').parameters.jsCode],
].map(([label, code]) => [label, new AsyncFunction('$json', '$env', '$vars', code)]);
let fn;

const request = {
  mode: 'operator_confirmation', received_template: 'Anotado.',
  confirmation_template: '{nome}, confirmado: {servicos}, {data}, às {hora}.',
  slot_rejected_template: '{nome}, esse horário não está disponível. Qual outro fica bom?',
};
const FUTURE = '2099-09-29T13:00:00Z';

async function run({ command = 'confirm_appointment_request', status = 'pending_confirmation', starts = FUTURE, chat = 'chat', member = true, race = false, failSend = false,
  metadata = {}, config = request, conflicts = [], payload = {} } = {}) {
  const row = { id: 'appt', tenant_id: 'salon-id', channel_type: 'whatsapp', external_conversation_id: chat, status, starts_at: starts, contact_name: 'Maria Silva',
    metadata: { services: ['Corte', 'Escova'], request_version: 2, ...metadata }, updated_at: '2026-11-06T10:00:00Z' };
  let sends = 0, sentText = '';
  const writes = [], events = [];
  const req = async ({ method, url, body }) => {
    const u = new URL(url); const table = u.pathname.split('/').at(-1);
    if (u.hostname === 'evo.test') { sends++; sentText = body.text; if (failSend) throw Error('timeout'); return { key: { id: 'sent-1' } }; }
    if (table === 'user') return { id: 'owner', email: 'owner@example.test' };
    if (table === 'tenants') return [{ id: 'salon-id', slug: 'salon', status: 'active' }];
    if (table === 'tenant_members') return member ? [{ role: 'owner', status: 'active' }] : [];
    if (table === 'tenant_settings') return [{ timezone: 'America/Sao_Paulo', settings: { whatsapp_processing_mode: 'conversation_core_v1', ...(config ? { appointment_request: config } : {}) } }];
    if (table === 'magia_appointment_request_conflicts') { assert.equal(body.p_tenant, 'salon-id'); return conflicts; }
    if (table === 'appointments') {
      assert.equal(u.searchParams.get('tenant_id'), 'eq.salon-id');
      if (method === 'GET') return [{ ...row }];
      if (race && u.searchParams.has('updated_at')) return [];
      Object.assign(row, body); writes.push(body); return [{ ...row }];
    }
    if (table === 'channel_events') { events.push(body); return [{ id: 'event' }]; }
    throw Error('Unexpected ' + url);
  };
  const input = { headers: { authorization: 'Bearer test' }, body: { command, tenant_slug: 'salon', payload: {
    appointment_id: 'appt', channel_type: 'whatsapp', external_conversation_id: 'chat', request_version: 2, ...payload } } };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'fake', SUPABASE_SERVICE_ROLE_KEY: 'fake', EVOLUTION_API_URL_SALON: 'https://evo.test', EVOLUTION_API_KEY_SALON: 'fake', EVOLUTION_INSTANCE_SALON: 'salon' };
  const result = (await fn.call({ helpers: { httpRequest: req } }, input, env, {})).json;
  return { result, sends, sentText, writes, events, row };
}

for (const [label, router] of routers) {
  const use = () => { fn = router; };
  test(label + ': confirmar envia o modelo do tenant com o dia da semana certo e confirma', async () => { use();
    const r = await run();
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.equal(r.sends, 1);
    assert.equal(r.sentText, 'Maria Silva, confirmado: Corte e Escova, sábado, 29 de setembro, às 10:00.'.replace('sábado', new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(new Date(FUTURE))));
    assert.equal(r.row.status, 'confirmed');
  });

  test(label + ': o evento da confirmação não trava a IA', async () => { use();
    const event = (await run()).events.at(-1);
    assert.equal(event.handoff, false);
    assert.equal(event.sender_type, 'system');
    assert.equal(event.service, 'appointment_request_confirmed');
    assert.equal(event.stage, 'Agendamento confirmado');
    assert.equal(event.external_message_id, 'sent-1');
  });

  test(label + ': confirmar de novo não reenvia', async () => { use();
    const r = await run({ status: 'confirmed' });
    assert.equal(r.result.ok, true);
    assert.equal(r.result.already_confirmed, true);
    assert.equal(r.sends, 0);
  });

  test(label + ': versão antiga é recusada e nada é enviado', async () => { use();
    const r = await run({ metadata: { request_version: 3 } });
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /alterado/i);
    assert.equal(r.sends, 0);
    assert.equal(r.writes.length, 0);
  });

  test(label + ': horário vencido não confirma, mas pode ser recusado', async () => { use();
    const late = await run({ starts: '2020-01-01T13:00:00Z' });
    assert.equal(late.result.ok, false);
    assert.equal(late.sends, 0);
    const reject = await run({ command: 'reject_appointment_slot', starts: '2020-01-01T13:00:00Z' });
    assert.equal(reject.result.ok, true, JSON.stringify(reject.result));
  });

  test(label + ': conversa errada, operador de fora, status errado ou modo desligado não enviam', async () => { use();
    for (const options of [{ chat: 'other' }, { member: false }, { status: 'pending_payment' }, { status: 'cancelled' }, { config: null }, { config: { ...request, confirmation_template: '' } }]) {
      const r = await run(options);
      assert.equal(r.result.ok, false, JSON.stringify(options));
      assert.equal(r.sends, 0);
      assert.equal(r.writes.length, 0);
    }
  });

  test(label + ': clique concorrente perde antes de enviar', async () => { use();
    const r = await run({ race: true });
    assert.equal(r.result.ok, false);
    assert.equal(r.sends, 0);
  });

  test(label + ': conflito exige segundo clique e nada é enviado antes dele', async () => { use();
    const conflicts = [{ id: 'x', title: 'Escova - Ana', starts_at: FUTURE }];
    const first = await run({ conflicts });
    assert.equal(first.result.ok, true);
    assert.equal(first.result.requires_acknowledgement, true);
    assert.deepEqual(first.result.conflicts, conflicts);
    assert.equal(first.sends, 0);
    assert.equal(first.writes.length, 0);
    const second = await run({ conflicts, payload: { conflicts_acknowledged: true } });
    assert.equal(second.sends, 1);
    assert.equal(second.row.status, 'confirmed');
  });

  test(label + ': entrega incerta não confirma e bloqueia novo envio', async () => { use();
    const r = await run({ failSend: true });
    assert.equal(r.result.ok, false);
    assert.equal(r.row.status, 'pending_confirmation');
    assert.equal(r.row.metadata.confirmation_state, 'uncertain');
    assert.equal(r.row.metadata.confirmation_action, 'confirm');
    const retry = await run({ metadata: r.row.metadata });
    assert.equal(retry.result.ok, false);
    assert.equal(retry.sends, 0);
  });

  test(label + ': o dono resolve a entrega incerta sem reenviar', async () => { use();
    const stuck = { confirmation_state: 'uncertain', confirmation_action: 'confirm' };
    const delivered = await run({ metadata: stuck, payload: { uncertain_resolution: 'delivered' } });
    assert.equal(delivered.result.ok, true, JSON.stringify(delivered.result));
    assert.equal(delivered.sends, 0);
    assert.equal(delivered.row.status, 'confirmed');
    assert.equal(delivered.row.metadata.confirmation_state, 'sent');
    const lost = await run({ metadata: stuck, payload: { uncertain_resolution: 'not_delivered' } });
    assert.equal(lost.sends, 0);
    assert.equal(lost.row.status, 'pending_confirmation');
    assert.equal(lost.row.metadata.confirmation_state, undefined);
    const refused = await run({ metadata: { ...stuck, confirmation_action: 'reject' }, command: 'reject_appointment_slot', payload: { uncertain_resolution: 'delivered' } });
    assert.equal(refused.row.status, 'cancelled');
  });

  test(label + ': resolver sem nada pendente é recusado', async () => { use();
    const r = await run({ payload: { uncertain_resolution: 'delivered' } });
    assert.equal(r.result.ok, false);
    assert.equal(r.row.status, 'pending_confirmation');
  });

  test(label + ': recusar envia o modelo, cancela com motivo e devolve a conversa à IA', async () => { use();
    const r = await run({ command: 'reject_appointment_slot' });
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.equal(r.sentText, 'Maria Silva, esse horário não está disponível. Qual outro fica bom?');
    assert.equal(r.row.status, 'cancelled');
    assert.equal(r.row.metadata.cancel_reason, 'slot_rejected');
    const event = r.events.at(-1);
    assert.equal(event.handoff, false);
    assert.equal(event.sender_type, 'system');
    assert.equal(event.service, 'appointment_request_rejected');
  });

  test(label + ': modelo com variável desconhecida não é enviado', async () => { use();
    const r = await run({ config: { ...request, confirmation_template: 'Oi {apelido}' } });
    assert.equal(r.result.ok, false);
    assert.equal(r.sends, 0);
  });
}
