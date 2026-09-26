import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

async function verifyMenu(packageDir, root, mock, launcher) {
  await new Promise((accept, reject) => {
    const args = [...(mock ? ['--import', pathToFileURL(mock).href] : []), resolve(packageDir, 'installer.mjs'), 'menu', '--root', root, ...(mock ? ['--online'] : [])];
    const child = spawn(launcher?.command ?? process.execPath, launcher?.args ?? args, { cwd: root, env: launcher?.env ?? process.env, windowsVerbatimArguments: launcher?.verbatim, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const choices = ['3', '1', '3', '2', '0'];
    let pending = ''; let output = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('安装菜单未能完成交互。')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => {
      output += text; pending += text;
      if (pending.includes('请选择 [0-3]：')) {
        pending = '';
        const choice = choices.shift();
        if (choice === undefined) { child.kill(); return; }
        child.stdin.write(`${choice}\n`);
      }
    });
    child.stderr.on('data', text => { stderr += text; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0, stderr || output); assert.equal(stderr, '');
        assert.equal(choices.length, 0); assert.match(output, /未安装/); assert.match(output, /安装完成/); assert.match(output, /已安装/); assert.match(output, /卸载完成/);
        accept();
      } catch (error) { reject(error); }
    });
  });
}

export async function verifyPackage(packageDir) {
  packageDir = resolve(packageDir);
  const parent = dirname(packageDir);
  const fixture = await mkdtemp(join(parent, '.package-test-'));
  if (dirname(fixture) !== parent) throw new Error('安装包测试目录无效。');
  try {
    const root = join(fixture, 'host');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/plugin-loader.js'), '');
    await writeFile(join(root, 'package.json'), '{"name":"SillyTavern","version":"1.18.0"}');
    await writeFile(join(root, 'config.yaml'), 'enableServerPlugins: false\nport: 8123\n');
    const run = (command) => {
      const result = spawnSync(process.execPath, [resolve(packageDir, 'installer.mjs'), command, '--root', root], { encoding: 'utf8' });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr || result.stdout);
    };
    run('install');
    await access(join(root, 'plugins/tool-output-bridge/index.mjs'));
    await access(join(root, 'public/scripts/extensions/third-party/tool-output-bridge/index.js'));
    assert.match(await readFile(join(root, 'config.yaml'), 'utf8'), /enableServerPlugins: true/);
    run('status'); run('install'); run('uninstall');
    await assert.rejects(access(join(root, 'plugins/tool-output-bridge')));
    assert.match(await readFile(join(root, 'config.yaml'), 'utf8'), /enableServerPlugins: false/);
    await verifyMenu(packageDir, root);
    const mock = join(fixture, 'github-fixture.mjs');
    await writeFile(mock, `import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const base = ${JSON.stringify(packageDir)};
const prefix = 'https://raw.githubusercontent.com/deepsleep-claw/SleepTavernHome/main/projects/tool-output-bridge/dist/tool-output-bridge/';
childProcess.execFile = (program, args, options, callback) => {
  const url = args.at(-1);
  if (!['curl', 'curl.exe'].includes(program) || !url.startsWith(prefix)) throw new Error('Unexpected download command');
  void readFile(base + '/' + url.slice(prefix.length)).then(data => callback(null, data, Buffer.alloc(0)), error => callback(error, Buffer.alloc(0), Buffer.alloc(0)));
};
childProcess.execFileSync = (program, args) => {
  if (program !== 'curl.exe' || args.at(-3) !== prefix + 'installer.mjs' || args.at(-2) !== '-o') throw new Error('Unexpected bootstrap command');
  writeFileSync(args.at(-1), readFileSync(base + '/installer.mjs'));
  return Buffer.alloc(0);
};
syncBuiltinESMExports();
`);
    await verifyMenu(packageDir, root, mock);
    if (process.platform === 'win32') {
      const quote = value => `'${value.replaceAll("'", "''")}'`;
      const command = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\nfunction curl.exe { Copy-Item -LiteralPath ${quote(resolve(packageDir, 'installer.mjs'))} -Destination $args[-1]; $global:LASTEXITCODE = 0 }\nGet-Content -Raw -LiteralPath ${quote(resolve(packageDir, 'install/install.ps1'))} | Out-String | Invoke-Expression`;
      await verifyMenu(packageDir, root, undefined, { command: 'powershell.exe', args: ['-NoProfile', '-Command', command], env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(mock).href}` } });
      const cmd = await readFile(resolve(packageDir, 'install/install.cmd'), 'utf8');
      assert.match(cmd, /^@node -e "[^\r\n]+" <CON\r?\n?$/);
      // The test driver supplies menu input; a piped bootstrap reads it from the console.
      const cmdFixture = join(fixture, 'menu runner.cmd');
      await writeFile(cmdFixture, cmd.trimEnd().replace(/ <CON$/, '') + '\r\n');
      await verifyMenu(packageDir, root, undefined, { command: 'cmd.exe', args: ['/d', '/s', '/c', `""${cmdFixture}""`], verbatim: true, env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(mock).href}` } });
      console.log('Windows CMD 与 PowerShell 菜单验证通过。');
    }
    await assert.rejects(access(join(root, 'plugins/tool-output-bridge')));
    console.log('安装包验证通过：独立安装器的安装、升级、状态、卸载、本地菜单与模拟 GitHub 下载菜单。');
  } finally { await rm(fixture, { recursive: true, force: true }); }
}
