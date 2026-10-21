import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { planSync, applySync } from './scripts/sync-from-echosteam.mjs';

const scratch = resolve('misc');
function fixture(t) {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(resolve(scratch, 'sync-test-'));
  t.after(() => {
    assert.ok(root.startsWith(scratch + sep));
    rmSync(root, { recursive: true });
  });
  const source = resolve(root, 'source'); const target = resolve(root, 'target');
  mkdirSync(resolve(source, 'src'), { recursive: true }); mkdirSync(target);
  writeFileSync(resolve(source, 'src/plugin.js'), 'export const version = 1;\n');
  writeFileSync(resolve(source, 'manifest.json'), JSON.stringify({ id: 'echo.deepseek-details', version: '1.7.3' }));
  writeFileSync(resolve(source, 'key-panel.test.ts'), "resolve('workshop/deepseek-details/src/panel.html');\n");
  writeFileSync(resolve(source, 'model-panel.test.ts'), "readFileSync('workshop/deepseek-details/src/panel.html');\n");
  writeFileSync(resolve(source, 'test-support.mjs'), 'export const wire = true;\n');
  writeFileSync(resolve(source, 'THIRD_PARTY_NOTICES.txt'), 'Runtime dependency licenses\n');
  writeFileSync(resolve(source, '.env'), 'PRIVATE_LOCAL_CONFIG=fixture');
  writeFileSync(resolve(source, 'PLAN.md'), 'private working notes');
  writeFileSync(resolve(target, 'package.json'), JSON.stringify({ name: 'echo-deepseek-plugin', version: '1.7.2', scripts: { build: 'independent' } }));
  writeFileSync(resolve(target, 'package-lock.json'), JSON.stringify({ version: '1.7.2', packages: { '': { version: '1.7.2' } } }));
  writeFileSync(resolve(target, 'README.md'), 'standalone documentation');
  return { source, target };
}

test('syncs only public source, adapts test paths, updates both versions, and is idempotent', t => {
  const { source, target } = fixture(t);
  applySync(target, planSync(source, target));
  assert.equal(readFileSync(resolve(target, 'src/plugin.js'), 'utf8'), 'export const version = 1;\n');
  assert.equal(readFileSync(resolve(target, 'key-panel.test.ts'), 'utf8'), "resolve('src/panel.html');\n");
  assert.equal(readFileSync(resolve(target, 'model-panel.test.ts'), 'utf8'), "readFileSync('src/panel.html');\n");
  assert.equal(readFileSync(resolve(target, 'test-support.mjs'), 'utf8'), 'export const wire = true;\n');
  assert.equal(readFileSync(resolve(target, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), 'Runtime dependency licenses\n');
  assert.equal(JSON.parse(readFileSync(resolve(target, 'package.json'))).version, '1.7.3');
  assert.equal(JSON.parse(readFileSync(resolve(target, 'package-lock.json'))).packages[''].version, '1.7.3');
  assert.equal(readFileSync(resolve(target, 'README.md'), 'utf8'), 'standalone documentation');
  assert.equal(existsSync(resolve(target, '.env')), false); assert.equal(existsSync(resolve(target, 'PLAN.md')), false);
  assert.equal(planSync(source, target).updates.length, 0);
});

test('refuses conflicting edits before writing any target file', t => {
  const { source, target } = fixture(t);
  applySync(target, planSync(source, target));
  writeFileSync(resolve(target, 'src/plugin.js'), 'standalone edit');
  writeFileSync(resolve(source, 'src/plugin.js'), 'different source edit');
  const before = readFileSync(resolve(target, '.sync-state.json'));
  assert.throws(() => planSync(source, target), /已有改动/);
  assert.equal(readFileSync(resolve(target, 'src/plugin.js'), 'utf8'), 'standalone edit');
  assert.deepEqual(readFileSync(resolve(target, '.sync-state.json')), before);
});

test('removes only files tracked by the previous export and preserves independent tests', t => {
  const { source, target } = fixture(t);
  writeFileSync(resolve(source, 'obsolete.test.mjs'), 'test fixture');
  applySync(target, planSync(source, target));
  writeFileSync(resolve(target, 'sync-workflow.test.mjs'), 'independent sync tests');
  unlinkSync(resolve(source, 'obsolete.test.mjs'));
  applySync(target, planSync(source, target));
  assert.equal(existsSync(resolve(target, 'obsolete.test.mjs')), false);
  assert.equal(existsSync(resolve(target, 'sync-workflow.test.mjs')), true);
});

test('blocks embedded credentials and unexpected source file types without printing their content', t => {
  const { source, target } = fixture(t);
  const secret = 'sk-' + 'x'.repeat(30);
  writeFileSync(resolve(source, 'src/plugin.js'), 'const key = "' + secret + '";');
  assert.throws(() => planSync(source, target), error => error.message.includes('凭据特征') && !error.message.includes(secret));
  writeFileSync(resolve(source, 'src/plugin.js'), 'normal source');
  writeFileSync(resolve(source, 'src/.env'), 'private fixture');
  assert.throws(() => planSync(source, target), /不支持的文件类型/);
});
