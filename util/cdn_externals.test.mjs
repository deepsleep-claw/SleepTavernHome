/* eslint-disable import-x/no-nodejs-modules */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createContext, SourceTextModule } from 'node:vm';
import createCompiler from 'webpack';
import configurations from '../webpack.config.ts';

const fixtureSource = `
import { remark } from 'remark';
import gfm from 'remark-gfm';
import html from 'remark-html';
import JSON5 from 'json5';
import dedent from 'dedent';
import defaultValue, { increment, count } from 'fixture-lib';
import * as namespace from 'fixture-lib';
export const markdown = String(remark().use(gfm).use(html).processSync('~~removed~~'));
export const parsed = JSON5.parse('{answer: 42}').answer;
export const text = dedent('  ready');
export const read = () => [defaultValue(), count, namespace.count, namespace.default()];
export { increment };
`;

async function compile(directory, config, extension) {
  const entry = path.join(directory, `entry.${extension}`);
  await writeFile(entry, fixtureSource);
  const compiler = createCompiler({
    mode: 'production',
    target: ['web', 'es2022'],
    entry,
    experiments: { outputModule: true },
    output: { path: directory, filename: 'bundle.mjs', library: { type: 'module' } },
    externals: config.externals,
    externalsType: config.externalsType,
  });
  try {
    await new Promise((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error || stats.hasErrors()) reject(error ?? new Error(stats.toString({ all: false, errors: true })));
        else resolve();
      });
    });
    return await readFile(path.join(directory, 'bundle.mjs'), 'utf8');
  } finally {
    await new Promise((resolve, reject) => compiler.close(error => (error ? reject(error) : resolve())));
  }
}

test('正式 CDN externals 保留默认导出、具名导出和命名空间的实时绑定', async t => {
  const entries = configurations
    .map(configure => configure({}, { mode: 'production' }))
    .filter(config => /[\\/](?:梦境创客|现代化界面|脚本更新器|脚本更新器核心)[\\/]index.ts$/u.test(config.entry));
  assert.equal(entries.length, 4);
  for (const [index, config] of entries.entries()) {
    await t.test(path.basename(path.dirname(config.entry)), async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'tavern-cdn-externals-'));
      try {
        const source = await compile(directory, config, index % 2 ? 'js' : 'mjs');
        const requests = [];
        const context = createContext({
          URL, AbortController, setTimeout, clearTimeout,
          fetch: async url => {
            requests.push(url);
            if (new URL(url).hostname === 'cdn.jsdmirror.com') throw new Error('mirror offline');
            return new Response('export {}', { headers: { 'content-type': 'application/javascript' } });
          },
        });
        const liveModule = await import(`data:text/javascript,${encodeURIComponent(
          `export let count = 0; export function increment() { count++; } export default () => 'default'; // ${index}`,
        )}`);
        const module = new SourceTextModule(source, {
          context,
          importModuleDynamically: async url => {
            const name = new URL(url).pathname.slice('/npm/'.length, -'/+esm'.length);
            return name === 'fixture-lib' ? liveModule : await import(name);
          },
        });
        await module.link(() => { throw new Error('Unexpected static import'); });
        await module.evaluate();
        assert.equal(module.namespace.markdown, '<p><del>removed</del></p>\n');
        assert.equal(module.namespace.parsed, 42);
        assert.equal(module.namespace.text, 'ready');
        assert.deepEqual(Array.from(module.namespace.read()), ['default', 0, 0, 'default']);
        module.namespace.increment();
        assert.deepEqual(Array.from(module.namespace.read()), ['default', 1, 1, 'default']);
        assert(requests.some(url => url.includes('cdn.jsdmirror.com')));
        assert(requests.some(url => url.includes('cdn.jsdelivr.net')));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
