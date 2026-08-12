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
      { label: '补丁', value: '3 行' },
      { label: '新增', tone: 'success', value: '+1' },
      { label: '删除', tone: 'danger', value: '-1' },
    ]);
  });

  it('从未闭合的流式参数中提取写入与补丁进度', () => {
    const writing = buildToolPresentation(
      tool({
        content: '',
        status: 'running',
        toolInput: '{"path":"/character/live.md","content":"第一行\\n第二行\\n第三',
        toolName: 'write_file',
        toolPhase: 'generating',
      }),
    );
    const patching = buildToolPresentation(
      tool({
        content: '',
        status: 'running',
        toolInput: '{"path":"/character/live.md","patch":"@@ -1,2 +1,3 @@\\n-old\\n+new\\n+extra',
        toolName: 'apply_patch',
        toolPhase: 'generating',
      }),
    );
    const contentBeforePath = buildToolPresentation(
      tool({
        content: '',
        status: 'running',
        toolInput: '{"content":"正文里的\\"path\\":\\"/fake.md\\"","path":"/character/real.md',
        toolName: 'write_file',
        toolPhase: 'generating',
      }),
    );

    expect(writing).toMatchObject({ path: '/character/live.md', summary: '正在编写文件内容…' });
    expect(writing.metrics).toEqual([
      { label: '已编写', value: '3 行' },
      { label: '字符', value: '10' },
    ]);
    expect(patching).toMatchObject({ path: '/character/live.md', summary: '正在生成补丁…' });
    expect(patching.metrics).toEqual([
      { label: '补丁', value: '4 行' },
      { label: '新增', tone: 'success', value: '+2' },
      { label: '删除', tone: 'danger', value: '-1' },
    ]);
    expect(contentBeforePath.path).toBe('/character/real.md');
  });

  it('通用工具在参数生成与就绪阶段使用统一状态', () => {
    const generating = buildToolPresentation(
      tool({ content: '', status: 'running', toolInput: '{"path":"/', toolName: 'read_file', toolPhase: 'generating' }),
    );
    const ready = buildToolPresentation(
      tool({ content: '', status: 'running', toolInput: '{"path":"/"}', toolName: 'read_file', toolPhase: 'ready' }),
    );

    expect(generating).toMatchObject({ rawOutput: '正在生成调用参数…', summary: '正在生成调用参数…' });
    expect(ready).toMatchObject({ rawOutput: '参数已就绪，等待执行…', summary: '参数已就绪，等待执行…' });
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
    expect(web).toMatchObject({ kind: 'web', summary: '搜索“梦境创客” · 1 条结果' });
    expect(web.webSearch?.groups[0]?.results[0]).toMatchObject({
      domain: 'example.test',
      faviconDarkUrl: 'https://example.test/favicon.ico',
      faviconLightUrl: 'https://example.test/favicon.ico',
      title: '项目主页',
      url: 'https://example.test/project',
    });
  });

  it('把 DeepSeek 多查询原生返回转换为紧凑搜索结果组', () => {
    const web = buildToolPresentation(
      tool({
        content: JSON.stringify([
          {
            query: '哈基米是什么梗',
            results: [
              {
                publish_date: '2023-07-03 16:00:00',
                snippet: '哈基米一词出自日本动漫《赛马娘》。',
                title: '哈基米是什么梗？',
                url: 'https://henan.china.com/m/example',
              },
              { title: '第二条结果', url: 'javascript:alert(1)' },
            ],
          },
        ]),
        providerTool: true,
        toolInput: JSON.stringify({ queries: ['哈基米是什么梗'] }),
        toolName: 'web_search',
      }),
    );

    expect(web).toMatchObject({ kind: 'web', summary: '找到 2 条结果' });
    expect(web.webSearch).toMatchObject({ totalResults: 2 });
    expect(web.webSearch?.groups[0]).toMatchObject({ query: '哈基米是什么梗' });
    expect(web.webSearch?.groups[0]?.results).toEqual([
      {
        domain: 'henan.china.com',
        faviconDarkUrl: 'https://henan.china.com/favicon.ico',
        faviconFallbackUrl: undefined,
        faviconLightUrl: 'https://henan.china.com/favicon.ico',
        publishDate: '2023-07-03 16:00:00',
        snippet: '哈基米一词出自日本动漫《赛马娘》。',
        title: '哈基米是什么梗？',
        url: 'https://henan.china.com/m/example',
      },
      {
        domain: undefined,
        faviconDarkUrl: undefined,
        faviconFallbackUrl: undefined,
        faviconLightUrl: undefined,
        publishDate: undefined,
        snippet: undefined,
        title: '第二条结果',
        url: undefined,
      },
    ]);
  });

  it('在 DeepSeek 只公开联网动作时显示真实查询并忽略内部调用 ID', () => {
    const searched = buildToolPresentation(
      tool({
        content: JSON.stringify({
          action: { queries: ['哈基米是什么梗', 'ws_call_id=call_123'], type: 'search' },
        }),
        providerTool: true,
        toolName: 'web_search',
      }),
    );
    const opened = buildToolPresentation(
      tool({
        content: JSON.stringify({
          action: { type: 'openPage', url: 'https://example.test/article' },
        }),
        providerTool: true,
        toolName: 'web_search',
      }),
    );

    expect(searched).toMatchObject({ kind: 'web', summary: '搜索“哈基米是什么梗”' });
    expect(searched.webAction).toEqual({
      queries: ['哈基米是什么梗'],
      resultsReturned: false,
      type: 'search',
    });
    expect(searched.webSearch).toBeUndefined();
    expect(opened).toMatchObject({ kind: 'web', summary: 'example.test · 网页已打开', title: '打开网页' });
    expect(opened.webAction).toMatchObject({
      target: {
        faviconDarkUrl: 'https://example.test/favicon.ico',
        url: 'https://example.test/article',
      },
      type: 'open',
    });
  });

  it('复用来源卡展示 DeepSeek 打开网页、页内查找与错误结果', () => {
    const opened = buildToolPresentation(
      tool({
        content: JSON.stringify({
          content: '## 哈基米是什么梗\n\n清洗后的网页正文',
          title: '哈基米是什么梗？',
          url: 'https://example.test/article',
        }),
        providerTool: true,
        toolInput: JSON.stringify({ url: 'https://example.test/article' }),
        toolName: 'open_page',
      }),
    );
    const found = buildToolPresentation(
      tool({
        content: JSON.stringify({
          matches: [{ context: '名字是东海帝王，她特别喜欢蜂蜜水。' }],
          pattern: '东海帝王',
          total_matches: 1,
          url: 'https://example.test/article',
        }),
        providerTool: true,
        toolName: 'find_in_page',
      }),
    );
    const unavailable = buildToolPresentation(
      tool({
        content: JSON.stringify({ error_code: 'unavailable', message: 'STATUS_403' }),
        providerTool: true,
        toolName: 'open_page',
      }),
    );

    expect(opened).toMatchObject({ kind: 'web', summary: '哈基米是什么梗？ · 网页正文已读取' });
    expect(opened.webAction).toMatchObject({
      contentPreview: '## 哈基米是什么梗',
      target: { domain: 'example.test' },
      type: 'open',
    });
    expect(found).toMatchObject({ kind: 'web', summary: '查找“东海帝王” · 1 处匹配' });
    expect(found.webAction).toMatchObject({
      matches: ['名字是东海帝王，她特别喜欢蜂蜜水。'],
      pattern: '东海帝王',
      totalMatches: 1,
      type: 'find',
    });
    expect(unavailable).toMatchObject({ summary: '网页暂不可用 · STATUS_403', tone: 'warning' });
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
