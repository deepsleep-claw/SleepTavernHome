import { zipSync } from 'fflate';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_ROOT = path.join(ROOT, 'src/酒馆助手/梦境创客/内置资源/Skills');
const TYPES_ROOT = path.join(ROOT, '@types');
const OUTPUT_ROOT = path.join(ROOT, 'dist/酒馆助手/梦境创客/resources');
const REMOTE_SKILLS = [
  'html-project',
  'plain-html-regex',
  'tavern-helper-regex',
  'mvu-zod-card',
  'mvu-frontend',
  'tavern-helper-api',
];
const ZIP_ENTRY_MTIME = new Date('1980-01-01T00:00:00.000Z');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * ZIP 默认会把构建时刻写入每个条目。固定时间戳后，同一份 Skill 源码无论
 * 被 watch 或正式构建打包多少次，内容哈希都保持稳定，客户端也不会误判为更新。
 */
function deterministicZip(files) {
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, [bytes, { mtime: ZIP_ENTRY_MTIME }]]),
  );
  return zipSync(entries, { level: 9 });
}

async function filesUnder(root, prefix = '') {
  const result = {};
  if (!existsSync(root)) return result;
  const names = await readdir(root);
  for (const name of names.sort()) {
    const absolute = path.join(root, name);
    const relative = path.posix.join(prefix, name);
    const info = await stat(absolute);
    if (info.isDirectory()) Object.assign(result, await filesUnder(absolute, relative));
    else if (info.isFile()) result[relative] = new Uint8Array(await readFile(absolute));
  }
  return result;
}

function frontmatter(source, id) {
  const text = new TextDecoder().decode(source);
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  if (!match) throw new Error(`远程Skill缺少Frontmatter：${id}`);
  const value = Object.fromEntries(match[1].split(/\r?\n/u).flatMap(line => {
    const index = line.indexOf(':');
    return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim()]] : [];
  }));
  if (value.id !== id || !value.name || !value.description || value.loading !== 'on-demand') {
    throw new Error(`远程Skill元数据无效：${id}`);
  }
  return value;
}

export async function buildDreamCardAgentResources() {
  await rm(OUTPUT_ROOT, { force: true, recursive: true });
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const skills = [];
  for (const id of REMOTE_SKILLS) {
    const files = await filesUnder(path.join(SKILLS_ROOT, id));
    if (id === 'tavern-helper-api') {
      const types = await filesUnder(TYPES_ROOT, 'references/types');
      Object.assign(files, types);
    }
    if (!files['SKILL.md']) throw new Error(`远程Skill缺少SKILL.md：${id}`);
    const metadata = frontmatter(files['SKILL.md'], id);
    const bytes = deterministicZip(files);
    const file = `${id}.zip`;
    await writeFile(path.join(OUTPUT_ROOT, file), bytes);
    skills.push({
      description: metadata.description,
      file,
      id,
      loading: 'on-demand',
      name: metadata.name,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      version: 1,
    });
  }
  const manifest = {
    protocolVersion: 1,
    runtime: [],
    skills,
  };
  const vendorRoot = path.join(OUTPUT_ROOT, 'vendor');
  await mkdir(vendorRoot, { recursive: true });
  await build({
    bundle: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    entryPoints: [path.join(ROOT, 'src/酒馆助手/梦境创客/resource-runtime/compiler-validator.ts')],
    format: 'esm',
    minify: true,
    outfile: path.join(vendorRoot, 'compiler-validator.js'),
    platform: 'browser',
    target: ['es2022'],
  });
  const rollupSource = path.join(ROOT, 'node_modules/@rollup/browser/dist/es/rollup.browser.js');
  const wasmSource = path.join(ROOT, 'node_modules/@rollup/browser/dist/es/bindings_wasm_bg.wasm');
  await writeFile(path.join(vendorRoot, 'rollup.browser.js'), await readFile(rollupSource));
  await writeFile(path.join(vendorRoot, 'bindings_wasm_bg.wasm'), await readFile(wasmSource));
  for (const file of ['compiler-validator.js', 'rollup.browser.js', 'bindings_wasm_bg.wasm']) {
    const bytes = await readFile(path.join(vendorRoot, file));
    manifest.runtime.push({ file: `vendor/${file}`, sha256: sha256(bytes), size: bytes.byteLength });
  }
  await writeFile(path.join(OUTPUT_ROOT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildDreamCardAgentResources();
  console.info(`[dream-card-agent] 已生成 ${manifest.skills.length} 个远程Skill资源。`);
}
