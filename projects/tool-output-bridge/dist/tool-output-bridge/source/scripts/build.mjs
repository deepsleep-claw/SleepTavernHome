import { build } from 'esbuild';
import { readFile, writeFile, mkdir, readdir, chmod, cp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { zipSync } from 'fflate';
import { verifyPackage } from './verify-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
for (const args of [[require.resolve('typescript/bin/tsc'), '--noEmit'], [join(root, 'scripts/test.mjs')]]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, 'dist/tool-output-bridge');
if (dirname(resolve(output)) !== resolve(root, 'dist')) throw new Error('构建目录无效。');
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'payload/backend'), { recursive: true });
await mkdir(join(output, 'payload/frontend'), { recursive: true });
const common = { bundle: true, format: 'esm', legalComments: 'eof', sourcemap: false };
await build({ ...common, entryPoints: [join(root, 'src/server/index.ts')], outfile: join(output, 'payload/backend/index.mjs'), platform: 'node', target: 'node20' });
await build({ ...common, entryPoints: [join(root, 'src/frontend/index.ts')], outfile: join(output, 'payload/frontend/index.js'), platform: 'browser', target: 'es2022', minify: true, define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } });
await build({ ...common, entryPoints: [join(root, 'src/installer/cli.ts')], outfile: join(output, 'installer.mjs'), platform: 'node', target: 'node20', banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" } });
await writeFile(join(output, 'payload/frontend/style.css'), await readFile(join(root, 'src/frontend/style.css')));
await writeFile(join(output, 'payload/frontend/manifest.json'), JSON.stringify({ display_name: '基米工具', loading_order: 100, requires: [], optional: [], js: 'index.js', css: 'style.css', author: 'SleepTavernHome', version: manifest.version, auto_update: false }, null, 2));
await writeFile(join(output, 'payload/backend/package.json'), JSON.stringify({ name: 'tool-output-bridge', version: manifest.version, type: 'module', main: 'index.mjs', engines: { node: '>=20' } }, null, 2));
for (const command of ['install', 'uninstall']) {
  await writeFile(join(output, `${command}.cmd`), `@echo off\r\nnode "%~dp0installer.mjs" ${command} %*\r\nexit /b %errorlevel%\r\n`);
  await writeFile(join(output, `${command}.sh`), `#!/usr/bin/env sh\nset -eu\nSCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$SCRIPT_DIR/installer.mjs" ${command} "$@"\n`);
  await chmod(join(output, `${command}.sh`), 0o755);
}
await writeFile(join(output, 'README.md'), await readFile(join(root, 'README.md')));
await cp(join(root, 'docs'), join(output, 'docs'), { recursive: true });
await cp(join(root, 'install'), join(output, 'install'), { recursive: true });
const license = (await readFile(join(root, 'LICENSE'), 'utf8')).replaceAll('\r\n', '\n');
await writeFile(join(output, 'LICENSE'), license);
let notices = '';
for (const name of ['vue', 'yaml']) {
  const directory = dirname(require.resolve(`${name}/package.json`));
  const dependency = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  notices += `${name} ${dependency.version}\n\n${await readFile(join(directory, 'LICENSE'), 'utf8')}\n\n`;
}
notices = notices.replaceAll('\r\n', '\n').trimEnd() + '\n';
await writeFile(join(output, 'THIRD-PARTY-LICENSES.txt'), notices);
for (const role of ['frontend', 'backend']) {
  await writeFile(join(output, 'payload', role, 'LICENSE'), license);
  await writeFile(join(output, 'payload', role, 'THIRD-PARTY-LICENSES.txt'), notices);
}
const payload = [];
for (const role of ['backend', 'frontend']) {
  for (const name of await readdir(join(output, 'payload', role))) {
    const path = `payload/${role}/${name}`;
    payload.push({ path, bytes: (await readFile(join(output, path))).length });
  }
}
await writeFile(join(output, 'install-manifest.json'), JSON.stringify({ format: 1, id: 'tool-output-bridge', version: manifest.version, files: payload }, null, 2));
await mkdir(join(output, 'source'), { recursive: true });
for (const name of ['src', 'tests', 'scripts', 'install', 'docs', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'README.md', 'LICENSE']) await cp(join(root, name), join(output, 'source', name), { recursive: true });
await verifyPackage(output);
const files = {};
async function collect(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await collect(join(directory, entry.name), `${prefix}${entry.name}/`);
    else files[`${prefix}${entry.name}`] = new Uint8Array(await readFile(join(directory, entry.name)));
  }
}
await collect(output, 'tool-output-bridge/');
await writeFile(join(root, `dist/基米工具-${manifest.version}.zip`), zipSync(files, { level: 9 }));
console.log(`构建完成：${output}`);
