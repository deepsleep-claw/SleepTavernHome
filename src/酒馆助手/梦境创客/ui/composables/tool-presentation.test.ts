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
  it('工程检查失败按诊断展示，而不是声称文件操作完成', () => {
    const presentation = buildToolPresentation(
      tool({
        toolName: 'manage_html_project',
        toolInput: JSON.stringify({ action: 'check', project: '/character/files/ui/project.yaml' }),
        content: JSON.stringify({
          valid: false,
          diagnostics: [{ severity: 'error', file: 'main.js', line: 3, message: '语法错误' }],
          outputBytes: 0,
        }),
      }),
    );
    expect(presentation.tone).toBe('danger');
    expect(presentation.summary).toBe('检查未通过');
    expect(presentation.rows[0]).toMatchObject({ label: '语法错误', detail: 'main.js:3' });
  });
  it('JavaScript 用意图作摘要，并保留执行时的文件代码快照', () => {
    const presentation = buildToolPresentation(
      tool({
        toolName: 'run_javascript',
        toolInput: JSON.stringify({ intent: '检查变量初始化', path: '/character/files/check.js' }),
        toolCode: 'return await Promise.resolve(42);',
      }),
    );
    expect(presentation.summary).toBe('检查变量初始化');
    expect(presentation.javascript).toEqual({
      intent: '检查变量初始化',
      path: '/character/files/check.js',
      code: 'return await Promise.resolve(42);',
    });
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
