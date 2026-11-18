import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptDir = path.join(root, 'dist/酒馆助手/梦境RPG');
const frontendDir = path.join(root, 'dist/酒馆助手/梦境RPG前端');
const content = await fs.readFile(path.join(scriptDir, 'index.js'), 'utf8');
const script = {
  type: 'script',
  enabled: true,
  name: '梦境RPG',
  id: '73d06d4c-8baf-4cd5-ada3-8fae9c3dd602',
  content,
  info: '剧情行动、D100 判定与骰点缓存。在扩展设置的“梦境RPG”中管理交互与主题。',
  button: { enabled: false, buttons: [] },
  data: {},
  export_with: { data: true, button: true },
};
await fs.writeFile(path.join(scriptDir, '梦境RPG.json'), JSON.stringify(script, null, 2) + '\n');
const html = await fs.readFile(path.join(frontendDir, 'index.html'), 'utf8');
const frontend = {
  id: '58b4ce27-8dab-4d81-9031-ecf8c09080d9',
  scriptName: '[RPG前端]梦境行旅',
  findRegex: '/<dream_rpg\\b[^>]*>[\\s\\S]*?<\\/dream_rpg\\s*>/gi',
  replaceString: '```html\n' + html + '\n```',
  trimStrings: [],
  placement: [2],
  disabled: false,
  markdownOnly: true,
  promptOnly: false,
  runOnEdit: true,
  substituteRegex: 0,
  minDepth: null,
  maxDepth: null,
};
await fs.writeFile(path.join(frontendDir, '梦境RPG前端.json'), JSON.stringify(frontend, null, 2) + '\n');
console.info('已生成梦境RPG脚本与前端导入文件');
