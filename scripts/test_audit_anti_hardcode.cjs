const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { auditLegacyTenantHardcodes } = require('./audit_anti_hardcode.cjs');

test('baseline aceita cada ocorrência antiga uma única vez e rejeita duplicação e alteração', () => {
  const file = 'n8n/code/command_router.js';
  const content = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const line = content.split(/\r?\n/).find(value => value.includes("tenantSlug !== 'ic_salon'"));
  assert.ok(line);
  assert.equal(auditLegacyTenantHardcodes(line, file).length, 0);
  assert.equal(auditLegacyTenantHardcodes(line + '\n' + line, file).length, 1);
  assert.equal(auditLegacyTenantHardcodes(line.replace('!==', '==='), file).length, 1);
  assert.equal(auditLegacyTenantHardcodes("if (tenant === 'wesley') {}", 'n8n/sources/noria_retail.js').length, 1);
});
