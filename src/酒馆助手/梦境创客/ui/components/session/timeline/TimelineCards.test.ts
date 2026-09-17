// @vitest-environment happy-dom

import { createApp, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUiItem } from '../../../../core/session/types';
import ToolGroup from './ToolGroup.vue';
import ToolResultCard from './ToolResultCard.vue';

vi.mock('../../../editor/VfsTextEditor.vue', () => ({
  default: {
    props: { modelValue: String, path: String, readonly: Boolean },
    template: '<pre class="test-js-view" :data-readonly="readonly" :data-path="path">{{ modelValue }}</pre>',
  },
}));

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
  it('JS 卡片展示意图、只读代码视图和独立的结果区', async () => {
    const root = mount(ToolResultCard, {
      tool: {
        id: 'js',
        at: 1,
        kind: 'tool',
        toolName: 'run_javascript',
        status: 'completed',
        toolInput: JSON.stringify({ intent: '检查变量类型', code: 'const n = 42;\nreturn n;' }),
        content: JSON.stringify({
          result: 42,
          hasResult: true,
          console: [{ level: 'log', values: ['ready'] }],
          durationMs: 20,
        }),
      },
    });
    expect(root.querySelector('.dca-tool-result-heading')?.textContent).toContain('检查变量类型');
    root.querySelector<HTMLButtonElement>('.dca-tool-code-toggle')!.click();
    await nextTick();
    const code = root.querySelector<HTMLElement>('.test-js-view')!;
    expect(code.textContent).toBe('const n = 42;\nreturn n;');
    expect(code.dataset.readonly).toBe('true');
    expect(code.dataset.path).toBe('execution.js');
    expect(root.textContent).toContain('返回值');
    expect(root.textContent).toContain('Console');
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
});
