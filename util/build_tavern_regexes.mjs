import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultSearchRoot = path.join(repoRoot, 'src');
const outputRoot = path.join(repoRoot, 'dist');

function normalize(text) {
  return text.replace(/\r\n/g, '\n').trim();
}

function wrapInHtmlBodyBlock(content) {
  return ['```html', '<body>', normalize(content), '</body>', '```'].join('\n');
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  if (!(await exists(filePath))) {
    return null;
  }
  return normalize(await fs.readFile(filePath, 'utf8'));
}

async function findRegexProjects(root) {
  const projects = [];

  async function walk(dir) {
    const sourceDir = path.join(dir, 'source');
    if (await exists(path.join(sourceDir, 'regex.json'))) {
      projects.push(dir);
      return;
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist')
        .map(entry => walk(path.join(dir, entry.name))),
    );
  }

  if (await exists(root)) {
    await walk(root);
  }

  return projects;
}

async function resolveRequestedProjects(args) {
  if (args.length === 0) {
    return findRegexProjects(defaultSearchRoot);
  }

  const projectGroups = await Promise.all(
    args.map(async arg => {
      const requested = path.resolve(repoRoot, arg);
      const stat = await fs.stat(requested);
      if (stat.isFile() && path.basename(requested) === 'regex.json') {
        return [path.dirname(path.dirname(requested))];
      }
      if (stat.isDirectory() && (await exists(path.join(requested, 'source', 'regex.json')))) {
        return [requested];
      }
      if (stat.isDirectory()) {
        return findRegexProjects(requested);
      }
      return [];
    }),
  );

  return [...new Set(projectGroups.flat())];
}

async function buildRegexProject(projectDir) {
  const sourceDir = path.join(projectDir, 'source');
  const regex = JSON.parse(await fs.readFile(path.join(sourceDir, 'regex.json'), 'utf8'));
  const { outputFile, wrapInBody, ...tavernRegex } = regex;

  const [style, template, runtime] = await Promise.all([
    readTextIfExists(path.join(sourceDir, 'style.css')),
    readTextIfExists(path.join(sourceDir, 'template.html')),
    readTextIfExists(path.join(sourceDir, 'runtime.js')),
  ]);

  const blocks = [];
  if (style) {
    blocks.push('<style>', style, '</style>');
  }
  if (template) {
    blocks.push(template);
  }
  if (runtime) {
    blocks.push('<script>', runtime, '</script>');
  }

  if (blocks.length > 0) {
    const replaceString = blocks.join('\n');
    tavernRegex.replaceString = wrapInBody ? wrapInHtmlBodyBlock(replaceString) : replaceString;
  } else if (typeof tavernRegex.replaceString !== 'string') {
    throw new Error(`${path.relative(repoRoot, projectDir)} 缺少 replaceString 或可组合的 source 文件`);
  } else if (wrapInBody) {
    tavernRegex.replaceString = wrapInHtmlBodyBlock(tavernRegex.replaceString);
  }

  const fileName = outputFile ?? `${path.basename(projectDir)}.json`;
  const relativeProjectDir = path.relative(repoRoot, projectDir).replace(/^[^\\/]+[\\/]/, '');
  const outputPath = path.join(outputRoot, relativeProjectDir, fileName);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(tavernRegex, null, 2)}\n`, 'utf8');
  return outputPath;
}

const projects = await resolveRequestedProjects(process.argv.slice(2));

if (projects.length === 0) {
  console.info('未找到可构建的正则项目');
  process.exit(0);
}

const outputs = await Promise.all(projects.map(buildRegexProject));
for (const output of outputs) {
  console.info(`已生成 ${path.relative(repoRoot, output)}`);
}
