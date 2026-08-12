// @vitest-environment happy-dom

import { createApp, nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
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
