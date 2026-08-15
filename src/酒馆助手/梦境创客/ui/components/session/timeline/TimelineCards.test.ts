// @vitest-environment happy-dom

import { createApp, nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUiItem } from '../../../../core/session/types';
import ReasoningBlock from './ReasoningBlock.vue';
import RunBlock from './RunBlock.vue';
import ToolGroup from './ToolGroup.vue';

const mountedApps: Array<{ root: HTMLElement; unmount: () => void }> = [];

function mount(component: Parameters<typeof createApp>[0], props: Record<string, unknown>): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(component, props);
  app.mount(root);
  mountedApps.push({ root, unmount: () => app.unmount() });
  return root;
}

afterEach(() => {
  for (const mounted of mountedApps.splice(0)) {
    mounted.unmount();
    mounted.root.remove();
  }
});

describe('timeline cards', () => {
  it('短思考使用可贴底的预览内容容器', () => {
    const root = mount(ReasoningBlock, {
      item: {
        at: 1,
        content: '只有一行的短思考',
        id: 'reasoning:short',
        kind: 'reasoning',
        status: 'running',
      } satisfies SessionUiItem,
    });

    expect(root.querySelector('.dca-reasoning-preview-content')?.textContent).toBe('只有一行的短思考');
  });

  it('思考中收起时保留完整文本作为固定视口内容，展开时显示全文', async () => {
    const content = '第一段旧内容\n第二段旧内容\n第三段旧内容\n第四段最新内容';
    const item = reactive<SessionUiItem>({
      at: 1,
      content,
      id: 'reasoning:1',
      kind: 'reasoning',
      status: 'running',
    });
    const root = mount(ReasoningBlock, { item });

    const preview = root.querySelector('.dca-reasoning-preview');
    expect(preview?.textContent).toContain('第一段旧内容');
    expect(preview?.textContent).toContain('第四段最新内容');

    const details = root.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();

    expect(root.querySelector('.dca-reasoning-preview')).toBeNull();
    expect(root.querySelector('pre')?.textContent).toBe(content);
  });

  it('思考完成后收起为单行，展开后才显示全文', async () => {
    const content = '完整思考的第一段\n完整思考的第二段';
    const item = reactive<SessionUiItem>({
      at: 1,
      content,
      durationMs: 2_400,
      id: 'reasoning:completed',
      kind: 'reasoning',
      status: 'completed',
    });
    const root = mount(ReasoningBlock, { item });

    expect(root.querySelector('.dca-reasoning-label')?.textContent).toBe('已思考 2 秒');
    expect(root.querySelector('.dca-reasoning-preview')).toBeNull();

    const details = root.querySelector('details')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await nextTick();

    expect(root.querySelector('pre')?.textContent).toBe(content);
  });

  it('工具组展开区呈现语义卡，并按需打开 Raw 输入输出', async () => {
    const items: SessionUiItem[] = [
      {
        at: 1,
        content: JSON.stringify({
          endLine: 2,
          path: '/card.md',
          startLine: 1,
          totalLines: 2,
          view: '1 | title\n2 | body',
        }),
        id: 'tool:1',
        kind: 'tool',
        status: 'completed',
        toolInput: JSON.stringify({ path: '/card.md' }),
        toolName: 'read_file',
      },
    ];
    const root = mount(ToolGroup, { items });

    expect(root.querySelector('.dca-tool-group > summary')?.textContent).toContain('已调用 1 个工具');
    expect(root.querySelector('.dca-tool-result-card')?.textContent).toContain('读取文件');
    expect(root.querySelector('.dca-tool-raw-panel')).toBeNull();

    const rawToggle = [...root.querySelectorAll('button')].find(button => button.textContent?.includes('原始数据'));
    rawToggle?.click();
    await nextTick();

    expect(root.querySelector('.dca-tool-raw-panel')).not.toBeNull();
    expect(root.querySelector('.dca-tool-raw-panel pre')?.textContent).toContain('"path": "/card.md"');
    const outputTab = [...root.querySelectorAll<HTMLButtonElement>('.dca-tool-raw-tabs button')].find(button =>
      button.textContent?.includes('输出'),
    );
    outputTab?.click();
    await nextTick();
    expect(root.querySelector('.dca-tool-raw-panel pre')?.textContent).toContain('"view": "1 | title');
  });

  it('把 DeepSeek 网页搜索结果渲染为可展开的紧凑来源列表', async () => {
    const results = Array.from({ length: 4 }, (_, index) => ({
      publish_date: `2023-07-0${index + 1} 16:00:00`,
      snippet: `第 ${index + 1} 条摘要`,
      title: `第 ${index + 1} 条结果`,
      url: `https://example${index + 1}.test/result`,
    }));
    const root = mount(ToolGroup, {
      items: [
        {
          at: 1,
          content: JSON.stringify([{ query: '哈基米是什么梗', results }]),
          id: 'tool:web-search',
          kind: 'tool',
          providerTool: true,
          status: 'completed',
          toolInput: JSON.stringify({ queries: ['哈基米是什么梗'] }),
          toolName: 'web_search',
        },
      ] satisfies SessionUiItem[],
    });

    expect(root.querySelector('.dca-web-search-query')?.textContent).toContain('哈基米是什么梗');
    expect(root.querySelector('.dca-web-query-list')?.textContent).toContain('哈基米是什么梗');
    expect(root.querySelectorAll('.dca-web-search-list > li')).toHaveLength(3);
    expect(root.querySelector<HTMLAnchorElement>('.dca-web-search-result-title a')?.href).toBe(
      'https://example1.test/result',
    );
    expect(root.querySelector<HTMLImageElement>('.dca-web-search-favicon img')?.src).toBe(
      'https://example1.test/favicon.ico',
    );

    const expand = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button =>
      button.textContent?.includes('展开其余 1 条'),
    );
    expand?.click();
    await nextTick();
    expect(root.querySelectorAll('.dca-web-search-list > li')).toHaveLength(4);
  });

  it('分别展示搜索 Query、打开网页与无计数的页内查找', () => {
    const root = mount(ToolGroup, {
      items: [
        {
          at: 1,
          content: JSON.stringify({
            action: {
              queries: ['SillyTavern 最新版本', 'Deep Sleep 梦境创客', 'ws_call_id=call_1'],
              type: 'search',
            },
          }),
          id: 'tool:search-actions',
          kind: 'tool',
          providerTool: true,
          status: 'completed',
          toolName: 'web_search',
        },
        {
          at: 2,
          content: JSON.stringify({
            action: { type: 'openPage', url: 'https://github.com/SillyTavern/SillyTavern/releases/tag/1.17.0#ws_call_id=call_2' },
          }),
          id: 'tool:open-action',
          kind: 'tool',
          providerTool: true,
          status: 'completed',
          toolName: 'web_search',
        },
        {
          at: 3,
          content: JSON.stringify({
            action: {
              pattern: 'New features',
              type: 'findInPage',
              url: 'https://github.com/SillyTavern/SillyTavern/releases/tag/1.17.0#ws_call_id=call_3',
            },
          }),
          id: 'tool:find-action',
          kind: 'tool',
          providerTool: true,
          status: 'completed',
          toolName: 'web_search',
        },
      ] satisfies SessionUiItem[],
    });

    expect(root.querySelector('.dca-web-query-list')?.textContent).toContain('Deep Sleep 梦境创客');
    expect(root.querySelector('.dca-web-query-list')?.textContent).not.toContain('ws_call_id');
    expect(root.querySelector('.dca-web-action-open')?.textContent).toContain('github.com');
    expect(root.querySelector<HTMLAnchorElement>('.dca-web-action-open .dca-web-target')?.href).not.toContain(
      'ws_call_id',
    );
    expect(root.querySelector('.dca-web-action-find')?.textContent).toContain('New features');
    expect(root.querySelector('.dca-web-action-find')?.textContent).toContain('结果明细未返回');
    expect(root.querySelector('.dca-web-action-find')?.textContent).not.toContain('0 处匹配');
    expect(root.querySelector<HTMLImageElement>('.dca-web-action-open img')?.src).toBe(
      'https://github.githubassets.com/favicons/favicon-dark.svg',
    );
  });

  it('把工具审批嵌入对应工具卡并自动展开，决定通过事件上送', async () => {
    const resolveConfirmation = vi.fn();
    const items: SessionUiItem[] = [
      {
        at: 1,
        content: '',
        id: 'tool:create-worldbook',
        kind: 'tool',
        status: 'running',
        toolCallId: 'call:create-worldbook',
        toolInput: JSON.stringify({ name: '斗破苍穹' }),
        toolName: 'create_worldbook',
      },
    ];
    const root = mount(ToolGroup, {
      confirmation: {
        description: '创建新的可编辑世界书。',
        intent: { name: '斗破苍穹' },
        risk: 'ordinary',
        sessionId: 'session:1',
        toolCallId: 'call:create-worldbook',
        toolName: 'create_worldbook',
      },
      items,
      onResolveConfirmation: resolveConfirmation,
    });

    expect(root.querySelector<HTMLDetailsElement>('.dca-tool-group')?.open).toBe(true);
    expect(root.querySelector('.dca-tool-confirmation-panel')?.textContent).toContain('Agent 请求执行此工具');
    expect(root.querySelector('.dca-tool-confirmation-panel')?.textContent).toContain('斗破苍穹');
    expect(root.querySelector('.dca-tool-confirmation')).toBeNull();

    const approve = [...root.querySelectorAll<HTMLButtonElement>('button')].find(button =>
      button.textContent?.includes('批准并执行'),
    );
    approve?.click();
    await nextTick();
    expect(resolveConfirmation).toHaveBeenCalledWith(true);
  });

  it('运行块的中途文本不显示梦境创客署名', () => {
    const root = mount(RunBlock, {
      block: {
        durationMs: 2_000,
        id: 'run:1',
        items: [
          {
            at: 1,
            content: '这是一段中途输出。',
            id: 'assistant:intermediate',
            kind: 'assistant',
            status: 'completed',
          },
        ],
        status: 'completed',
        type: 'run',
      },
      collapsed: false,
    });

    expect(root.querySelector('.dca-step-text')?.textContent).toContain('这是一段中途输出。');
    expect(root.querySelector('.dca-step-text')?.textContent).not.toContain('梦境创客');
    expect(root.querySelector('.dca-step-text > header')).toBeNull();
  });
});
