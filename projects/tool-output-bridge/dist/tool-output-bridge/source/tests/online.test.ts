import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { githubBase, operateOnline } from '../src/installer/online';

async function fixture() {
  const base = await mkdtemp(resolve('.test-build/online-'));
  const root = join(base, 'Tavern with spaces');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/plugin-loader.js'), '');
  await writeFile(join(root, 'package.json'), '{"name":"SillyTavern"}');
  await writeFile(join(root, 'config.yaml'), 'enableServerPlugins: false\n');
  const files: Record<string, string> = {
    'payload/backend/index.mjs': 'export const info = {};',
    'payload/backend/package.json': '{"version":"0.1.2"}',
    'payload/frontend/index.js': 'globalThis.test = true;',
    'payload/frontend/style.css': '.test {}',
    'payload/frontend/manifest.json': '{"version":"0.1.2"}',
  };
  for (const role of ['backend', 'frontend']) for (const file of ['LICENSE', 'THIRD-PARTY-LICENSES.txt']) files[`payload/${role}/${file}`] = 'License text';
  const manifest = { format: 1, id: 'tool-output-bridge', version: '0.1.2', files: Object.entries(files).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text) })) };
  let requests = 0;
  const fetcher: typeof fetch = async url => {
    requests++;
    const path = String(url).slice(githubBase().length);
    return path === 'install-manifest.json' ? Response.json(manifest) : files[path] !== undefined ? new Response(files[path]) : new Response('missing', { status: 404 });
  };
  return { base, root, packageDir: base, files, manifest, fetcher, requests: () => requests, cleanup: () => rm(base, { recursive: true, force: true }) };
}

test('online installer downloads complete payload then installs, updates, reports and uninstalls', async () => {
  const env = await fixture();
  try {
    const run = (command: 'install' | 'uninstall' | 'status') => operateOnline(command, env, undefined, undefined, env.fetcher);
    await run('install');
    assert.match(await readFile(join(env.root, 'config.yaml'), 'utf8'), /enableServerPlugins: true/);
    assert.equal(await readFile(join(env.root, 'plugins/tool-output-bridge/index.mjs'), 'utf8'), env.files['payload/backend/index.mjs']);
    assert.match((await run('status')).join('\n'), /已安装 0.1.2/);
    await run('install'); const count = env.requests();
    await run('uninstall'); assert.equal(env.requests(), count);
    assert.match(await readFile(join(env.root, 'config.yaml'), 'utf8'), /enableServerPlugins: false/);
    assert.equal((await readdir(env.root)).some(name => name.startsWith('.jimi-tools-download-')), false);
  } finally { await env.cleanup(); }
});

test('download failures preserve the installed files and clean staging', async () => {
  const env = await fixture();
  try {
    await operateOnline('install', env, undefined, undefined, env.fetcher);
    const index = join(env.root, 'plugins/tool-output-bridge/index.mjs');
    await writeFile(index, 'working installation');
    delete env.files['payload/frontend/index.js'];
    await assert.rejects(operateOnline('install', env, undefined, undefined, env.fetcher), /HTTP 404/);
    assert.equal(await readFile(index, 'utf8'), 'working installation');
    assert.equal((await readdir(env.root)).some(name => name.startsWith('.jimi-tools-download-')), false);
  } finally { await env.cleanup(); }
});

test('manifest path traversal, version skew and truncated downloads fail before host changes', async () => {
  for (const scenario of ['path', 'version', 'truncated']) {
    const env = await fixture();
    try {
      if (scenario === 'path') env.manifest.files[0].path = '../outside.mjs';
      if (scenario === 'version') env.files['payload/backend/package.json'] = '{"version":"0.1.3"}';
      if (scenario === 'truncated') env.files['payload/backend/index.mjs'] = 'partial';
      await assert.rejects(operateOnline('install', env, undefined, undefined, env.fetcher), /无效文件|版本不一致|不完整/);
      await assert.rejects(access(join(env.root, 'plugins/tool-output-bridge')));
      assert.match(await readFile(join(env.root, 'config.yaml'), 'utf8'), /enableServerPlugins: false/);
    } finally { await env.cleanup(); }
  }
});

test('online dry run is local and repository paths are validated', async () => {
  const env = await fixture();
  try {
    await operateOnline('install', { ...env, dryRun: true }, undefined, undefined, env.fetcher);
    assert.equal(env.requests(), 0);
    assert.match(githubBase('owner/repo', 'release/v0.1.2'), /release%2Fv0\.1\.2/);
    assert.throws(() => githubBase('../repo'), /仓库/);
    assert.throws(() => githubBase('owner/repo', '../main'), /标签/);
  } finally { await env.cleanup(); }
});
