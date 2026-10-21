import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { createListingPreviewPng } from './vendor/preview-png.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (packageInfo.version !== manifest.version) throw new Error('package.json 与 manifest.json 版本不一致，请先同步');
const staticFiles = JSON.parse(await readFile(join(root, 'package-files.json'), 'utf8'));
const result = await build({ entryPoints: [join(root, 'src/plugin.js')], bundle: true, write: false,
  format: 'iife', target: 'chrome120', legalComments: 'none' });
const panel = await build({ entryPoints: [join(root, 'src/panel.js')], bundle: true, write: false,
  format: 'iife', target: 'chrome120', legalComments: 'none' });
const files = [{ path: 'plugin.js', content: result.outputFiles[0].text }, { path: 'panel.js', content: panel.outputFiles[0].text },
  ...await Promise.all(staticFiles.map(async path =>
    ({ path, content: await readFile(join(root, 'src', path), 'utf8') })))];
const bundle = JSON.stringify({ type: 'echo-plugin-package', version: 1,
  exportedAt: '2026-10-21T00:00:00.000Z', manifest, files }, null, 2) + '\n';
const artwork = await readFile(join(root, 'src/assets/whale-chan.webp'));
const resources = [
  { path: 'assets/whale-chan.webp', bytes: artwork },
  ...await Promise.all([['LICENSE.txt', 'LICENSE'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'], ['vendor-LICENSE.txt', 'vendor/LICENSE'], ['ASSETS.md', 'ASSETS.md']]
    .map(async ([path, input]) => ({ path, bytes: await readFile(join(root, input)) }))),
];
const outer = JSON.stringify({ type: 'echo-workshop-item', schemaVersion: 1, id: manifest.id,
  title: manifest.name, version: manifest.version, content: { kind: 'plugin-package', entry: 'community.echo' },
  compatibility: { minEchoVersion: manifest.minEchoVersion, pluginApiVersion: 2 }, networkHosts: ['api.deepseek.com'],
  files: [{ path: 'community.echo', size: Buffer.byteLength(bundle), sha256: createHash('sha256').update(bundle).digest('hex') },
    ...resources.map(({ path, bytes }) => ({ path, size: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }))],
  license: { id: 'AGPL-3.0-only', holder: 'Moekotori' },
}, null, 2) + '\n';
await mkdir(join(root, 'content'), { recursive: true });
await writeFile(join(root, 'content/community.echo'), bundle);
await writeFile(join(root, 'content/echo.workshop.json'), outer);
await mkdir(join(root, 'content/assets'), { recursive: true });
for (const resource of resources) await writeFile(join(root, 'content', resource.path), resource.bytes);
await writeFile(join(root, 'preview.png'), createListingPreviewPng());
const output = join(root, 'dist', `echo-deepseek-plugin-${packageInfo.version}.echo-workshop.zip`);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, zipSync({ 'community.echo': Buffer.from(bundle), 'echo.workshop.json': Buffer.from(outer), ...Object.fromEntries(resources.map(({ path, bytes }) => [path, bytes])) }));
console.log(output);
