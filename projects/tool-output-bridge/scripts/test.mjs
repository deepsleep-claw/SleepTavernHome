import { build } from 'esbuild';
import { readdir, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.test-build');
if (dirname(output) !== root) throw new Error('测试目录无效。');
await mkdir(output, { recursive: true });
try {
  const tests = (await readdir(resolve(root, 'tests'))).filter(name => name.endsWith('.test.ts'));
  for (const test of tests) await build({ entryPoints: [resolve(root, 'tests', test)], outfile: resolve(output, test.replace('.ts', '.mjs')), bundle: true, platform: 'node', target: 'node20', format: 'esm', packages: 'external' });
  const result = spawnSync(process.execPath, ['--test', ...tests.map(test => resolve(output, test.replace('.ts', '.mjs')))], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(output, { recursive: true, force: true }); }
