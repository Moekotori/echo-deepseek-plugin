import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = '.sync-state.json';
const binary = path => /\.(?:png|webp)$/u.test(path);
const normalize = (path, bytes) => binary(path) ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n'));
const hash = bytes => bytes === null ? null : createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const read = (root, path) => {
  const filename = resolve(root, path);
  const within = relative(root, filename);
  if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) throw new Error('同步路径超出仓库');
  if (!existsSync(filename)) return null;
  if (!lstatSync(filename).isFile()) throw new Error('同步只接受普通文件：' + path);
  return normalize(path, readFileSync(filename));
};
const managed = path => path.startsWith('src/') && !path.split('/').includes('..')
  || /^[\w-]+\.test\.mjs$/u.test(path)
  || ['key-panel.test.ts', 'ASSETS.md', 'preview.png', 'manifest.json', 'package-files.json', 'echo.workshop.project.json'].includes(path);

/** Build the entire plan before writing; hashes protect edits made in the standalone repository. */
export function planSync(source, target = repository) {
  const desired = new Map();
  const collect = folder => {
    for (const item of readdirSync(resolve(source, folder), { withFileTypes: true })) {
      const path = folder + '/' + item.name;
      if (item.isDirectory()) collect(path);
      else if (item.isFile() && ['.js', '.mjs', '.css', '.html', '.png', '.webp'].includes(extname(path))) desired.set(path, read(source, path));
      else throw new Error('源码包含不支持的文件类型：' + path);
    }
  };
  collect('src');
  for (const path of readdirSync(source)) {
    if (managed(path) && path !== 'src') desired.set(path, read(source, path));
  }
  if (!desired.has('manifest.json') || !desired.has('src/plugin.js')) throw new Error('请指定 DeepSeek 插件源码目录');
  const manifest = JSON.parse(desired.get('manifest.json'));
  if (manifest.id !== 'echo.deepseek-details') throw new Error('插件标识不匹配');
  if (desired.has('key-panel.test.ts')) {
    desired.set('key-panel.test.ts', Buffer.from(desired.get('key-panel.test.ts').toString()
      .replaceAll("resolve('workshop/deepseek-details/", "resolve('")));
  }
  for (const [path, bytes] of desired) {
    if (!binary(path) && /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(bytes.toString())) {
      throw new Error('待同步文件包含凭据特征，请先检查：' + path);
    }
  }
  const oldState = read(target, stateFile);
  const previous = oldState ? JSON.parse(oldState) : { schemaVersion: 1, files: {} };
  if (previous.schemaVersion !== 1 || Object.keys(previous.files).some(path => !managed(path))) throw new Error('同步记录格式不匹配');
  const updates = [];
  for (const path of new Set([...desired.keys(), ...Object.keys(previous.files)])) {
    const before = read(target, path);
    const after = desired.get(path) ?? null;
    if (hash(before) === hash(after)) continue;
    if (before !== null && hash(before) !== previous.files[path]
      || before === null && previous.files[path] && after !== null) throw new Error('独立仓库的同步文件已有改动，请先合并：' + path);
    updates.push({ path, bytes: after });
  }
  const pkg = JSON.parse(read(target, 'package.json'));
  if (pkg.name !== 'echo-deepseek-plugin') throw new Error('目标仓库不是 DeepSeek 插件');
  if (previous.version && pkg.version !== previous.version && pkg.version !== manifest.version) throw new Error('独立仓库版本已有改动，请先合并');
  pkg.version = manifest.version;
  const lock = JSON.parse(read(target, 'package-lock.json'));
  lock.version = manifest.version; lock.packages[''].version = manifest.version;
  const next = { schemaVersion: 1, version: manifest.version,
    files: Object.fromEntries([...desired].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, hash(bytes)])) };
  for (const [path, bytes] of [['package.json', json(pkg)], ['package-lock.json', json(lock)], [stateFile, json(next)]]) {
    if (hash(read(target, path)) !== hash(bytes)) updates.push({ path, bytes });
  }
  return { version: manifest.version, updates };
}

export function applySync(target, plan) {
  for (const { path, bytes } of plan.updates) {
    const filename = resolve(target, path);
    if (bytes === null) unlinkSync(filename);
    else { mkdirSync(dirname(filename), { recursive: true }); writeFileSync(filename, bytes); }
  }
}

const run = (program, args, options = {}) => {
  const result = spawnSync(program, args, { cwd: repository, encoding: 'utf8', timeout: 60_000, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }, ...options });
  if (result.error || result.status !== 0) throw new Error('命令失败：' + [program, ...args].join(' '));
  return result.stdout?.trim() ?? '';
};

function main() {
  const args = process.argv.slice(2);
  let source = resolve(repository, '..', 'ECHOSteam', 'workshop', 'deepseek-details');
  let check = false; let push = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') check = true;
    else if (args[index] === '--push') push = true;
    else if (args[index] === '--source' && args[index + 1]) source = resolve(args[++index]);
    else throw new Error('参数用法：--source <插件目录> [--check | --push]');
  }
  if (check && push) throw new Error('--check 与 --push 不能同时使用');
  if (push) {
    if (run('git', ['rev-parse', '--show-toplevel']).replaceAll('\\', '/') !== repository.replaceAll('\\', '/')) throw new Error('Git 仓库目录不匹配');
    if (run('git', ['branch', '--show-current']) !== 'main' || run('git', ['status', '--porcelain'])) throw new Error('推送前请先处理独立仓库的已有改动，并切到 main');
    const remote = run('git', ['remote', 'get-url', 'origin']);
    if (!/^https:\/\/github\.com\/Moekotori\/echo-deepseek-plugin(?:\.git)?$/iu.test(remote)
      && remote !== 'git@github.com:Moekotori/echo-deepseek-plugin.git') throw new Error('origin 不是预期的公开仓库');
    run('git', ['fetch', 'origin', 'main'], { stdio: 'inherit' });
    const [ahead] = run('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/main']).split(/\s+/u).map(Number);
    if (ahead) throw new Error('独立仓库有尚未推送的提交，请先处理');
    run('git', ['merge', '--ff-only', 'origin/main'], { stdio: 'inherit' });
  }
  const plan = planSync(source);
  for (const update of plan.updates) console.log((update.bytes === null ? '删除 ' : '更新 ') + update.path);
  if (!plan.updates.length) { console.log('插件已同步，无需改动'); return; }
  if (check) { process.exitCode = 1; return; }
  applySync(repository, plan);
  if (!push) { console.log('本地同步完成；尚未提交或推送'); return; }
  const deadline = Date.now() + 120_000;
  for (const command of [['test'], ['run', 'build'], ['run', 'check:package']]) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('验证预算已耗尽，保留本地改动，不提交或推送');
    const npm = process.platform === 'win32' ? [process.execPath, [resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...command]] : ['npm', command];
    run(npm[0], npm[1], { stdio: 'inherit', timeout: Math.min(60_000, remaining) });
  }
  if (planSync(source).updates.length) throw new Error('验证后源码或预览发生变化，已停止提交，请检查差异');
  run('git', ['add', '--', ...plan.updates.map(update => update.path)]);
  run('git', ['commit', '-m', 'Sync DeepSeek plugin ' + plan.version], { stdio: 'inherit' });
  run('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
  const remoteSha = run('git', ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/u)[0];
  if (remoteSha !== run('git', ['rev-parse', 'HEAD'])) throw new Error('远端提交与本地不一致，请检查远端状态');
  console.log('已验证、提交并推送到 GitHub');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error.code ? '同步失败：' + error.code : error.message); process.exitCode = 1; }
}
