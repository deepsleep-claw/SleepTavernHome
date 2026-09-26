import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { operate, type InstallOptions } from './installer';
import { operateOnline, DEFAULT_REPOSITORY, DEFAULT_REF } from './online';

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'menu';
const options: InstallOptions = { root: process.cwd(), packageDir: dirname(fileURLToPath(import.meta.url)) };
let online = false;
let repository = DEFAULT_REPOSITORY;
let ref = DEFAULT_REF;
try {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('基米工具安装器需要 Node.js 20 或更新版本。');
  if (!['menu', 'install', 'uninstall', 'status'].includes(command ?? '')) throw new Error('用法：node installer.mjs [menu|install|uninstall|status] [--online] [--repository owner/repo] [--ref 分支或标签] [--root 酒馆目录] [--config 配置路径] [--data-root 数据目录] [--dry-run]');
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--online') { online = true; continue; }
    if (!['--root', '--config', '--data-root', '--repository', '--ref'].includes(arg) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`参数无效：${arg}`);
    const value = args[++index];
    if (arg === '--root') options.root = resolve(value);
    else if (arg === '--config') options.config = value;
    else if (arg === '--data-root') options.dataRoot = value;
    else if (arg === '--repository') repository = value;
    else ref = value;
  }
  const run = async (action: 'install' | 'uninstall' | 'status') => {
    const messages = await (online ? operateOnline(action, options, repository, ref) : operate(action, options));
    for (const message of messages) console.log(message);
  };
  if (command === 'menu') {
    // A console reopened by a piped Windows command may not permit raw input mode.
    const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    let closed = false;
    terminal.on('close', () => { closed = true; });
    try {
      while (!closed) {
        console.log(`\n基米工具 · 一键管理\n酒馆目录：${options.root}\n1. 安装 / 更新\n2. 卸载\n3. 查看状态\n0. 退出`);
        let choice: string;
        try { choice = (await terminal.question('请选择 [0-3]：')).trim(); }
        catch (error) { if (closed) break; throw error; }
        if (choice === '0' || choice === '') break;
        const action = ({ '1': 'install', '2': 'uninstall', '3': 'status' } as const)[choice as '1' | '2' | '3'];
        if (!action) { console.log('请输入 0、1、2 或 3。'); continue; }
        try { await run(action); }
        catch (error) { console.error(error instanceof Error ? error.message : String(error)); }
      }
    } finally { terminal.close(); }
  } else await run(command as 'install' | 'uninstall' | 'status');
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
