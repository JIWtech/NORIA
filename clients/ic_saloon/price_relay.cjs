const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { principalToken } = require('../../scripts/turn_queue_operational_bridge.cjs');

const tenantId = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const instance = 'ic_saloon';
const sendText = '/message/sendText/' + instance;
const routes = new Set([sendText, '/chat/getBase64FromMediaMessage/' + instance, '/chat/fetchProfilePictureUrl/' + instance]);
const bodyLimit = 128 * 1024;
const { createPriceGuard } = require('./price_guard.cjs');
const { officialServices, authorizeText, auditPrompt } = createPriceGuard(tenantId);

async function checkedJson(fetchFn, url, options, errorCode) {
  const response = await fetchFn(url, { ...options, redirect: 'error' });
  if (!response.ok) throw Error(errorCode);
  return response.json();
}

function createServices(config, fetchFn = fetch) {
  const signal = () => AbortSignal.timeout(config.timeoutMs);
  return {
    async catalog() {
      const token = await principalToken(config, fetchFn);
      const query = new URLSearchParams({
        select: 'tenant_id,external_id,name,price,metadata,active',
        tenant_id: 'eq.' + tenantId, active: 'eq.true', limit: '251',
      });
      return checkedJson(fetchFn, config.databaseUrl + '/rest/v1/tenant_service_catalog?' + query, {
        headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + token }, signal: signal(),
      }, 'CATALOG_UNAVAILABLE');
    },
    async audit(text, services) {
      const result = await checkedJson(fetchFn,
        'https://generativelanguage.googleapis.com/v1beta/models/' + config.model + ':generateContent', {
          method: 'POST', signal: signal(), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: auditPrompt }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify({ message: text, services: [...services.values()] }) }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: {
              type: 'OBJECT', required: ['complete', 'segments'], properties: {
                complete: { type: 'BOOLEAN' }, segments: { type: 'ARRAY', items: {
                  type: 'OBJECT', required: ['text', 'kind'], properties: {
                    text: { type: 'STRING' }, kind: { type: 'STRING', enum: ['non_price', 'catalog_price', 'reject'] },
                    service_id: { type: 'STRING' }, price_type: { type: 'STRING' }, amount_cents: { type: 'INTEGER' },
                  },
                } },
              },
            } },
          }),
        }, 'AUDIT_UNAVAILABLE');
      const candidate = result?.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw Error('AUDIT_INCOMPLETE');
      return JSON.parse(candidate.content.parts.filter(part => !part.thought).map(part => part.text).join(''));
    },
    async attestRejection(chat) {
      const token = await principalToken(config, fetchFn);
      const proof = await checkedJson(fetchFn, config.databaseUrl + '/rest/v1/rpc/ic_salon_issue_price_rejection', {
        method: 'POST', signal: signal(),
        headers: { apikey: config.publishableKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_chat: chat }),
      }, 'PRICE_REJECTION_PROOF_UNAVAILABLE');
      if (proof?.issued === false) return null;
      if (proof?.issued !== true || !/^IC_SALON_PRICE_REJECTED:[0-9A-F]{32}$/.test(proof.message || '')) {
        throw Error('PRICE_REJECTION_PROOF_INVALID');
      }
      return proof.message;
    },
    async forward(path, body) {
      return fetchFn(config.evolutionUrl + path, {
        method: 'POST', redirect: 'error', body, signal: signal(),
        headers: { apikey: config.evolutionKey, 'Content-Type': 'application/json' },
      });
    },
  };
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > bodyLimit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function createServer(config, services = createServices(config), log = code => console.error(code)) {
  const expectedKey = Buffer.from(config.relayKey);
  return http.createServer(async (request, response) => {
    const reject = (status, code, message) => {
      log(code);
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: code, message }));
    };
    if (request.method === 'GET' && request.url === '/healthz') return response.end('ok');
    if (request.method !== 'POST' || !routes.has(request.url)) return reject(404, 'IC_SALON_ROUTE_DENIED');
    const key = Buffer.from(String(request.headers.apikey || ''));
    if (key.length !== expectedKey.length || !timingSafeEqual(key, expectedKey)) return reject(401, 'IC_SALON_RELAY_AUTH');
    let body, payload;
    try {
      body = await readBody(request);
      if (!body) return reject(413, 'IC_SALON_BODY_TOO_LARGE');
      payload = JSON.parse(body.toString());
    } catch {
      return reject(400, 'IC_SALON_BODY_INVALID');
    }
    if (request.url === sendText) {
      if (typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 4096 || typeof payload.number !== 'string' || !payload.number.trim()) {
        return reject(400, 'IC_SALON_TEXT_INVALID');
      }
      try {
        const servicesById = officialServices(await services.catalog());
        const report = await services.audit(payload.text, servicesById);
        if (!authorizeText(payload.text, servicesById, report)) {
          let proof;
          try {
            proof = await services.attestRejection(payload.number);
          } catch {
            // The price stays blocked. Without a proof the queue keeps its normal delivery fence.
            log('IC_SALON_PRICE_REJECTION_PROOF_UNAVAILABLE');
          }
          return reject(422, 'IC_SALON_PRICE_UNVERIFIED', proof || undefined);
        }
      } catch {
        return reject(503, 'IC_SALON_PRICE_AUDIT_UNAVAILABLE');
      }
    }
    try {
      const upstream = await services.forward(request.url, body);
      const bytes = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' });
      response.end(bytes);
    } catch {
      return reject(502, 'IC_SALON_PROVIDER_UNAVAILABLE');
    }
  });
}

function configFrom(env) {
  const required = name => {
    const value = String(env[name] || '').trim();
    if (!value) throw Error('MISSING_' + name);
    return value;
  };
  const httpsBase = name => {
    const url = new URL(required(name));
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('INVALID_' + name);
    return url.href.replace(/\/$/, '');
  };
  const config = {
    relayKey: required('IC_SALON_RELAY_KEY'), evolutionKey: required('IC_SALON_UPSTREAM_KEY'),
    evolutionUrl: httpsBase('IC_SALON_UPSTREAM_URL'), databaseUrl: httpsBase('NORIA_SUPABASE_URL'),
    publishableKey: required('NORIA_SUPABASE_PUBLISHABLE_KEY'), principalEmail: required('IC_SALON_CATALOG_EMAIL'),
    principalPassword: required('IC_SALON_CATALOG_PASSWORD'), accessToken: '',
    geminiKey: required('GEMINI_API_KEY'), model: required('IC_SALON_PRICE_AUDIT_MODEL'), timeoutMs: 4500,
  };
  if (config.relayKey.length < 32 || config.relayKey === config.evolutionKey || !/^gemini-[a-z0-9.-]+$/.test(config.model)) {
    throw Error('IC_SALON_CONFIG_INVALID');
  }
  return config;
}

if (require.main === module) {
  createServer(configFrom(process.env)).listen(Number(process.env.PORT || 8080), '0.0.0.0');
}

module.exports = { tenantId, sendText, createServer, createServices };




