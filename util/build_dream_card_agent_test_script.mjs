/* eslint-disable import-x/no-nodejs-modules */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'dist', '酒馆助手', '梦境创客', 'index.js');
const output = path.join(root, 'release', '梦境创客', '酒馆助手脚本-梦境创客-内部测试.json');

if (!fs.existsSync(source)) {
  throw new Error('梦境创客正式构建产物不存在，请先运行 pnpm run build。');
}

const script = {
  type: 'script',
  enabled: false,
  name: '梦境创客（内部测试）',
  id: 'dream-card-agent',
  content: fs.readFileSync(source, 'utf8'),
  info: '阶段A自动测试版本。真实酒馆阶段B测试尚未执行，请勿正式发布。',
  button: { enabled: true, buttons: [] },
  data: {},
  export_with: { data: true, button: true },
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(script, null, 2)}\n`, 'utf8');
console.info(`[dream-card-agent] 已生成内部测试导入文件：${path.relative(root, output)}`);
