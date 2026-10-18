import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'dist/酒馆助手/基米工具');
const content = fs.readFileSync(path.join(directory, 'index.js'), 'utf8');
const script = {
  type: 'script',
  enabled: true,
  name: '基米工具',
  id: '5c271b09-44ad-4d96-90ae-811813f4de23',
  content,
  info: '将工具参数收集为聊天正文。点击“基米工具设置”配置模型匹配、正文工具和提示词，设置保存在脚本变量中。',
  button: { enabled: true, buttons: [{ name: '基米工具设置', visible: true }] },
  data: {},
  export_with: { data: true, button: true },
};
fs.writeFileSync(path.join(directory, '基米工具.json'), JSON.stringify(script, null, 2) + '\n');
console.info(`已生成 ${path.relative(root, path.join(directory, '基米工具.json'))}`);
