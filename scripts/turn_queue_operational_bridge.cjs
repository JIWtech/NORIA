// Prepared integration only. --check-config never opens a socket or sends HTTP.
const crypto = require('node:crypto');
const http = require('node:http');

function required(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error('MISSING_' + key);
  return value;
}
function positive(env, key) {
  const n = Number(required(env, key));
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('INVALID_' + key);
  return n;
}
function httpsUrl(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.search) throw new Error('HTTPS_ENDPOINT_REQUIRED');
  return u.href.replace(/\/$/, '');
}
function configFor(mode, env = process.env) {
  if (!['ingress', 'consumer'].includes(mode)) throw new Error('MODE_REQUIRED_ingress_OR_consumer');
  const cfg = {
    mode, tenantId: required(env, 'NORIA_TENANT_ID'),
    databaseUrl: httpsUrl(required(env, 'NORIA_SUPABASE_URL')),
    publishableKey: required(env, 'NORIA_SUPABASE_PUBLISHABLE_KEY'),
    timeoutMs: positive(env, 'NORIA_BRIDGE_HTTP_TIMEOUT_MS'),
    accessToken: String(env[mode === 'ingress' ? 'NORIA_INGRESS_ACCESS_TOKEN' : 'NORIA_ALERT_ACCESS_TOKEN'] || '').trim(),
  };
  if (mode === 'ingress' && env.NORIA_INGRESS_EMAIL && env.NORIA_INGRESS_PASSWORD) {
    cfg.principalEmail = required(env, 'NORIA_INGRESS_EMAIL');
    cfg.principalPassword = required(env, 'NORIA_INGRESS_PASSWORD');
  }
  if (!cfg.accessToken && !cfg.principalEmail) throw new Error('SCOPED_PRINCIPAL_CREDENTIALS_REQUIRED');
  // This is a configuration check, not JWT verification. PostgREST verifies it.
  let claims;
  try { claims = cfg.accessToken ? JSON.parse(Buffer.from(cfg.accessToken.split('.')[1], 'base64url').toString()) : null; } catch { throw new Error('INVALID_PRINCIPAL_TOKEN'); }
  if (claims && (claims.role !== 'authenticated' || !claims.sub || !Number.isFinite(claims.exp)
    || (claims.exp * 1000 <= Date.now() && !cfg.principalEmail))) {
    throw new Error('SCOPED_AUTHENTICATED_TOKEN_REQUIRED');
  }
  if (mode === 'ingress') {
    Object.assign(cfg, {
      sourceId: required(env, 'NORIA_INGRESS_SOURCE_ID'),
      instance: required(env, 'NORIA_INGRESS_INSTANCE'),
      signingSecret: required(env, 'NORIA_INGRESS_SIGNING_SECRET'),
      forwardUrl: httpsUrl(required(env, 'NORIA_INGRESS_FORWARD_URL')),
      forwardToken: required(env, 'NORIA_INGRESS_FORWARD_TOKEN'),
      port: positive(env, 'NORIA_INGRESS_PORT'), maxBytes: positive(env, 'NORIA_INGRESS_MAX_BYTES'),
      bind: String(env.NORIA_INGRESS_BIND || '127.0.0.1'),
      providerToken: String(env.NORIA_INGRESS_PROVIDER_TOKEN || ''),
    });
    if (cfg.port > 65535) throw new Error('INVALID_INGRESS_PORT');
    if (!['127.0.0.1', '0.0.0.0'].includes(cfg.bind)) throw new Error('INVALID_INGRESS_BIND');
    if (cfg.bind === '0.0.0.0' && cfg.providerToken.length < 32) throw new Error('PROVIDER_AUTH_REQUIRED');
  } else {
    Object.assign(cfg, {
      alertUrl: httpsUrl(required(env, 'NORIA_REVIEW_ALERT_URL')),
      alertToken: required(env, 'NORIA_REVIEW_ALERT_TOKEN'),
      pollMs: positive(env, 'NORIA_REVIEW_POLL_MS'),
      leaseSeconds: positive(env, 'NORIA_REVIEW_LEASE_SECONDS'),
    });
    if (cfg.leaseSeconds < 10 || cfg.leaseSeconds > 300 || cfg.timeoutMs * 3 >= cfg.leaseSeconds * 1000) {
      throw new Error('ALERT_LEASE_MUST_COVER_HTTP_BUDGET');
    }
  }
  return cfg;
}
async function principalToken(cfg, fetchFn) {
  let claims;
  try { claims = JSON.parse(Buffer.from(cfg.accessToken.split('.')[1], 'base64url').toString()); } catch {}
  if (claims?.role === 'authenticated' && claims.sub && claims.exp * 1000 > Date.now()) return cfg.accessToken;
  if (!cfg.principalEmail || !cfg.principalPassword) throw new Error('SCOPED_PRINCIPAL_TOKEN_EXPIRED');
  // Credentials live only in the separate ingress service. No service_role or
  // principal password is forwarded to the CORE. Concurrent requests share login.
  if (!cfg.loginPending) {
    cfg.loginPending = (async () => {
      const response = await fetchFn(cfg.databaseUrl + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: { apikey: cfg.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cfg.principalEmail, password: cfg.principalPassword }),
        signal: AbortSignal.timeout(cfg.timeoutMs), redirect: 'error',
      });
      if (!response.ok) throw new Error('INGRESS_PRINCIPAL_LOGIN_REJECTED');
      const session = await response.json();
      let tokenClaims;
      try { tokenClaims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString()); } catch {}
      if (tokenClaims?.role !== 'authenticated' || !tokenClaims.sub || !(tokenClaims.exp * 1000 > Date.now())) {
        throw new Error('INGRESS_PRINCIPAL_SESSION_INVALID');
      }
      cfg.accessToken = session.access_token;
      return cfg.accessToken;
    })();
  }
  try { return await cfg.loginPending; } finally { cfg.loginPending = null; }
}
async function rpc(cfg, name, body, fetchFn) {
  const accessToken = await principalToken(cfg, fetchFn);
  const res = await fetchFn(cfg.databaseUrl + '/rest/v1/rpc/magia_' + name, {
    method: 'POST', headers: { apikey: cfg.publishableKey, Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(cfg.timeoutMs), redirect: 'error',
  });
  if (!res.ok) throw new Error([401, 403].includes(res.status) ? 'DATABASE_PRINCIPAL_REJECTED' : 'DATABASE_RPC_REJECTED');
  return res.json();
}
function providerSignature(cfg, rawBody, authorization) {
  const expected = Buffer.from('Bearer ' + cfg.providerToken);
  const actual = Buffer.from(String(authorization || ''));
  if (!cfg.providerToken || actual.length !== expected.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('PROVIDER_AUTH_REJECTED');
  }
  // A private provider header authenticates origin before signing the original
  // bytes. This is an adapter, not a claim that Evolution emits native HMAC.
  return 'sha256=' + crypto.createHmac('sha256', cfg.signingSecret).update(rawBody).digest('hex');
}
function authenticateEnvelope(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !/^sha256=[a-f0-9]{64}$/.test(String(signature || ''))) throw new Error('INGRESS_SIGNATURE_REQUIRED');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const actual = Buffer.from(signature.slice(7), 'hex');
  if (!crypto.timingSafeEqual(expected, actual)) throw new Error('INGRESS_SIGNATURE_INVALID');
  const envelope = JSON.parse(rawBody.toString('utf8'));
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('INGRESS_ENVELOPE_INVALID');
  return { envelope, digest: crypto.createHash('sha256').update(rawBody).digest('hex') };
}
async function relayIngress(cfg, rawBody, signature, fetchFn = fetch) {
  const { envelope, digest } = authenticateEnvelope(rawBody, signature, cfg.signingSecret);
  if (envelope.instance !== cfg.instance) throw new Error('INGRESS_INSTANCE_MISMATCH');
  const key = envelope.data?.key || envelope.data?.message?.key;
  if (key?.id && key?.remoteJid && typeof key.fromMe === 'boolean') {
    const attestation = await rpc(cfg, 'attest_turn_ingress', { p_source: cfg.sourceId, p_envelope: envelope, p_digest: digest }, fetchFn);
    if (attestation?.attested !== true || attestation.tenant_id !== cfg.tenantId) throw new Error('INGRESS_ATTESTATION_REJECTED');
  }
  // Attest BEFORE forwarding. A lost response may replay the same signed body;
  // immutable attestation + the existing enqueue idempotency preserve the ID.
  const response = await fetchFn(cfg.forwardUrl, { method: 'POST', headers: {
    Authorization: 'Bearer ' + cfg.forwardToken, 'Content-Type': 'application/json',
  }, body: rawBody, signal: AbortSignal.timeout(cfg.timeoutMs), redirect: 'error' });
  if (!response.ok) throw new Error('INGRESS_FORWARD_FAILED');
  await response.arrayBuffer();
  return { accepted: true };
}
async function consumeOne(cfg, fetchFn = fetch) {
  const batch = await rpc(cfg, 'claim_turn_alerts', { p_tenant: cfg.tenantId, p_limit: 1, p_lease_seconds: cfg.leaseSeconds }, fetchFn);
  if (batch?.contract !== 'noria_turn_alert_v1' || !Array.isArray(batch.items) || batch.items.length > 1) throw new Error('ALERT_CLAIM_CONTRACT');
  if (!batch.items.length) return { count: 0 };
  const item = batch.items[0];
  if (item.tenant_id !== cfg.tenantId || !item.ticket_id || !item.lease_token
    || !['review', 'uncertain'].includes(item.phase) || !Number.isSafeInteger(Number(item.revision))) throw new Error('ALERT_SCOPE_MISMATCH');
  const key = cfg.tenantId + ':' + item.ticket_id + ':' + item.revision;
  const alert = { contract: 'noria_turn_alert_v1', tenant_id: cfg.tenantId, ticket_id: item.ticket_id,
    revision: item.revision, phase: item.phase, created_at: item.created_at, idempotency_key: key };
  const sent = await fetchFn(cfg.alertUrl, { method: 'POST', headers: {
    Authorization: 'Bearer ' + cfg.alertToken, 'Content-Type': 'application/json', 'Idempotency-Key': key,
  }, body: JSON.stringify(alert), signal: AbortSignal.timeout(cfg.timeoutMs), redirect: 'error' });
  if (!sent.ok) throw new Error('ALERT_RECEIVER_REJECTED');
  const receipt = await sent.json();
  if (receipt?.accepted !== true || receipt.idempotency_key !== key) throw new Error('DURABLE_ALERT_RECEIPT_REQUIRED');
  const ack = await rpc(cfg, 'ack_turn_alert', { p_tenant: cfg.tenantId, p_ticket: item.ticket_id,
    p_revision: item.revision, p_lease: item.lease_token }, fetchFn);
  if (ack?.contract !== 'noria_turn_alert_v1') throw new Error('ALERT_ACK_CONTRACT');
  // A new revision/expired lease may refuse this ack. Reclaim, never resolve a turn.
  return { count: 1, acknowledged: ack.acknowledged === true };
}
const INGRESS_REJECTION_CODES = new Set(['PROVIDER_AUTH_REJECTED', 'INGRESS_SIGNATURE_REQUIRED', 'INGRESS_SIGNATURE_INVALID',
  'INGRESS_ENVELOPE_INVALID', 'INGRESS_INSTANCE_MISMATCH', 'INGRESS_ATTESTATION_REJECTED', 'INGRESS_FORWARD_FAILED', 'INGRESS_BODY_LIMIT',
  'INGRESS_PRINCIPAL_LOGIN_REJECTED', 'INGRESS_PRINCIPAL_SESSION_INVALID', 'SCOPED_PRINCIPAL_TOKEN_EXPIRED',
  'DATABASE_PRINCIPAL_REJECTED', 'DATABASE_RPC_REJECTED']);
// Só códigos fixos vão ao log: texto livre de erro pode trazer URL com segredo ou trecho da mensagem do cliente.
function ingressRejectionCode(error) {
  return INGRESS_REJECTION_CODES.has(error?.message) ? error.message : 'INGRESS_INTERNAL_ERROR';
}
function createIngressServer(cfg, log = line => process.stderr.write(line + '\n')) {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":"listening"}'); return;
    }
    if (req.method !== 'POST' || req.url !== '/ingress') { res.writeHead(404).end(); return; }
    try {
      const chunks = []; let bytes = 0;
      for await (const part of req) {
        bytes += part.length;
        if (bytes > cfg.maxBytes) throw new Error('INGRESS_BODY_LIMIT');
        chunks.push(part);
      }
      const body = Buffer.concat(chunks);
      const signature = cfg.providerToken ? providerSignature(cfg, body, req.headers.authorization) : req.headers['x-noria-signature'];
      await relayIngress(cfg, body, signature);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"accepted":true}');
    } catch (error) {
      log('INGRESS_REJECTED code=' + ingressRejectionCode(error) + ' instance=' + cfg.instance);
      // Never acknowledge a failed attestation/forward as successful ingestion.
      res.writeHead(502, { 'Content-Type': 'application/json' }).end('{"accepted":false}');
    }
  });
}
async function main() {
  const mode = process.argv[2];
  const cfg = configFor(mode);
  if (process.argv.includes('--check-config')) { process.stdout.write('Configuration structure OK; no network calls made.\n'); return; }
  if (mode === 'consumer') {
    do {
      try { await consumeOne(cfg); } catch (error) {
        if (process.argv.includes('--once') || error.message === 'DATABASE_PRINCIPAL_REJECTED') throw error;
        process.stderr.write('TURN_ALERT_DELIVERY_PENDING\n');
      }
      if (process.argv.includes('--once')) return;
      await new Promise(resolve => setTimeout(resolve, cfg.pollMs));
    } while (true);
  }
  createIngressServer(cfg).listen(cfg.port, cfg.bind);
}
module.exports = { configFor, authenticateEnvelope, relayIngress, consumeOne, principalToken, providerSignature, createIngressServer, ingressRejectionCode };
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
