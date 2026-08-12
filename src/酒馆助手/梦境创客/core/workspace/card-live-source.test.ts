import { describe, expect, it } from 'vitest';
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
      '/character/description.md',
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
    const description = await repository.read('/character/description.md');
    const personality = await repository.read('/character/personality.md');
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
});
