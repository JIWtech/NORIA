const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { auditLegacyTenantHardcodes } = require('./audit_anti_hardcode.cjs');

test('baseline vazia rejeita as ocorrências legadas e novas', () => {
  const file = 'n8n/sources/noria_core.js';
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.equal(auditLegacyTenantHardcodes(content, file).length, 0);
  for (const line of ["profile === 'nb_bronze_v1'", "reason === 'PREVIOUS_SERVICE_CUSTOMER'", '/wesley/']) {
    assert.equal(auditLegacyTenantHardcodes(line, file).length, 1);
    assert.equal(auditLegacyTenantHardcodes(line, 'clients/ic_saloon/salon_engine.js').length, 1);
  }
  assert.equal(auditLegacyTenantHardcodes("if (tenantSlug !== 'ic_salon') {}", 'n8n/code/command_router.js').length, 1);
  assert.equal(auditLegacyTenantHardcodes("if (tenant === 'wesley') {}", 'n8n/sources/noria_retail.js').length, 1);
});
