import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { operate } from '../src/installer/installer';

async function fixture(kind = 'node') {
  const base = await mkdtemp(resolve('.test-build/fixture-'));
  const root = join(base, 'tavern'); const packageDir = join(base, 'package');
  for (const role of ['backend', 'frontend']) { await mkdir(join(packageDir, 'payload', role), { recursive: true }); await writeFile(join(packageDir, 'payload', role, 'index.js'), 'export const version = 1;'); }
  if (kind === 'node') {
    await mkdir(join(root, 'src'), { recursive: true }); await writeFile(join(root, 'src/plugin-loader.js'), ''); await writeFile(join(root, 'package.json'), '{"name":"SillyTavern"}');
    await writeFile(join(root, 'config.yaml'), '# Keep this comment\nport: 8000\nenableServerPlugins: false\n');
  } else await mkdir(join(root, 'data/_tauritavern'), { recursive: true });
  return { root, packageDir, base, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('installer supports install, upgrade and uninstall while preserving unrelated config', async () => {
  const env = await fixture();
  try {
    await operate('install', env);
    assert.match(await readFile(join(env.root, 'config.yaml'), 'utf8'), /enableServerPlugins: true/);
    await writeFile(join(env.packageDir, 'payload/backend/index.js'), 'export const version = 2;');
    await operate('install', env);
    assert.match(await readFile(join(env.root, 'plugins/tool-output-bridge/index.js'), 'utf8'), /version = 2/);
    assert.match((await operate('status', env)).join('\n'), /已安装 0.1.0/);
    await operate('uninstall', env);
    await assert.rejects(access(join(env.root, 'plugins/tool-output-bridge')));
    const config = await readFile(join(env.root, 'config.yaml'), 'utf8');
    assert.match(config, /enableServerPlugins: false/); assert.match(config, /Keep this comment/); assert.match(config, /port: 8000/);
  } finally { await env.cleanup(); }
});

test('uninstall retains enabled server plugins when another plugin is present', async () => {
  const env = await fixture();
  try {
    await operate('install', env); await mkdir(join(env.root, 'plugins/another'));
    await operate('uninstall', env);
    assert.match(await readFile(join(env.root, 'config.yaml'), 'utf8'), /enableServerPlugins: true/);
    await access(join(env.root, 'plugins/another'));
  } finally { await env.cleanup(); }
});

test('dry run leaves files untouched and foreign directories are never replaced', async () => {
  const env = await fixture();
  try {
    await operate('install', { ...env, dryRun: true }); await assert.rejects(access(join(env.root, 'plugins')));
    const foreign = join(env.root, 'plugins/tool-output-bridge'); await mkdir(foreign, { recursive: true }); await writeFile(join(foreign, 'user.txt'), 'keep');
    await assert.rejects(operate('install', env), /不是由此安装器/);
    await assert.rejects(operate('uninstall', env), /不是由此安装器/);
    assert.equal(await readFile(join(foreign, 'user.txt'), 'utf8'), 'keep');
  } finally { await env.cleanup(); }
});

test('Tauri installs a frontend extension into its data directory', async () => {
  const env = await fixture('tauri');
  try {
    await operate('install', env); await access(join(env.root, 'data/extensions/third-party/tool-output-bridge/index.js'));
    await assert.rejects(access(join(env.root, 'plugins')));
    await operate('uninstall', env); await assert.rejects(access(join(env.root, 'data/extensions/third-party/tool-output-bridge')));
  } finally { await env.cleanup(); }
});

test('installation rejects symlink targets before copying', async t => {
  const env = await fixture();
  try {
    const external = join(env.base, 'external'); await mkdir(external);
    try { await symlink(external, join(env.root, 'plugins'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error: any) { if (error.code === 'EPERM') { t.skip('Symlinks unavailable'); return; } throw error; }
    await assert.rejects(operate('install', env), /符号链接/);
  } finally { await env.cleanup(); }
});
