import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECIPIENT_STATUS,
  CAMPAIGN_STATUS,
  computeIdempotencyKey,
  canTransitionRecipient,
  classifySendOutcome,
  calculateCampaignCounters,
} from '../../src/services/broadcasts/broadcastStateMachine.js';

import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';
import { executeBroadcastCampaign } from '../../src/services/broadcasts/broadcastWorker.js';

// In-memory mock database that faithfully reproduces Supabase queries and updates
function createMockSupabase(initialData = {}) {
  const store = {
    broadcast_campaigns: initialData.broadcast_campaigns ? JSON.parse(JSON.stringify(initialData.broadcast_campaigns)) : [],
    broadcast_campaign_recipients: initialData.broadcast_campaign_recipients ? JSON.parse(JSON.stringify(initialData.broadcast_campaign_recipients)) : [],
    broadcast_contacts: initialData.broadcast_contacts ? JSON.parse(JSON.stringify(initialData.broadcast_contacts)) : [],
    tenants: initialData.tenants || [{ id: 'tenant-1', slug: 'nubia', status: 'active' }],
  };

  const client = {
    from(table) {
      const records = store[table] || [];
      const filters = [];
      let limitCount = null;
      let orderConfig = null;
      let pendingPatch = null;
      let isInsert = false;
      let insertedRows = [];

      function getResult() {
        if (isInsert) return insertedRows;
        if (pendingPatch) {
          const matched = records.filter((r) => filters.every((fn) => fn(r)));
          for (const row of matched) {
            if (row.status === RECIPIENT_STATUS.SENT && pendingPatch.status && pendingPatch.status !== RECIPIENT_STATUS.SENT) {
              continue;
            }
            Object.assign(row, pendingPatch);
          }
          return matched;
        }
        let matching = records.filter((r) => filters.every((fn) => fn(r)));
        if (orderConfig) {
          matching.sort((a, b) => {
            if (a[orderConfig.col] < b[orderConfig.col]) return orderConfig.ascending ? -1 : 1;
            if (a[orderConfig.col] > b[orderConfig.col]) return orderConfig.ascending ? 1 : -1;
            return 0;
          });
        }
        if (typeof limitCount === 'number') {
          matching = matching.slice(0, limitCount);
        }
        return matching;
      }

      const query = {
        select() { return query; },
        eq(col, val) {
          filters.push((row) => row[col] === val);
          return query;
        },
        neq(col, val) {
          filters.push((row) => row[col] !== val);
          return query;
        },
        in(col, values) {
          filters.push((row) => values.includes(row[col]));
          return query;
        },
        lt(col, val) {
          filters.push((row) => Boolean(row[col] && row[col] < val));
          return query;
        },
        order(col, { ascending = true } = {}) {
          orderConfig = { col, ascending };
          return query;
        },
        limit(n) {
          limitCount = n;
          return query;
        },
        async single() {
          const res = getResult();
          return { data: res[0] || null, error: null };
        },
        async maybeSingle() {
          const res = getResult();
          return { data: res[0] || null, error: null };
        },
        async then(resolve) {
          const res = getResult();
          return resolve({ data: res, error: null });
        },
        insert(rows) {
          isInsert = true;
          const toInsert = Array.isArray(rows) ? rows : [rows];
          insertedRows = toInsert.map((r) => ({
            id: r.id || `id-${Math.random().toString(36).substring(2, 9)}`,
            created_at: new Date().toISOString(),
            ...r,
          }));
          records.push(...insertedRows);
          return query;
        },
        update(patch) {
          pendingPatch = patch;
          return query;
        },
      };

      return query;
    },
    store,
  };

  return client;
}

test('1. Evolution aceita mensagem, mas conexão/resposta cai -> marcado como unknown, NUNCA duplicado', async () => {
  const db = createMockSupabase({
    broadcast_campaigns: [
      { id: 'camp-1', tenant_id: 'tenant-1', name: 'Campanha 1', status: 'sending', total_recipients: 1 }
    ],
    broadcast_campaign_recipients: [
      {
        id: 'rec-1',
        campaign_id: 'camp-1',
        tenant_id: 'tenant-1',
        external_conversation_id: '5511999990001',
        status: RECIPIENT_STATUS.QUEUED,
        idempotency_key: computeIdempotencyKey('camp-1', '5511999990001'),
      }
    ]
  });

  const ops = createBroadcastOperations({
    getClient: () => db,
    loadTenant: async () => ({ id: 'tenant-1' }),
    currentUserId: async () => 'user-1',
  });

  // Simula timeout ou perda de socket APÓS envio ao provedor
  const mockSendCommand = async () => {
    throw new Error('fetch failed: Gateway Timeout (504)');
  };

  await executeBroadcastCampaign({
    campaignId: 'camp-1',
    tenantSlug: 'nubia',
    messageText: 'Olá',
    sendCommand: mockSendCommand,
    operations: ops,
    delayMs: 0,
  });

  const rec = db.store.broadcast_campaign_recipients[0];
  assert.equal(rec.status, RECIPIENT_STATUS.UNKNOWN, 'Status DEVE ser unknown quando o resultado externo é incerto');
  assert.match(rec.error, /Gateway Timeout/, 'Erro deve refletir timeout');

  // Tentativa de retomada posterior:
  let secondDispatchAttempted = false;
  await executeBroadcastCampaign({
    campaignId: 'camp-1',
    tenantSlug: 'nubia',
    messageText: 'Olá',
    sendCommand: async () => { secondDispatchAttempted = true; },
    operations: ops,
    delayMs: 0,
  });

  assert.equal(secondDispatchAttempted, false, 'Destinatário em estado unknown JAMAIS é reenviado automaticamente na retomada');
});

test('2. n8n recebe solicitação, mas resposta cai -> classificação unknown impede reenvio cego', () => {
  const networkError = new Error('ECONNRESET');
  const outcome = classifySendOutcome(networkError, null);

  assert.equal(outcome.status, RECIPIENT_STATUS.UNKNOWN);
  assert.equal(outcome.uncertain, true);
  assert.equal(canTransitionRecipient(outcome.status, RECIPIENT_STATUS.QUEUED), false, 'unknown não pode transicionar de volta para queued');
});

test('3. Rejeição definitiva pré-envio vs erro incerto pós-envio', () => {
  const definitiveError = new Error('Telefone invalido para envio');
  const definitiveOutcome = classifySendOutcome(definitiveError, null);
  assert.equal(definitiveOutcome.status, RECIPIENT_STATUS.FAILED);
  assert.equal(definitiveOutcome.uncertain, false);

  const unknownError = new Error('Request timed out after 15000ms');
  const unknownOutcome = classifySendOutcome(unknownError, null);
  assert.equal(unknownOutcome.status, RECIPIENT_STATUS.UNKNOWN);
  assert.equal(unknownOutcome.uncertain, true);
});

test('4. Duas abas/workers tentam retomar a mesma campanha -> aquisição atômica por leases impede concorrência', async () => {
  const db = createMockSupabase({
    broadcast_campaigns: [{ id: 'camp-conc', status: 'sending', total_recipients: 4 }],
    broadcast_campaign_recipients: [
      { id: 'r1', campaign_id: 'camp-conc', external_conversation_id: 'c1', status: 'queued' },
      { id: 'r2', campaign_id: 'camp-conc', external_conversation_id: 'c2', status: 'queued' },
      { id: 'r3', campaign_id: 'camp-conc', external_conversation_id: 'c3', status: 'queued' },
      { id: 'r4', campaign_id: 'camp-conc', external_conversation_id: 'c4', status: 'queued' },
    ]
  });

  const ops = createBroadcastOperations({
    getClient: () => db,
    loadTenant: async () => ({ id: 'tenant-1' }),
    currentUserId: async () => 'user-1',
  });

  // Aba 1 reserva lote de 2 itens
  const batchTab1 = await ops.claimBroadcastBatch('camp-conc', 'lease-tab-1', 2, 60);
  assert.equal(batchTab1.length, 2);
  assert.deepEqual(batchTab1.map(r => r.id), ['r1', 'r2']);

  // Aba 2 tenta reservar lote concorrente
  const batchTab2 = await ops.claimBroadcastBatch('camp-conc', 'lease-tab-2', 2, 60);
  assert.equal(batchTab2.length, 2);
  assert.deepEqual(batchTab2.map(r => r.id), ['r3', 'r4'], 'Aba 2 recebe apenas itens ainda não reservados');

  // Nenhuma sobreposição
  const overlap = batchTab1.some(r1 => batchTab2.some(r2 => r1.id === r2.id));
  assert.equal(overlap, false, 'Não pode haver destinatário reservado simultaneamente por dois workers');
});

test('5. Dois operadores disparam concorrentemente -> cada destinatário é processado exatamente uma vez', async () => {
  const db = createMockSupabase({
    broadcast_campaigns: [{ id: 'camp-duo', status: 'sending', total_recipients: 3 }],
    broadcast_campaign_recipients: [
      { id: 'd1', campaign_id: 'camp-duo', external_conversation_id: '55111', status: 'queued' },
      { id: 'd2', campaign_id: 'camp-duo', external_conversation_id: '55112', status: 'queued' },
      { id: 'd3', campaign_id: 'camp-duo', external_conversation_id: '55113', status: 'queued' },
    ]
  });

  const ops = createBroadcastOperations({
    getClient: () => db,
    loadTenant: async () => ({ id: 'tenant-1' }),
    currentUserId: async () => 'user-1',
  });

  const dispatched = [];
  const sendFn = async (cmd, payload) => {
    dispatched.push(payload.external_conversation_id);
    return { ok: true, external_message_id: `msg-${payload.external_conversation_id}` };
  };

  // Ambos os operadores executam simultaneamente
  await Promise.all([
    executeBroadcastCampaign({ campaignId: 'camp-duo', tenantSlug: 'nubia', sendCommand: sendFn, operations: ops, delayMs: 0, batchSize: 2 }),
    executeBroadcastCampaign({ campaignId: 'camp-duo', tenantSlug: 'nubia', sendCommand: sendFn, operations: ops, delayMs: 0, batchSize: 2 }),
  ]);

  // Contagem estrita de envios
  assert.equal(dispatched.length, 3, 'Total de disparos deve ser estritamente igual ao número de destinatários');
  assert.deepEqual(dispatched.sort(), ['55111', '55112', '55113'], 'Nenhum contato deve ser duplicado');
});

test('6. Worker sofre timeout durante o envio -> lease expirada na fase sending vira unknown, NUNCA queued', async () => {
  const pastTime = new Date(Date.now() - 10000).toISOString();
  const db = createMockSupabase({
    broadcast_campaigns: [{ id: 'camp-timeout', status: 'sending', total_recipients: 2 }],
    broadcast_campaign_recipients: [
      {
        id: 'rec-sending-expired',
        campaign_id: 'camp-timeout',
        status: RECIPIENT_STATUS.SENDING,
        locked_until: pastTime,
        lease_token: 'lease-crashed',
      },
      {
        id: 'rec-claimed-expired',
        campaign_id: 'camp-timeout',
        status: RECIPIENT_STATUS.CLAIMED,
        locked_until: pastTime,
        lease_token: 'lease-crashed',
      }
    ]
  });

  const ops = createBroadcastOperations({
    getClient: () => db,
    loadTenant: async () => ({ id: 'tenant-1' }),
    currentUserId: async () => 'user-1',
  });

  const recovery = await ops.recoverStaleLeases('camp-timeout');
  assert.equal(recovery.marked_unknown, 1, 'Envio que expirou enquanto estava em sending DEVE virar unknown');
  assert.equal(recovery.requeued, 1, 'Envio que expirou enquanto estava apenas em claimed volta para queued');

  const sendingItem = db.store.broadcast_campaign_recipients.find(r => r.id === 'rec-sending-expired');
  assert.equal(sendingItem.status, RECIPIENT_STATUS.UNKNOWN, 'Status deve ser unknown');

  const claimedItem = db.store.broadcast_campaign_recipients.find(r => r.id === 'rec-claimed-expired');
  assert.equal(claimedItem.status, RECIPIENT_STATUS.QUEUED, 'Status deve ser queued');
});

test('7. Worker reinicia no meio da campanha -> preserva sent e unknown, processa apenas queued', async () => {
  const db = createMockSupabase({
    broadcast_campaigns: [{ id: 'camp-restart', status: 'sending', total_recipients: 3 }],
    broadcast_campaign_recipients: [
      { id: 'r-sent', campaign_id: 'camp-restart', external_conversation_id: '111', status: RECIPIENT_STATUS.SENT, external_message_id: 'm1' },
      { id: 'r-unk', campaign_id: 'camp-restart', external_conversation_id: '222', status: RECIPIENT_STATUS.UNKNOWN, error: 'timeout' },
      { id: 'r-pending', campaign_id: 'camp-restart', external_conversation_id: '333', status: RECIPIENT_STATUS.QUEUED },
    ]
  });

  const ops = createBroadcastOperations({
    getClient: () => db,
    loadTenant: async () => ({ id: 'tenant-1' }),
    currentUserId: async () => 'user-1',
  });

  const dispatches = [];
  await executeBroadcastCampaign({
    campaignId: 'camp-restart',
    tenantSlug: 'nubia',
    sendCommand: async (cmd, p) => {
      dispatches.push(p.external_conversation_id);
      return { ok: true, external_message_id: 'new-msg' };
    },
    operations: ops,
    delayMs: 0,
  });

  assert.deepEqual(dispatches, ['333'], 'Apenas o destinatário queued deve ser disparado');
  assert.equal(db.store.broadcast_campaign_recipients.find(r => r.id === 'r-sent').status, 'sent');
  assert.equal(db.store.broadcast_campaign_recipients.find(r => r.id === 'r-unk').status, 'unknown');
  assert.equal(db.store.broadcast_campaign_recipients.find(r => r.id === 'r-pending').status, 'sent');
});

test('8. Operador cancela campanha durante envio -> apenas queued e claimed são cancelados; sent é preservado', async () => {
  const db = createMockSupabase({
    broadcast_campaigns: [{ id: 'camp-cancel', status: 'sending', total_recipients: 3 }],
    broadcast_campaign_recipients: [
      { id: 'c1', campaign_id: 'camp-cancel', status: RECIPIENT_STATUS.SENT, external_message_id: 'done-1' },
      { id: 'c2', campaign_id: 'camp-cancel', status: RECIPIENT_STATUS.CLAIMED },
      { id: 'c3', campaign_id: 'camp-cancel', status: RECIPIENT_STATUS.QUEUED },
    ]
  });

  const ops = createBroadcastOperations({
    getClient: () => db,
    loadTenant: async () => ({ id: 'tenant-1' }),
    currentUserId: async () => 'user-1',
  });

  const res = await ops.cancelBroadcastCampaign('camp-cancel');
  assert.equal(res.cancelled_recipients, 2);

  const c1 = db.store.broadcast_campaign_recipients.find(r => r.id === 'c1');
  const c2 = db.store.broadcast_campaign_recipients.find(r => r.id === 'c2');
  const c3 = db.store.broadcast_campaign_recipients.find(r => r.id === 'c3');

  assert.equal(c1.status, RECIPIENT_STATUS.SENT, 'Mensagens já enviadas nunca são adulteradas pelo cancelamento');
  assert.equal(c2.status, RECIPIENT_STATUS.CANCELLED);
  assert.equal(c3.status, RECIPIENT_STATUS.CANCELLED);
});

test('9. Resposta atrasada após outra tentativa -> status terminal sent não pode ser sobrescrito', async () => {
  const db = createMockSupabase({
    broadcast_campaigns: [{ id: 'camp-stale', status: 'sending', total_recipients: 1 }],
    broadcast_campaign_recipients: [
      { id: 'stale-1', campaign_id: 'camp-stale', external_conversation_id: '123', status: RECIPIENT_STATUS.SENT, external_message_id: 'm-confirmed' }
    ]
  });

  const ops = createBroadcastOperations({
    getClient: () => db,
    loadTenant: async () => ({ id: 'tenant-1' }),
    currentUserId: async () => 'user-1',
  });

  // Tenta gravar uma falha atrasada em cima de um registro já 'sent'
  await ops.recordRecipientResult('stale-1', 'old-lease', {
    status: RECIPIENT_STATUS.FAILED,
    error: 'delayed failure packet',
  });

  const rec = db.store.broadcast_campaign_recipients[0];
  assert.equal(rec.status, RECIPIENT_STATUS.SENT, 'Status sent deve permanecer inalterado');
  assert.equal(rec.external_message_id, 'm-confirmed');
});

test('10. Campanha com destinatários enviados, pendentes e incertos reflete contadores reais', () => {
  const recipients = [
    { status: 'sent' },
    { status: 'sent' },
    { status: 'unknown' },
    { status: 'failed' },
    { status: 'queued' },
    { status: 'queued' },
  ];

  const counters = calculateCampaignCounters(recipients);
  assert.equal(counters.total, 6);
  assert.equal(counters.sent, 2);
  assert.equal(counters.unknown, 1);
  assert.equal(counters.failed, 1);
  assert.equal(counters.queued, 2);
  assert.equal(counters.hasUnknown, true);
  assert.equal(counters.hasPending, true);
  assert.equal(counters.isComplete, false);
});
