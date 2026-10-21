import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const files = unzipSync(readFileSync(new URL(`dist/echo-deepseek-plugin-${pkg.version}.echo-workshop.zip`, root)));
const outer = JSON.parse(strFromU8(files['echo.workshop.json']));
const bundle = JSON.parse(strFromU8(files['community.echo']));
assert.equal(outer.version, pkg.version);
assert.equal(bundle.manifest.version, pkg.version);
assert.equal(outer.license.id, pkg.license);
assert.deepEqual(outer.networkHosts, ['api.deepseek.com']);
assert.deepEqual(Object.keys(files).sort(), ['echo.workshop.json', ...outer.files.map(file => file.path)].sort());
for (const file of outer.files) {
  assert.equal(files[file.path].byteLength, file.size);
  assert.equal(createHash('sha256').update(files[file.path]).digest('hex'), file.sha256);
}
for (const path of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'vendor-LICENSE.txt', 'ASSETS.md']) assert.ok(files[path]);
const inner = new Map(bundle.files.map(file => [file.path, file.content]));
assert.ok(inner.has(bundle.manifest.entry));
for (const panel of bundle.manifest.contributes.panels) assert.ok(inner.has(panel.path));
assert.ok(inner.has('research.css'));
assert.deepEqual(bundle.manifest.contributes.metadataProviders.map(provider => provider.activationStorageKey), ['api-key', 'api-key']);
console.log(`PASS: ${pkg.version} package, declared resources, licenses and SHA-256 integrity`);
