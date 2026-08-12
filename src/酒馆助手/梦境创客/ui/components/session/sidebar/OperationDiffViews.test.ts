// @vitest-environment happy-dom

import { createApp, nextTick, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceOperationRecord } from '../../../../core/operations/file-operation';
import type { WorkspaceFile } from '../../../../core/workspace/types';
import { buildOperationDiffFiles } from '../../../composables/operation-diff';
import OperationDiffCard from '../timeline/OperationDiffCard.vue';
import OperationDiffFile from './OperationDiffFile.vue';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

const mounted: Array<{ root: HTMLElement; unmount: () => void }> = [];

function file(path: string, content: string): WorkspaceFile {
  return { content, mediaType: 'text/markdown', path, readonly: false, resourceId: path };
}

function mount(component: Parameters<typeof createApp>[0], props: Record<string, unknown>): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  const app = createApp(component, props);
  app.mount(root);
  mounted.push({ root, unmount: () => app.unmount() });
  return root;
}

afterEach(() => {
  for (const item of mounted.splice(0)) {
    item.unmount();
    item.root.remove();
  }
});

describe('operation diff views', () => {
  it('消息卡可折叠文件、展开更多，并把文件和轮次送往Diff', async () => {
    const records = await Promise.all(
      Array.from({ length: 4 }, async (_, index) => {
        const path = `/worldbooks/book/entries/${index + 1}.md`;
        return createWorkspaceOperationRecord({
          actor: 'agent',
          approvalMode: 'yolo',
          change: { after: file(path, `entry ${index + 1}\n`), kind: 'create', path },
          operationId: `operation:${index}`,
          toolCallId: `call:${index}`,
          turnId: 'turn:diff-card',
        });
      }),
    );
    const openDiff = vi.fn();
    runtimeMock.context = {
      action: async (work: () => Promise<unknown>) => {
        await work();
        return true;
      },
      runtime: { redo: vi.fn(), undo: vi.fn() },
      state: shallowRef({
        active: {
          operationLog: {
            records,
            turns: [
              {
                operationIds: records.map(record => record.operationId),
                recoveryAvailable: true,
                redoOperationIds: [],
                turnId: 'turn:diff-card',
              },
            ],
          },
        },
        activeSessionAccess: 'live',
        busy: false,
      }),
    };
    const root = mount(OperationDiffCard, { onOpenDiff: openDiff });

    expect(root.querySelector('.dca-operation-summary')?.textContent).toContain('已变更 4 个文件');
    expect(root.querySelectorAll('.dca-operation-diff-files > button')).toHaveLength(3);

    const showMore = root.querySelector<HTMLButtonElement>('.dca-operation-show-more')!;
    showMore.click();
    await nextTick();
    expect(root.querySelectorAll('.dca-operation-diff-files > button')).toHaveLength(4);

    root.querySelector<HTMLButtonElement>('.dca-operation-diff-files > button')!.click();
    expect(openDiff).toHaveBeenCalledWith({
      filePath: '/worldbooks/book/entries/1.md',
      turnId: 'turn:diff-card',
    });

    root.querySelector<HTMLButtonElement>('.dca-operation-summary')!.click();
    await nextTick();
    expect(root.querySelector('.dca-operation-diff-files')).toBeNull();
  });

  it('Unified Diff文件可展开隐藏上下文、整体折叠并跳转文件视图', async () => {
    const before = file('/character/test.md', Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n'));
    const after = file('/character/test.md', before.content.replace('line 15', 'changed 15'));
    const record = await createWorkspaceOperationRecord({
      actor: 'agent',
      approvalMode: 'yolo',
      change: { after, before, kind: 'modify', path: after.path },
      toolCallId: 'call:modify',
      turnId: 'turn:modify',
    });
    const [diffFile] = buildOperationDiffFiles([record]);
    const openFile = vi.fn();
    const root = mount(OperationDiffFile, { file: diffFile, onOpenFile: openFile, openable: true });

    const foldCount = root.querySelectorAll('.dca-unified-fold').length;
    const fold = root.querySelector<HTMLButtonElement>('.dca-unified-fold')!;
    expect(fold.textContent).toContain('未修改内容');
    fold.click();
    await nextTick();
    expect(root.querySelectorAll('.dca-unified-fold')).toHaveLength(foldCount - 1);

    root.querySelector<HTMLButtonElement>('.dca-unified-open-file')!.click();
    expect(openFile).toHaveBeenCalledWith('/character/test.md');

    root.querySelector<HTMLButtonElement>('.dca-unified-file-toggle')!.click();
    await nextTick();
    expect(root.querySelector('.dca-unified-file-body')).toBeNull();
  });
});
