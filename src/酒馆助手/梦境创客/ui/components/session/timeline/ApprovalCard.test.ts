// @vitest-environment happy-dom

import { createApp, shallowRef } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ApprovalCard from './ApprovalCard.vue';

const runtimeMock = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('../../../composables/runtime', () => ({
  useDreamCardAgent: () => runtimeMock.context,
}));

let mounted: { root: HTMLElement; unmount: () => void } | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted?.root.remove();
  mounted = undefined;
});

describe('ApprovalCard', () => {
  it('长任务等待生成前检查点时不被全局busy锁死', async () => {
    const approve = vi.fn(async () => undefined);
    runtimeMock.context = {
      action: async (work: () => Promise<unknown>) => {
        await work();
        return true;
      },
      runtime: { approve },
      state: shallowRef({
        active: {
          approval: {
            candidateSnapshot: 'candidate',
            conflicts: [],
            fileChanges: [],
            midRun: true,
            skillChanges: [],
            stateChanges: [
              {
                after: 'new',
                before: 'old',
                highRisk: false,
                kind: 'set',
                label: '修改描述',
                path: '/character/fields/description',
              },
            ],
            warnings: [],
          },
        },
        activeSessionAccess: 'live',
        busy: true,
      }),
    };
    const root = document.createElement('div');
    document.body.append(root);
    const app = createApp(ApprovalCard);
    app.mount(root);
    mounted = { root, unmount: () => app.unmount() };

    const button = root.querySelector<HTMLButtonElement>('.dca-btn-primary')!;
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(approve).toHaveBeenCalledWith({ '/character/fields/description': 'agent' }));
  });
});
