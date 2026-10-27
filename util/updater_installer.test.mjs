/* eslint-disable import-x/no-nodejs-modules */
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createInstallerContent } from './build_tagged_script.mjs';

async function runInstaller(importer, source = 'auto') {
  const config = { pluginId: 'modern-ui', pluginName: '现代化界面', updaterApiMajor: 1 };
  const updater = { version: '1.1.0', url: 'https://cdn.jsdelivr.net/gh/example/repo@script-updater-v1.1.0/index.js' };
  const content = createInstallerContent(config, updater).replace(
    'import(/* webpackIgnore: true */ url)',
    'importer(url)',
  );
  assert(!content.includes('__vite_'));
  const request = mock.fn(
    async () => new Response('export {}', { headers: { 'content-type': 'application/javascript' } }),
  );
  const toast = { error: mock.fn() };
  await new Function(
    'getVariables',
    'getScriptId',
    'fetch',
    'importer',
    'toastr',
    'globalThis',
    `return (async () => { ${content} })();`,
  )(
    () => ({ __updater: { source } }),
    () => 'test',
    request,
    importer,
    toast,
    {},
  );
  return { config, request, toast };
}

test('导入入口在镜像失败后换源，只调用一次 bootPlugin', async () => {
  const bootPlugin = mock.fn();
  let count = 0;
  const importer = mock.fn(async () => {
    if (++count === 1) throw new Error('offline');
    return { UPDATER_API_MAJOR: 1, UPDATER_VERSION: '1.1.0', bootPlugin };
  });
  const result = await runInstaller(importer);
  assert(importer.mock.calls[0].arguments[0].includes('cdn.jsdmirror.com'));
  assert(importer.mock.calls[1].arguments[0].includes('cdn.jsdelivr.net'));
  assert.equal(bootPlugin.mock.callCount(), 1);
  assert.deepEqual(bootPlugin.mock.calls[0].arguments, [result.config]);
  assert.equal(result.toast.error.mock.callCount(), 0);
});

test('启动第一跳应用已保存的线路偏好', async () => {
  const importer = mock.fn(async () => ({ UPDATER_API_MAJOR: 1, UPDATER_VERSION: '1.1.0', bootPlugin: mock.fn() }));
  await runInstaller(importer, 'jsdelivr');
  assert(importer.mock.calls[0].arguments[0].includes('cdn.jsdelivr.net'));
});

test('锚定更新器的 API 或版本不匹配时换源验证', async () => {
  const bootPlugin = mock.fn();
  let count = 0;
  const importer = mock.fn(async () =>
    ++count === 1
      ? { UPDATER_API_MAJOR: 2, UPDATER_VERSION: '1.1.0', bootPlugin }
      : { UPDATER_API_MAJOR: 1, UPDATER_VERSION: '1.0.0', bootPlugin },
  );
  const result = await runInstaller(importer);
  assert.equal(importer.mock.callCount(), 2);
  assert.equal(bootPlugin.mock.callCount(), 0);
  assert.equal(result.toast.error.mock.callCount(), 1);
});

test('bootPlugin 失败时不重新执行另一个更新器', async () => {
  const bootPlugin = mock.fn(async () => {
    throw new Error('boot failed');
  });
  const importer = mock.fn(async () => ({ UPDATER_API_MAJOR: 1, UPDATER_VERSION: '1.1.0', bootPlugin }));
  const result = await runInstaller(importer);
  assert.equal(importer.mock.callCount(), 1);
  assert.equal(bootPlugin.mock.callCount(), 1);
  assert.equal(result.toast.error.mock.callCount(), 1);
});
