import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { materializeCardWorkspace, projectCardWorkspace } from '../mapping/card-workspace-mapper';
import { writeRegexScope } from '../tavern/resource-reader';
import { transactionState } from '../transaction/test-fixture';
import type { WorkspaceFile } from '../workspace/types';
import { HtmlProjectCompiler } from './html-project';
import { unwrapHtmlReplacement } from './html-output';

function project(destination?: unknown, renderer = 'tavern-helper'): WorkspaceFile {
  return {
    content: stringify({
      build: { entry: 'index.html' },
      name: '界面',
      regex: { destination, find: '/UI/g', placement: [2] },
      renderer,
    }),
    mediaType: 'text/yaml',
    path: '/files/ui/project.yaml',
    readonly: false,
    resourceId: 'project',
  };
}

describe('HTML工程正则输出模式', () => {
  const compiler = new HtmlProjectCompiler('https://example.invalid/');
  const checked = {
    diagnostics: [],
    output: '<b>UI</b>',
    outputBytes: 9,
    projectName: '界面',
    renderer: 'tavern-helper' as const,
  };

  it.each(['plain-html', 'tavern-helper'])('%s默认仅显示', renderer => {
    const file = project(undefined, renderer);
    const output = compiler.regexYaml(checked, file.path, [file], 'character', false);
    expect(parse(output.content).destination).toEqual({ display: true, prompt: false });
    expect(parse(output.content).replace_string).toBe(
      renderer === 'plain-html' ? '<b>UI</b>' : '```html\n<body>\n<b>UI</b>\n</body>\n```',
    );
    const base = transactionState();
    const state = materializeCardWorkspace(base, [
      ...projectCardWorkspace(base),
      { ...file, content: output.content, path: output.path },
    ]).state;
    expect(writeRegexScope(state.resources.regexes.character).at(-1)).toMatchObject({
      markdownOnly: true,
      promptOnly: false,
    });
  });

  it('酒馆助手产物保留脚本与捕获引用，预览解包多个替换块', () => {
    const file = project();
    const html =
      '<style>.ui{color:red}</style><div class="ui">$1</div><script type="module">console.log("ready")</script>';
    const output = compiler.regexYaml({ ...checked, output: html }, file.path, [file], 'character', false);
    const replacement = parse(output.content).replace_string as string;
    expect(unwrapHtmlReplacement(replacement, 'tavern-helper')).toBe(html);
    const text = '<input>one</input>\n<input>two</input>'.replace(/<input>(.*?)<\/input>/gu, replacement);
    expect(unwrapHtmlReplacement(text, 'tavern-helper')).toBe(
      `${html.replace('$1', 'one')}\n${html.replace('$1', 'two')}`,
    );
    expect(unwrapHtmlReplacement(replacement, 'plain-html')).toBe(replacement);
    const existing: WorkspaceFile = { ...file, content: output.content, path: output.path, resourceId: 'regex' };
    const updated = compiler.regexYaml({ ...checked, output: html }, file.path, [file, existing], 'character', true);
    expect(parse(updated.content).replace_string).toBe(replacement);
  });

  it.each([
    { display: true, prompt: false },
    { display: false, prompt: true },
    { display: true, prompt: true },
  ])('创建和覆盖使用配置的模式：%j', destination => {
    const file = project(destination);
    const output = compiler.regexYaml(checked, file.path, [file], 'character', false);
    expect(parse(output.content).destination).toEqual(destination);
    const existing: WorkspaceFile = { ...file, content: output.content, path: output.path, resourceId: 'regex' };
    const updated = compiler.regexYaml(checked, file.path, [file, existing], 'character', true);
    expect(updated.path).toBe(existing.path);
    expect(parse(updated.content).destination).toEqual(destination);
  });

  it.each(['display', { prompt: 'false' }, { display: 1 }, { display: false, prompt: false }])(
    '检查时拒绝非法模式：%j',
    async destination => {
      const file = project(destination);
      await expect(compiler.check(file.path, [file])).rejects.toThrow('regex.destination');
    },
  );
});
