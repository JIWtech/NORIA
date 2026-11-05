// Executa o builder real com arquivos em memória: nenhum artefato do checkout é alterado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const builderPath = path.join(__dirname, 'build_noria_workflows.cjs');
const builder = fs.readFileSync(builderPath, 'utf8');
const builderRequire = createRequire(builderPath);

function virtualBuild() {
  const writes = new Map();
  const fileKey = file => path.resolve(String(file));
  const virtualFs = {
    existsSync: file => writes.has(fileKey(file)) || fs.existsSync(file),
    readFileSync(file, options) {
      if (!writes.has(fileKey(file))) return fs.readFileSync(file, options);
      const bytes = writes.get(fileKey(file));
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? bytes.toString(encoding) : Buffer.from(bytes);
    },
    writeFileSync(file, value) { writes.set(fileKey(file), Buffer.from(value)); },
  };
  const update = (file, suffix) => virtualFs.writeFileSync(path.join(root, file), virtualFs.readFileSync(path.join(root, file), 'utf8') + suffix);
  const run = date => {
    class BuildDate extends Date {
      constructor(...args) { super(...(args.length ? args : [date])); }
      static now() { return Date.parse(date); }
    }
    vm.runInNewContext(builder, {
      __dirname, __filename: builderPath, Date: BuildDate, process: { env: {} },
      console: { log() {}, warn() {} },
      require: name => name === 'node:fs' ? virtualFs : builderRequire(name),
    }, { filename: builderPath, timeout: 15000 });
    return JSON.parse(virtualFs.readFileSync(path.join(root, 'n8n/build_manifest.json'), 'utf8'));
  };
  return { writes, update, run };
}

test('build repetido mantém todos os bytes, inclusive quando o relógio cruza a meia-noite', () => {
  const build = virtualBuild();
  build.update('n8n/sources/noria_core.js', '\n// fixture: alteração real do CORE\n');
  build.run('2030-12-31T23:59:59.000Z');
  const first = new Map([...build.writes].map(([file, bytes]) => [file, bytes.toString('base64')]));
  build.run('2031-01-01T00:00:01.000Z');
  assert.equal(build.writes.size, first.size);
  const changed = [...build.writes].filter(([file, bytes]) => first.get(file) !== bytes.toString('base64')).map(([file]) => path.relative(root, file));
  assert.deepEqual(changed, []);
});

test('mudanças reais de CORE ou EXT renovam os metadados e preservam os hashes corretos', () => {
  const build = virtualBuild();
  build.update('n8n/sources/noria_core.js', '\n// fixture: versão inicial\n');
  const first = build.run('2030-12-31T23:59:59.000Z');
  build.update('n8n/sources/noria_core.js', '\n// fixture: nova versão do CORE\n');
  const core = build.run('2031-01-01T00:00:01.000Z');
  assert.notEqual(core.core_sha256, first.core_sha256);
  assert.equal(core.ext_sha256, first.ext_sha256);
  assert.equal(core.built_at, '2031-01-01T00:00:01.000Z');
  build.update('n8n/sources/genesis_extension.js', '\n// fixture: nova versão da EXT\n');
  const ext = build.run('2031-01-02T12:00:00.000Z');
  assert.equal(ext.core_sha256, core.core_sha256);
  assert.notEqual(ext.ext_sha256, core.ext_sha256);
  assert.equal(ext.built_at, '2031-01-02T12:00:00.000Z');
});
