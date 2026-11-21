/**
 * Automated Anti-Hardcode Checker for NORIA Conversational Architecture
 * Enforces AGENTS.md rules against hardcoding conversational replies in CORE and Extensions.
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const ts = require('../app/node_modules/typescript');

const SOURCES_DIR = path.join(__dirname, '..', 'n8n', 'sources');
const root = path.join(__dirname, '..');
const TARGET_FILES = [
  ...['noria_core.js', 'noria_retail.js', 'genesis_extension.js', 'nubia_extension.js',
    'joyeria_extension.js', 'noria_extension.js'].map(name => path.join(SOURCES_DIR, name)),
  path.join(root, 'clients/ic_saloon/salon_engine.js'),
  path.join(root, 'n8n/code/command_router.js'),
];

// Passivo conhecido: remover estas exceções na Fase 3. Cada hash representa
// uma linha exata e só pode ser consumido uma vez por arquivo.
// Os hashes seguem a ordem original das linhas (2026-11-21):
// CORE: 64, 82, 4121, 4172, 4256, 4622, 5098, 5617: perfil nb_bronze_v1;
// 6445: PREVIOUS_SERVICE_CUSTOMER; 7439 e 7795: comentários sobre Wesley;
// 10541 e 13802: nome Wesley em regex de pedido humano.
// Salon: 68, 83, 3751, 3802, 3886, 4252, 4728, 4802: nb_bronze_v1;
// 6012 e 6368: comentários sobre Wesley; 9114 e 12373: Wesley em regex.
// Router: 746, condição explícita tenantSlug ic_salon para agenda.
// Fase 3 deve substituir sinais específicos por contratos genéricos e retirar a baseline.
const LEGACY_BASELINE = {
  'n8n/sources/noria_retail.js': [],
  'n8n/sources/noria_core.js': ['d763b8db36af54e7', '88c4a18e176bc6d2', '8abc8fba8ad27dfc', '52c9868f8d73e1eb', '2dcfee820cd1129d', 'ff6f87b5676e4e7d', '985cc01109ab2628', '0396ea79100e0984', 'a0f49e90c121ce55', 'e6cefedadbea6ec4', 'f76f2490349f1d71', '8741d3451dcae7c1', 'aa836f6323778bbe'],
  'clients/ic_saloon/salon_engine.js': ['9807bf44acb92900', '88c4a18e176bc6d2', '8abc8fba8ad27dfc', '52c9868f8d73e1eb', '2dcfee820cd1129d', 'ff6f87b5676e4e7d', '985cc01109ab2628', '0396ea79100e0984', 'e6cefedadbea6ec4', 'f76f2490349f1d71', '8741d3451dcae7c1', 'aa836f6323778bbe'],
  'n8n/code/command_router.js': ['02ad44a8f25ea607'],
};

function auditLegacyTenantHardcodes(content, file) {
  const baseline = [...(LEGACY_BASELINE[file] || [])];
  const pattern = file === 'n8n/code/command_router.js' ? /ic_salon/i
    : /nb_bronze_v1|PREVIOUS_SERVICE_CUSTOMER|wesley/i;
  const findings = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (!pattern.test(line)) return;
    const hash = createHash('sha256').update(line.trim()).digest('hex').slice(0, 16);
    const allowed = baseline.indexOf(hash);
    if (allowed !== -1) baseline.splice(allowed, 1);
    else findings.push({ file, line: index + 1, pattern: 'Tenant-specific hardcode outside legacy baseline', match: line.trim() });
  });
  return findings;
}

// Patterns that indicate forbidden conversational hardcoding
const FORBIDDEN_PATTERNS = [
  {
    name: 'Hardcoded conversational reply interceptor for year/model/options',
    regex: /visibleReply\s*=\s*['"`](?:Anotado o ano|Além dessa, temos as seguintes opções|No momento não temos outras motos|Entendido! Como posso te ajudar com essa consulta)/i
  },
  {
    name: 'Hardcoded greeting replacing dialogue in visibleReply',
    regex: /visibleReply\s*=\s*['"`]Olá(?:, ' \+ s\.customer_name|\! Como posso ajudar você hoje na Gênesis Automóveis\?)/i
  },
  {
    name: 'Regex-based dialogue interceptor branching (reaskingYear / isAltInq / hasSellDetails)',
    regex: /const\s+(?:reaskingYear|isAltInq|hasSellDetails)\s*=/
  },
  {
    name: 'Legacy raw-text catalog selection authority',
    regex: /function\s+(?:parseCatalogOrdinal|resolveLegacySelection)\s*\(/
  },
  {
    name: 'Deterministic semantic fallback presented as Gemini evidence',
    regex: /semantic_source\s*:\s*['"]deterministic_fallback['"]/i
  }
];

const FORBIDDEN_ADDED_LINE_PATTERNS = [
  /const\s+(?:isFinancingInquiry|isMotorcycleInquiry|isCarInquiry|isAlternativeInquiry|isTradeInInquiry|isAvailabilityInquiry|isAdReferral)\s*=/,
  /explicitCurrentHumanRequest\s*=.*\/\\b/,
  /catalog\.category\s*\|\|.*\/\\b/,
];

function auditFactComparison(content, file) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Map(source.statements.filter(ts.isFunctionDeclaration).map(node => [node.name?.text, node]));
  const pending = [functions.get('salesFactValueMatches')], visited = new Set(), findings = [];
  while (pending.length) {
    const fn = pending.pop();
    if (!fn || visited.has(fn)) continue;
    visited.add(fn);
    function visit(node) {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && functions.has(node.expression.text)) pending.push(functions.get(node.expression.text));
        if (ts.isPropertyAccessExpression(node.expression)
          && ['replace', 'replaceAll', 'split'].includes(node.expression.name.text)) {
          const pattern = node.arguments[0];
          if (pattern && pattern.kind === ts.SyntaxKind.RegularExpressionLiteral) {
            // Inspect regex structure, not a vocabulary blacklist. Escapes and
            // character classes are technical syntax, not literal word branches.
            const text = pattern.getText(source);
            const body = text.slice(1, text.lastIndexOf('/'))
              .replace(/\\[\s\S]/g, '#').replace(/\[(?:\\.|[^\]\\])*\]/g, '#');
            if (body.includes('|') && /[A-Za-z]+(?=\||\))|(?:\||\()[A-Za-z]+/.test(body)) {
              findings.push({ file, pattern: 'Word-alternative rewriting in fact-value comparison',
                line: source.getLineAndCharacterOfPosition(pattern.getStart(source)).line + 1,
                match: pattern.getText(source) });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(fn);
  }
  return findings;
}

function auditFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativeFile = path.relative(root, filePath).replace(/\\/g, '/');
  const findings = auditFactComparison(content, relativeFile);
  if (Object.hasOwn(LEGACY_BASELINE, relativeFile)) findings.push(...auditLegacyTenantHardcodes(content, relativeFile));

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.regex.test(content)) {
      findings.push({
        file: relativeFile,
        pattern: pattern.name,
        match: content.match(pattern.regex)?.[0]
      });
    }
  }

  return findings;
}

function runAudit() {
  const allFindings = [];
  for (const file of TARGET_FILES) {
    if (!fs.existsSync(file)) throw new Error('Arquivo obrigatório ausente: ' + file);
    allFindings.push(...auditFile(file));
  }
  const diff = execFileSync('git', ['diff', 'HEAD', '--unified=0', '--', ...TARGET_FILES.map(file => path.relative(root, file))], {
    cwd: root,
    encoding: 'utf8',
  });
  for (const line of diff.split(/\r?\n/).filter(value => value.startsWith('+') && !value.startsWith('+++'))) {
    for (const regex of FORBIDDEN_ADDED_LINE_PATTERNS) {
      if (regex.test(line)) allFindings.push({ file: 'git-diff', pattern: 'New regex/keyword semantic authority', match: line.slice(1).trim() });
    }
  }
  return allFindings;
}

// Support both node --test and direct CLI execution
if (require.main === module) {
  const findings = runAudit();
  if (findings.length > 0) {
    console.error('❌ ANTI-HARDCODE AUDIT FAILED! Forbidden patterns found:');
    console.error(JSON.stringify(findings, null, 2));
    process.exit(1);
  } else {
    console.log('✅ ANTI-HARDCODE AUDIT PASSED: No new forbidden patterns outside the documented legacy baseline.');
    process.exit(0);
  }
} else {
  module.exports = { auditLegacyTenantHardcodes };
  test('NORIA Anti-Hardcode Architectural Audit', () => {
    const findings = runAudit();
    assert.equal(findings.length, 0, 'Found forbidden conversational hardcodes: ' + JSON.stringify(findings, null, 2));
  });
}
