import { describe, expect, it } from 'vitest';
import { readGlobalTavernState } from '../tavern/global-state-reader';
import { ProductionCardStateAdapter } from '../tavern/production-adapter';
import { FakeTavernBridge } from '../tavern/test-bridge';
import { MemoryCardStateAdapter } from '../transaction/adapter';
import { transactionState } from '../transaction/test-fixture';
import { CardWorkspaceLiveSource } from './card-live-source';
import { LiveWorkspaceRepository } from './live-repository';

describe('CardWorkspaceLiveSource', () => {
  it('文件工具完成时已经写入真实角色状态，不再等待轮末候选提交', async () => {
    const adapter = new MemoryCardStateAdapter(transactionState());
    const repository = new LiveWorkspaceRepository({ source: new CardWorkspaceLiveSource(adapter) });
    await repository.initialize();
    await repository.patch(
      '/character/definition/description.md',
      '@@ -1 +1 @@\n-base description\n+实时描述\n',
      'patch-description',
    );
    expect((await adapter.read()).character.fields.description).toBe('实时描述');
    expect(repository.mutationResult('patch-description')).toMatchObject({ status: 'success' });
  });

  it('多状态操作部分失败时不回滚已成功部分，并报告partial_success', async () => {
    const state = transactionState();
    const adapter = new MemoryCardStateAdapter(state, { failAtApply: 2 });
    const repository = new LiveWorkspaceRepository({ source: new CardWorkspaceLiveSource(adapter) });
    await repository.initialize();
    const description = await repository.read('/character/definition/description.md');
    const personality = await repository.read('/character/definition/personality.md');
    const source = new CardWorkspaceLiveSource(adapter);
    const result = await source.apply({
      changes: [
        { after: { ...description, content: '已写入' }, before: description, kind: 'modify', path: description.path },
        { after: { ...personality, content: '会失败' }, before: personality, kind: 'modify', path: personality.path },
      ],
      toolCallId: 'partial',
    });
    expect(result.status).toBe('partial_success');
    expect((await adapter.read()).character.fields.description).toBe('已写入');
    expect((await adapter.read()).character.fields.personality).not.toBe('会失败');
  });

  it('全局会话修改已打开角色时不会把物理binding_id覆盖成global', async () => {
    const bridge = new FakeTavernBridge();
    const physicalBindingId = (bridge.raw?.data.extensions?.card_agent as Record<string, unknown> | undefined)?.binding_id;
    const adapter = new ProductionCardStateAdapter(bridge, currentBridge => readGlobalTavernState(currentBridge));
    const repository = new LiveWorkspaceRepository({
      source: new CardWorkspaceLiveSource(adapter, { synchronizeMetadata: false }),
    });
    await repository.initialize();

    await repository.patch(
      '/character/definition/description.md',
      '@@ -1 +1 @@\n-base description\n+全局会话实时描述\n',
      'global-description',
    );

    expect(bridge.raw?.data.description).toBe('全局会话实时描述');
    const savedBindingId = (bridge.raw?.data.extensions?.card_agent as Record<string, unknown> | undefined)?.binding_id;
    expect(savedBindingId).toBe(physicalBindingId);
    expect(savedBindingId).not.toBe('global');
  });
});
