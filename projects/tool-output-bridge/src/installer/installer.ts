import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { setTimeout as delay } from 'node:timers/promises';
import { PLUGIN_ID, VERSION } from '../shared/config';

const MARKER = '.tool-output-bridge-install.json';
interface Receipt { id: string; version: string; role: string; config?: { path: string; previous: boolean | null } }
export interface InstallOptions { root: string; packageDir: string; packageVersion?: string; config?: string; dataRoot?: string; dryRun?: boolean }
interface Target { path: string; role: 'backend' | 'frontend'; previous: Receipt | null }

async function move(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error: any) {
      // Windows may briefly retain a file handle after a copy finishes.
      if (process.platform !== 'win32' || attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      await delay(50 * 2 ** attempt);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch (error: any) { if (error.code === 'ENOENT') return false; throw error; }
}

function inside(root: string, path: string): boolean {
  const difference = relative(root, path);
  return difference !== '' && difference !== '..' && !difference.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(difference);
}

async function safeTarget(root: string, target: string): Promise<void> {
  if (!inside(root, target)) throw new Error(`安装目标不在目录内：${target}`);
  let current = target;
  while (current !== root) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`安装路径包含符号链接：${current}`); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    current = dirname(current);
  }
}

async function receipt(target: string, role: string): Promise<Receipt | null> {
  if (!await exists(target)) return null;
  let value: Receipt;
  try { value = JSON.parse(await readFile(join(target, MARKER), 'utf8')); }
  catch { throw new Error(`目标文件夹不是由此安装器管理的：${target}`); }
  if (value.id !== PLUGIN_ID || value.role !== role) throw new Error(`安装标记不匹配：${target}`);
  return value;
}

async function atomicWrite(path: string, text: string): Promise<void> {
  const temp = `${path}.tool-output-bridge-${process.pid}.tmp`;
  await writeFile(temp, text, { flag: 'wx' });
  try { await move(temp, path); } catch (error) { await rm(temp, { force: true }); throw error; }
}

export async function operate(command: 'install' | 'uninstall' | 'status', options: InstallOptions): Promise<string[]> {
  const version = options.packageVersion ?? VERSION;
  const root = await realpath(resolve(options.root));
  const nodeHost = await exists(join(root, 'src/plugin-loader.js')) && await exists(join(root, 'package.json'));
  const dataRoot = options.dataRoot ? await realpath(resolve(root, options.dataRoot)) : join(root, 'data');
  const tauriHost = !nodeHost && (await exists(join(dataRoot, '_tauritavern')) || await exists(join(dataRoot, 'extensions')));
  if (!nodeHost && !tauriHost) throw new Error('未识别酒馆目录。请通过 --root 指定 SillyTavern、Luker 或 TauriTavern 目录。');
  const rawTargets = [
    ...(nodeHost ? [{ path: join(root, 'plugins', PLUGIN_ID), role: 'backend' as const }] : []),
    { path: nodeHost ? join(root, 'public/scripts/extensions/third-party', PLUGIN_ID) : join(dataRoot, 'extensions/third-party', PLUGIN_ID), role: 'frontend' as const },
  ];
  const targets: Target[] = [];
  for (const target of rawTargets) {
    await safeTarget(target.role === 'frontend' && tauriHost ? dataRoot : root, target.path);
    targets.push({ ...target, previous: await receipt(target.path, target.role) });
  }
  const messages = [`环境：${nodeHost ? 'Node 酒馆（前端 + 后端）' : 'TauriTavern（前端适配）'}`, `目录：${root}`];
  if (command === 'status') return [...messages, ...targets.map(target => `${target.role}: ${target.previous ? `已安装 ${target.previous.version}` : '未安装'} · ${target.path}`)];

  const configPath = nodeHost ? resolve(root, options.config || 'config.yaml') : null;
  let configRaw = '';
  let configNext = '';
  let configState: Receipt['config'];
  if (nodeHost && command === 'install') {
    if (!await exists(configPath!)) throw new Error('没有找到 config.yaml。请先启动一次酒馆，或通过 --config 指定配置文件。');
    configRaw = await readFile(configPath!, 'utf8');
    const doc = parseDocument(configRaw);
    if (doc.errors.length) throw new Error('酒馆配置不是有效的 YAML。');
    const previous = doc.get('enableServerPlugins');
    if (previous !== undefined && typeof previous !== 'boolean') throw new Error('enableServerPlugins 须为布尔值。');
    const saved = targets.find(target => target.role === 'backend')?.previous?.config;
    if (saved && resolve(saved.path) !== configPath) throw new Error('此安装记录使用另一份配置文件，请用 --config 指定原配置。');
    configState = saved ?? { path: configPath!, previous: previous ?? null };
    doc.set('enableServerPlugins', true); configNext = doc.toString();
  }
  for (const target of targets) messages.push(`${command === 'install' ? '安装' : '卸载'}：${target.path}`);
  if (options.dryRun) return [...messages, '预览完成，未改动文件。'];

  if (command === 'uninstall') {
    const backend = targets.find(target => target.role === 'backend')?.previous;
    // Restore only the flag changed by this installation, while retaining other active plugins.
    const saved = backend?.config;
    let restorePath: string | null = null;
    if (saved && saved.previous !== true && await exists(saved.path)) {
      const siblings = await readdir(join(root, 'plugins'));
      const others = siblings.filter(name => name !== PLUGIN_ID && !name.startsWith('.'));
      if (!others.length) {
        configRaw = await readFile(saved.path, 'utf8');
        const doc = parseDocument(configRaw);
        if (doc.errors.length) throw new Error('酒馆配置不是有效的 YAML。');
        if (doc.get('enableServerPlugins') === true) {
          if (saved.previous === null) doc.delete('enableServerPlugins'); else doc.set('enableServerPlugins', saved.previous);
          configNext = doc.toString(); restorePath = saved.path;
        }
      }
    }
    const moved: { target: Target; backup: string }[] = [];
    try {
      for (const target of targets) if (target.previous) {
        const backup = `${target.path}.uninstall-${process.pid}`;
        if (await exists(backup)) throw new Error(`临时目录已存在：${backup}`);
        await safeTarget(target.role === 'frontend' && tauriHost ? dataRoot : root, backup);
        await move(target.path, backup); moved.push({ target, backup });
      }
      if (restorePath) await atomicWrite(restorePath, configNext);
    } catch (error) {
      for (const item of moved.reverse()) await move(item.backup, item.target.path);
      throw error;
    }
    for (const { target, backup } of moved) { await receipt(backup, target.role); await rm(backup, { recursive: true }); }
    return [...messages, '卸载完成。请重启酒馆并刷新页面。'];
  }

  for (const target of targets) if (!await exists(join(options.packageDir, 'payload', target.role))) throw new Error(`安装包缺少 ${target.role} 文件。`);
  const staged: { target: Target; stage: string; backup: string; moved: boolean; installed: boolean }[] = [];
  try {
    for (const target of targets) {
      const stage = `${target.path}.stage-${process.pid}`;
      const backup = `${target.path}.backup-${process.pid}`;
      await safeTarget(target.role === 'frontend' && tauriHost ? dataRoot : root, stage);
      await safeTarget(target.role === 'frontend' && tauriHost ? dataRoot : root, backup);
      if (await exists(stage) || await exists(backup)) throw new Error(`临时安装目录已存在：${stage}`);
      await mkdir(dirname(target.path), { recursive: true });
      const item = { target, stage, backup, moved: false, installed: false }; staged.push(item);
      await cp(join(options.packageDir, 'payload', target.role), stage, { recursive: true, errorOnExist: true });
      await writeFile(join(stage, MARKER), JSON.stringify({ id: PLUGIN_ID, version, role: target.role, ...(target.role === 'backend' ? { config: configState } : {}) }, null, 2));
    }
    for (const item of staged) {
      if (item.target.previous) { await move(item.target.path, item.backup); item.moved = true; }
      await move(item.stage, item.target.path); item.installed = true;
    }
    if (configPath && configNext !== configRaw) await atomicWrite(configPath, configNext);
  } catch (error) {
    for (const item of staged.reverse()) {
      if (item.installed) { await receipt(item.target.path, item.target.role); await rm(item.target.path, { recursive: true }); }
      if (item.moved) await move(item.backup, item.target.path);
      if (await exists(item.stage)) await rm(item.stage, { recursive: true });
    }
    throw error;
  }
  for (const item of staged) if (item.moved) { await receipt(item.backup, item.target.role); await rm(item.backup, { recursive: true }); }
  return [...messages, `安装完成：${version}。请重启酒馆并刷新页面，在扩展设置中打开「基米工具」。`];
}
