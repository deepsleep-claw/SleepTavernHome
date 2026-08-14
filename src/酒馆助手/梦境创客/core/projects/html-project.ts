import { parse, stringify } from 'yaml';
import { normalizeWorkspacePath, parentWorkspacePath } from '../workspace/path';
import type { WorkspaceFile } from '../workspace/types';

export type ProjectDiagnostic = {
  column?: number;
  file: string;
  line?: number;
  message: string;
  severity: 'error' | 'info' | 'warning';
};

export type HtmlProjectCheck = {
  diagnostics: ProjectDiagnostic[];
  outputBytes: number;
  projectName: string;
  renderer: 'plain-html' | 'tavern-helper';
};

type RuntimeValidator = {
  validateCss(source: string): Array<Omit<ProjectDiagnostic, 'file'>>;
  validateHtml(source: string): Array<Omit<ProjectDiagnostic, 'file'>>;
  validateRegex(source: string): Array<Omit<ProjectDiagnostic, 'file'>>;
};

type RollupRuntime = {
  rollup(options: Record<string, unknown>): Promise<{
    close(): Promise<void>;
    generate(options: Record<string, unknown>): Promise<{ output: Array<{ code?: string; type: string }> }>;
  }>;
};

type ProjectConfig = {
  build: { entry: string; scripts: string[]; styles: string[] };
  name: string;
  regex: {
    disabled: boolean;
    find: string;
    placement: number[];
  };
  renderer: 'plain-html' | 'tavern-helper';
};

const MAX_DIAGNOSTICS = 100;
const WARN_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function relativePath(root: string, value: string): string {
  if (!value || value.startsWith('/') || value.includes('\\') || /(^|\/)\.\.(?:\/|$)/u.test(value)) {
    throw new Error(`工程路径必须是同一工程内的相对路径：${value}`);
  }
  const path = normalizeWorkspacePath(`${root}/${value}`);
  if (!path.startsWith(`${root}/`)) throw new Error(`工程路径越界：${value}`);
  return path;
}

function modulePath(root: string, importer: string | undefined, value: string): string {
  if (!value.startsWith('.') || value.includes('\\') || value.startsWith('/')) {
    throw new Error(`脚本导入必须是工程内相对路径或HTTP(S)地址：${value}`);
  }
  const base = importer ? parentWorkspacePath(importer) : root;
  const rootSegments = root.split('/').filter(Boolean);
  const segments = base.split('/').filter(Boolean);
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length <= rootSegments.length) throw new Error(`脚本导入越过工程根目录：${value}`);
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const resolved = normalizeWorkspacePath(`/${segments.join('/')}`);
  if (!resolved.startsWith(`${root}/`) || !/\.m?js$/iu.test(resolved)) {
    throw new Error(`脚本导入越界或格式不支持：${value}`);
  }
  return resolved;
}

function parseConfig(file: WorkspaceFile): ProjectConfig {
  let raw: unknown;
  try { raw = parse(file.content); } catch (error) { throw new Error(`project.yaml不是有效YAML：${error instanceof Error ? error.message : String(error)}`); }
  const value = object(raw);
  const build = object(value.build);
  const regex = object(value.regex);
  const renderer = value.renderer === 'tavern-helper' ? 'tavern-helper' : value.renderer === 'plain-html' ? 'plain-html' : undefined;
  if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('project.yaml缺少非空name。');
  if (!renderer) throw new Error('project.yaml的renderer必须是plain-html或tavern-helper。');
  if (typeof build.entry !== 'string' || !build.entry.trim()) throw new Error('project.yaml缺少build.entry。');
  if (typeof regex.find !== 'string' || !regex.find.trim()) throw new Error('project.yaml缺少regex.find。');
  const placement = Array.isArray(regex.placement)
    ? regex.placement.filter((item): item is number => Number.isInteger(item))
    : Number.isInteger(regex.placement) ? [Number(regex.placement)] : [2];
  return {
    build: { entry: build.entry, scripts: stringList(build.scripts), styles: stringList(build.styles) },
    name: value.name.trim(),
    regex: { disabled: regex.disabled === true, find: regex.find, placement },
    renderer,
  };
}

export class HtmlProjectCompiler {
  private validator?: RuntimeValidator;
  private rollup?: RollupRuntime;

  constructor(private readonly resourceBaseUrl: string) {}

  async check(projectYamlPath: string, files: WorkspaceFile[]): Promise<HtmlProjectCheck & { output?: string }> {
    const projectPath = normalizeWorkspacePath(projectYamlPath);
    if (!/^\/(?:files|character\/files)\/.+\/project\.yaml$/u.test(projectPath)) {
      throw new Error('HTML工程必须位于/files或/character/files，并以project.yaml作为工程入口。');
    }
    const fileMap = new Map(files.map(file => [file.path, file]));
    const configFile = fileMap.get(projectPath);
    if (!configFile) throw new Error(`工程文件不存在：${projectPath}`);
    const root = parentWorkspacePath(projectPath);
    const config = parseConfig(configFile);
    const diagnostics: ProjectDiagnostic[] = [];
    const entryPath = relativePath(root, config.build.entry);
    const entry = fileMap.get(entryPath);
    if (!entry) throw new Error(`工程入口不存在：${entryPath}`);
    const html = this.expandIncludes(entry.content, entryPath, root, fileMap, [], diagnostics);
    const validator = await this.loadValidator();
    diagnostics.push(...validator.validateHtml(html).map(item => ({ ...item, file: entryPath })));
    if (config.renderer === 'plain-html') {
      const forbidden = [
        { pattern: /<script\b/iu, message: 'plain-html不允许<script>。' },
        { pattern: /\son[a-z]+\s*=/iu, message: 'plain-html不允许内联事件属性。' },
        { pattern: /javascript\s*:/iu, message: 'plain-html不允许javascript: URL。' },
      ];
      diagnostics.push(...forbidden.filter(item => item.pattern.test(html)).map(item => ({ file: entryPath, message: item.message, severity: 'error' as const })));
    }
    const styles: string[] = [];
    for (const name of config.build.styles) {
      const path = relativePath(root, name);
      const file = fileMap.get(path);
      if (!file) { diagnostics.push({ file: path, message: '样式文件不存在。', severity: 'error' }); continue; }
      diagnostics.push(...validator.validateCss(file.content).map(item => ({ ...item, file: path })));
      styles.push(`/* ${name} */\n${file.content}`);
    }
    diagnostics.push(...validator.validateRegex(config.regex.find).map(item => ({ ...item, file: projectPath })));
    let script = '';
    if (config.build.scripts.length) {
      if (config.renderer === 'plain-html') diagnostics.push({ file: projectPath, message: 'plain-html工程不能配置build.scripts。', severity: 'error' });
      else script = await this.bundleScripts(root, config.build.scripts, fileMap, diagnostics);
    }
    const output = `${styles.length ? `<style>\n${styles.join('\n')}\n</style>\n` : ''}${html}${script ? `\n<script type="module">\n${script}\n</script>` : ''}`;
    const outputBytes = new TextEncoder().encode(output).byteLength;
    if (outputBytes > MAX_OUTPUT_BYTES) diagnostics.push({ file: projectPath, message: '编译产物超过5MB，已阻止编译。', severity: 'error' });
    else if (outputBytes > WARN_OUTPUT_BYTES) diagnostics.push({ file: projectPath, message: '编译产物超过1MB，可能影响酒馆性能。', severity: 'warning' });
    if (!output.trim()) diagnostics.push({ file: entryPath, message: '编译产物为空。', severity: 'error' });
    const sorted = diagnostics
      .sort((left, right) => left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0))
      .slice(0, MAX_DIAGNOSTICS);
    if (diagnostics.length > MAX_DIAGNOSTICS) sorted.push({ file: projectPath, message: `诊断超过${MAX_DIAGNOSTICS}条，其余已省略。`, severity: 'warning' });
    return { diagnostics: sorted, output, outputBytes, projectName: config.name, renderer: config.renderer };
  }

  regexYaml(
    check: HtmlProjectCheck & { output?: string },
    projectYamlPath: string,
    existing: WorkspaceFile[],
    scope: 'character' | 'global' | 'preset-current',
    overwrite: boolean,
  ): { content: string; path: string; replace: boolean } {
    if (check.diagnostics.some(item => item.severity === 'error') || check.output === undefined) throw new Error('工程仍有错误，不能编译。');
    const root = `/regexes/${scope}`;
    const parsed = existing
      .filter(file => file.path.startsWith(`${root}/`) && file.path.endsWith('.yaml') && !file.path.endsWith('/_scope.yaml'))
      .flatMap(file => {
        try { return [{ file, value: object(parse(file.content)) }]; } catch { return []; }
      });
    const same = parsed.filter(item => item.value.name === check.projectName).sort((left, right) => Number(left.value.order ?? 0) - Number(right.value.order ?? 0));
    const target = same.at(-1);
    if (overwrite && !target) throw new Error(`所选作用域没有名为“${check.projectName}”的正则，无法覆盖。`);
    const id = overwrite ? String(target!.value.id) : crypto.randomUUID();
    const maxOrder = parsed.reduce((max, item) => Math.max(max, Number(item.value.order ?? 0)), 0);
    const source = object(object(parse(existing.find(file => file.path === projectYamlPath)?.content ?? '')).regex);
    const placements = Array.isArray(source.placement) ? source.placement : [source.placement ?? 2];
    const content = stringify({
      destination: { display: true, prompt: true },
      enabled: source.disabled !== true,
      find_regex: source.find,
      id,
      macro_substitution: 'none',
      max_depth: null,
      min_depth: null,
      name: check.projectName,
      order: overwrite ? Number(target!.value.order ?? maxOrder + 100) : maxOrder + 100,
      replace_string: check.output,
      run_on_edit: false,
      source: {
        ai_output: placements.includes(2),
        reasoning: placements.includes(6),
        slash_command: placements.includes(3),
        user_input: placements.includes(1),
        world_info: placements.includes(5),
      },
      trim_strings: [],
    }).trimEnd();
    const path = overwrite ? target!.file.path : `${root}/${encodeURIComponent(id)}-${check.projectName.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40) || 'regex'}.yaml`;
    return { content, path, replace: overwrite };
  }

  private expandIncludes(
    source: string,
    path: string,
    root: string,
    files: Map<string, WorkspaceFile>,
    stack: string[],
    diagnostics: ProjectDiagnostic[],
  ): string {
    if (stack.includes(path)) {
      diagnostics.push({ file: path, message: `HTML include循环：${[...stack, path].join(' → ')}`, severity: 'error' });
      return '';
    }
    return source.replace(/<!--#include\s+file=["']([^"']+)["']\s*-->/gu, (_full, name: string) => {
      let target: string;
      try { target = relativePath(root, name); } catch (error) {
        diagnostics.push({ file: path, message: error instanceof Error ? error.message : String(error), severity: 'error' });
        return '';
      }
      const file = files.get(target);
      if (!file) { diagnostics.push({ file: target, message: 'include文件不存在。', severity: 'error' }); return ''; }
      return this.expandIncludes(file.content, target, root, files, [...stack, path], diagnostics);
    });
  }

  private async bundleScripts(root: string, names: string[], files: Map<string, WorkspaceFile>, diagnostics: ProjectDiagnostic[]): Promise<string> {
    const rollup = await this.loadRollup();
    const entryId = '\0dream-project-entry';
    const entry = names.map(name => `import ${JSON.stringify(`./${name}`)};`).join('\n');
    let bundle: Awaited<ReturnType<RollupRuntime['rollup']>> | undefined;
    try {
      bundle = await rollup.rollup({
        input: entryId,
        onwarn: (warning: { message?: string }) => diagnostics.push({ file: root, message: warning.message ?? String(warning), severity: 'warning' }),
        plugins: [{
          name: 'dream-card-agent-vfs',
          resolveId(source: string, importer?: string) {
            if (source === entryId) return entryId;
            if (/^https?:\/\//iu.test(source)) return { external: true, id: source };
            if (!source.startsWith('.')) throw new Error(`不支持裸模块导入：${source}`);
            const resolved = modulePath(root, importer === entryId ? undefined : importer, source);
            if (!files.has(resolved)) throw new Error(`脚本模块不存在：${resolved}`);
            return resolved;
          },
          load(id: string) { return id === entryId ? entry : files.get(id)?.content ?? null; },
        }],
      });
      const generated = await bundle.generate({ format: 'es', inlineDynamicImports: true });
      return generated.output.filter(item => item.type === 'chunk').map(item => item.code ?? '').join('\n');
    } catch (error) {
      diagnostics.push({ file: root, message: `脚本打包失败：${error instanceof Error ? error.message : String(error)}`, severity: 'error' });
      return '';
    } finally {
      await bundle?.close();
    }
  }

  private async loadValidator(): Promise<RuntimeValidator> {
    this.validator ??= await import(/* webpackIgnore: true */ new URL('vendor/compiler-validator.js', this.resourceBaseUrl).href) as RuntimeValidator;
    return this.validator;
  }

  private async loadRollup(): Promise<RollupRuntime> {
    this.rollup ??= await import(/* webpackIgnore: true */ new URL('vendor/rollup.browser.js', this.resourceBaseUrl).href) as RollupRuntime;
    return this.rollup;
  }
}
