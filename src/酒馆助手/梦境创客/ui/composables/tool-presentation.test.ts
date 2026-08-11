import { describe, expect, it } from 'vitest';
import type { SessionUiItem } from '../../core/session/types';
import { buildToolPresentation, formatToolRaw } from './tool-presentation';

function tool(overrides: Partial<SessionUiItem> = {}): SessionUiItem {
  return {
    at: 1,
    content: '{}',
    id: 'tool:1',
    kind: 'tool',
    status: 'completed',
    toolInput: '{}',
    toolName: 'unknown_tool',
    ...overrides,
  };
}

describe('tool presentation', () => {
  it('把文件读取结果转换为紧凑代码卡', () => {
    const presentation = buildToolPresentation(
      tool({
        content: JSON.stringify({
          endLine: 8,
          path: '/character/card.md',
          startLine: 1,
          totalLines: 20,
          view: '1 | a\n2 | b',
        }),
        toolInput: JSON.stringify({ path: '/character/card.md' }),
        toolName: 'read_file',
      }),
    );

    expect(presentation).toMatchObject({
      kind: 'file',
      path: '/character/card.md',
      preview: { content: '1 | a\n2 | b', mode: 'code' },
      title: '读取文件',
    });
    expect(presentation.metrics).toEqual(
      expect.arrayContaining([
        { label: '行', value: '1–8' },
        { label: '总计', value: '20 行' },
      ]),
    );
  });

  it('保留目录的全部结果并交给卡片内部滚动', () => {
    const presentation = buildToolPresentation(
      tool({
        content: JSON.stringify([
          { kind: 'directory', name: 'worldbooks', path: '/worldbooks', readonly: false },
          { kind: 'file', name: 'card.md', path: '/card.md', readonly: false, size: 2048 },
          { kind: 'file', name: 'one.md', path: '/one.md', readonly: false },
          { kind: 'file', name: 'two.md', path: '/two.md', readonly: false },
        ]),
        toolInput: JSON.stringify({ path: '/' }),
        toolName: 'list_directory',
      }),
    );

    expect(presentation.rows).toHaveLength(4);
    expect(presentation.rows[1]).toMatchObject({ label: 'card.md', meta: '2.0 KB' });
    expect(presentation.expandable).toBe(true);
  });

  it('为文件搜索生成命中行和计数', () => {
    const presentation = buildToolPresentation(
      tool({
        content: JSON.stringify({
          matchedFiles: 1,
          matches: [
            { column: 2, contextAfter: [], contextBefore: [], line: 7, path: '/a.ts', text: 'const dream = true;' },
          ],
          returnedMatches: 1,
          truncated: false,
        }),
        toolInput: JSON.stringify({ path: '/', pattern: 'dream' }),
        toolName: 'search_files',
      }),
    );

    expect(presentation.summary).toBe('搜索“dream”');
    expect(presentation.rows[0]).toMatchObject({ detail: 'const dream = true;', label: '/a.ts', meta: '第 7 行' });
  });

  it('为补丁统计增删行并保留可滚动 Diff', () => {
    const presentation = buildToolPresentation(
      tool({
        content: JSON.stringify({ patched: true, path: '/a.ts' }),
        toolInput: JSON.stringify({ patch: '@@ -1 +1 @@\n-old\n+new', path: '/a.ts' }),
        toolName: 'apply_patch',
      }),
    );

    expect(presentation.preview).toMatchObject({ mode: 'diff' });
    expect(presentation.metrics).toEqual([
      { label: '新增', tone: 'success', value: '+1' },
      { label: '删除', tone: 'danger', value: '-1' },
    ]);
  });

  it('分别生成世界书、酒馆会话和联网搜索卡片', () => {
    const worldbook = buildToolPresentation(
      tool({
        content: JSON.stringify({ entries: 12, name: '主世界书', path: '/worldbooks/main' }),
        toolInput: JSON.stringify({ name: '主世界书', source: '旧世界书' }),
        toolName: 'clone_worldbook',
      }),
    );
    const tavern = buildToolPresentation(
      tool({
        content: JSON.stringify({ chatId: 'c1', completed: true, images: 2 }),
        toolInput: JSON.stringify({ chatId: 'c1', message: '继续这个故事' }),
        toolName: 'send_tavern_message',
      }),
    );
    const web = buildToolPresentation(
      tool({
        content: JSON.stringify({
          action: {
            query: '梦境创客',
            sources: [{ title: '项目主页', type: 'url', url: 'https://example.test/project' }],
          },
        }),
        providerTool: true,
        toolName: 'web_search',
      }),
    );

    expect(worldbook).toMatchObject({ kind: 'worldbook', summary: '主世界书 · 克隆完成' });
    expect(tavern).toMatchObject({ kind: 'tavern', preview: { content: '继续这个故事', mode: 'text' } });
    expect(web).toMatchObject({ kind: 'web', summary: '搜索“梦境创客”' });
    expect(web.rows[0]).toMatchObject({ label: '项目主页', meta: 'example.test' });
  });

  it('失败、运行中和未知旧数据都有安全回退', () => {
    const failed = buildToolPresentation(
      tool({ content: '第一行错误\n调用栈', status: 'failed', toolName: 'read_file' }),
    );
    const running = buildToolPresentation(tool({ content: '{"path":"/a"}', status: 'running', toolName: 'read_file' }));
    const unknown = buildToolPresentation(tool({ content: 'not json', toolInput: '{broken' }));

    expect(failed).toMatchObject({ preview: { mode: 'text' }, summary: '第一行错误', tone: 'danger' });
    expect(running.rawOutput).toBe('等待工具返回…');
    expect(unknown).toMatchObject({ kind: 'generic', rawInput: '{broken', rawOutput: 'not json' });
    expect(formatToolRaw('{"value":1}')).toBe('{\n  "value": 1\n}');
  });
});
