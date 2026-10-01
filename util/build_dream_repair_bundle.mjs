import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'dist/酒馆助手/梦境自修复V2');
const content = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
const script = {
  type: 'script',
  enabled: true,
  name: '梦境自修复V2',
  id: '6251687e-79d5-4a65-a8f9-c053b736c72d',
  content,
  info: '格式补全、整段与跨行内容修复。点击“正文修复”配置模块提示词、模型和 MVU 联动。',
  button: { enabled: true, buttons: [{ name: '正文修复', visible: true }] },
  data: {},
  export_with: { data: true, button: true },
};
const output = path.join(directory, '梦境自修复V2.json');
fs.writeFileSync(output, JSON.stringify(script, null, 2) + '\n');
console.info(`已生成 ${path.relative(root, output)}`);
