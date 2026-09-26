import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { PLUGIN_ID, VERSION, isRecord } from '../shared/config';
import { operate, type InstallOptions } from './installer';

export const DEFAULT_REPOSITORY = 'deepsleep-claw/SleepTavernHome';
export const DEFAULT_REF = 'main';
const PREFIX = 'projects/tool-output-bridge/dist/tool-output-bridge/';
const PAYLOAD_FILES = [
  'payload/backend/index.mjs', 'payload/backend/package.json', 'payload/backend/LICENSE', 'payload/backend/THIRD-PARTY-LICENSES.txt',
  'payload/frontend/index.js', 'payload/frontend/manifest.json', 'payload/frontend/style.css', 'payload/frontend/LICENSE', 'payload/frontend/THIRD-PARTY-LICENSES.txt',
];
interface InstallManifest { format: 1; id: string; version: string; files: { path: string; bytes: number }[] }

export function githubBase(repository = DEFAULT_REPOSITORY, ref = DEFAULT_REF): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/').some(part => part === '.' || part === '..')) throw new Error('GitHub 仓库须为 owner/repository。');
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref) || ref.includes('..') || ref.endsWith('/')) throw new Error('GitHub 分支或标签格式无效。');
  return `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(ref)}/${PREFIX}`;
}

function validateManifest(value: unknown): InstallManifest {
  if (!isRecord(value) || value.format !== 1 || value.id !== PLUGIN_ID || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.version)) throw new Error('GitHub 安装清单格式无效。');
  if (value.version.split('.')[0] !== VERSION.split('.')[0]) throw new Error('安装包需要更新的安装器，请重新运行一键安装命令。');
  if (!Array.isArray(value.files) || value.files.length !== PAYLOAD_FILES.length) throw new Error('安装清单的文件列表不完整。');
  const remaining = new Set(PAYLOAD_FILES);
  let total = 0;
  for (const file of value.files) {
    if (!isRecord(file) || !remaining.delete(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 16 * 1024 * 1024) throw new Error('安装清单包含无效文件或大小。');
    total += file.bytes;
  }
  if (total > 64 * 1024 * 1024) throw new Error('安装包超过大小上限。');
  return value as InstallManifest;
}

async function download(url: string, limit: number, fetcher?: typeof fetch): Promise<Uint8Array> {
  if (!fetcher) {
    // Use the same network and proxy settings as the curl bootstrap.
    return new Promise((accept, reject) => {
      execFile(process.platform === 'win32' ? 'curl.exe' : 'curl', [
        '--fail', '--show-error', '--silent', '--location', '--connect-timeout', '15', '--max-time', '60',
        '--proto', '=https', '--proto-redir', '=https', '--url', url,
      ], { encoding: 'buffer', maxBuffer: limit, timeout: 65000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(new Error(`GitHub 下载失败：${stderr.toString().trim() || error.message}`));
        else accept(new Uint8Array(stdout));
      });
    });
  }
  const response = await fetcher(url, { signal: AbortSignal.timeout(60000), cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw new Error('下载文件超过安装清单声明的大小。');
      chunks.push(chunk.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function operateOnline(command: 'install' | 'uninstall' | 'status', options: InstallOptions, repository = DEFAULT_REPOSITORY, ref = DEFAULT_REF, fetcher?: typeof fetch): Promise<string[]> {
  if (command !== 'install' || options.dryRun) return operate(command, options);
  const base = githubBase(repository, ref);
  await operate('install', { ...options, dryRun: true });
  const manifest = validateManifest(JSON.parse(new TextDecoder().decode(await download(`${base}install-manifest.json`, 64 * 1024, fetcher))));
  const root = await realpath(resolve(options.root));
  const temporary = await mkdtemp(join(root, '.jimi-tools-download-'));
  if (dirname(temporary) !== root) throw new Error('下载暂存目录无效。');
  try {
    // Complete downloads before invoking the transactional host installer.
    for (const file of manifest.files) {
      const bytes = await download(`${base}${file.path}`, file.bytes, fetcher);
      if (bytes.length !== file.bytes) throw new Error(`下载文件不完整：${file.path}`);
      const target = join(temporary, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
    for (const path of ['payload/backend/package.json', 'payload/frontend/manifest.json']) {
      const payload = JSON.parse(await readFile(join(temporary, path), 'utf8'));
      if (payload.version !== manifest.version) throw new Error('GitHub 构建文件的版本不一致，请稍后重新安装。');
    }
    return [`下载版本：${manifest.version} · ${repository}@${ref}`, ...await operate('install', { ...options, packageDir: temporary, packageVersion: manifest.version })];
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
