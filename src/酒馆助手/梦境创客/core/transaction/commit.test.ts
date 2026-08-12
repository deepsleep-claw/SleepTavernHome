import { klona } from 'klona';
import { describe, expect, it } from 'vitest';
import type { CardWorkspaceState } from '../mapping/types';
import { MemoryCardStateAdapter, type CardStateAdapter } from './adapter';
import { commitWorkingCopy } from './commit';
import { diffCardStates, type StateOperation } from './state-diff';
import { transactionState } from './test-fixture';

function approveAll(base: CardWorkspaceState, working: CardWorkspaceState): Record<string, 'agent'> {
  return Object.fromEntries(diffCardStates(base, working).map(item => [item.path, 'agent'])) as Record<string, 'agent'>;
}

describe('transaction commit', () => {
  it('按角色、开场白、世界书、绑定的顺序提交并验证', async () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'agent';
    working.character.greetings[0].content = 'new greeting';
    working.worldbooks[0].entries[0].content = 'new entry';
    working.bindings.primary = null;
    const adapter = new MemoryCardStateAdapter(base);
    const result = await commitWorkingCopy({ adapter, base, decisions: approveAll(base, working), working });
    expect(result.status).toBe('committed');
    expect((await adapter.read()).character.fields.description).toBe('agent');
    expect(adapter.applied.map(item => item.path)).toEqual([
      '/character/fields/description',
      '/character/greetings/greeting~11',
      '/worldbooks/book~11/entries/entry-1',
      '/bindings/primary',
    ]);
  });

  it('只写入批准项', async () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'approved';
    working.character.fields.personality = 'rejected';
    const adapter = new MemoryCardStateAdapter(base);
    await commitWorkingCopy({
      adapter,
      base,
      decisions: { '/character/fields/description': 'agent', '/character/fields/personality': 'current' },
      working,
    });
    expect((await adapter.read()).character.fields).toMatchObject({
      description: 'approved',
      personality: 'base personality',
    });
  });

  it('派生元数据不参与审批，并且只反映最终接受的数据', async () => {
    const base = transactionState();
    base.character.extensions.card_agent = {
      binding_id: base.character.bindingId,
      greetings: base.character.greetings.map(({ id, name }) => ({ id, name })),
      keep: 'unknown',
      worldbooks: base.worldbooks.map(({ name, resourceId }) => ({ id: resourceId, name })),
    };
    const working = klona(base);
    working.character.greetings[0].name = '拒绝的新名称';
    working.worldbooks.push({
      entries: [],
      name: '接受的新世界书',
      resourceId: 'new-book',
      roundTripSafe: true,
      unknownFields: {},
      writable: true,
    });
    const adapter = new MemoryCardStateAdapter(base);
    const changes = diffCardStates(base, working);

    expect(changes.some(change => change.path === '/character/extensions/card_agent')).toBe(false);
    const result = await commitWorkingCopy({
      adapter,
      base,
      decisions: {
        '/character/greetings/greeting~11': 'current',
        '/worldbooks/new-book': 'agent',
      },
      working,
    });

    expect(result.status).toBe('committed');
    const state = await adapter.read();
    expect(state.character.extensions.card_agent).toMatchObject({
      greetings: expect.arrayContaining([{ id: 'greeting/1', name: '初见' }]),
      keep: 'unknown',
      worldbooks: expect.arrayContaining([{ id: 'new-book', name: '接受的新世界书' }]),
    });
    expect(adapter.applied.at(-1)?.path).toBe('/character/extensions/card_agent');
  });

  it('中途失败时逆序回滚已写资源', async () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'first';
    working.character.fields.personality = 'second';
    const adapter = new MemoryCardStateAdapter(base, { failAtApply: 2 });
    const result = await commitWorkingCopy({ adapter, base, decisions: approveAll(base, working), working });
    expect(result.status).toBe('rolled-back');
    expect(await adapter.read()).toEqual(base);
    if (result.status === 'rolled-back') expect(result.rollbackError).toBeUndefined();
  });

  it('单独报告回滚失败，保留可诊断的当前状态', async () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'first';
    working.character.fields.personality = 'second';
    const adapter = new MemoryCardStateAdapter(base, { failAtApply: 2, failRollbackAtApply: 1 });
    const result = await commitWorkingCopy({ adapter, base, decisions: approveAll(base, working), working });
    expect(result.status).toBe('rolled-back');
    if (result.status === 'rolled-back') expect(result.rollbackError?.message).toContain('Fault adapter');
    expect((await adapter.read()).character.fields.description).toBe('first');
  });

  it('把写入后校验失败当作事务失败', async () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'ignored';
    const adapter: CardStateAdapter = {
      apply: async (_operation: StateOperation) => undefined,
      read: async () => klona(base),
    };
    const result = await commitWorkingCopy({ adapter, base, decisions: approveAll(base, working), working });
    expect(result.status).toBe('rolled-back');
    if (result.status === 'rolled-back') expect(result.error.message).toContain('校验失败');
  });

  it('规范化非Error的提交与回滚异常', async () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'first';
    working.character.fields.personality = 'second';
    let calls = 0;
    const adapter: CardStateAdapter & { beginRollback(): void } = {
      apply: async () => {
        calls += 1;
        if (calls === 2) throw 'commit-string';
        if (calls === 3) throw 'rollback-string';
      },
      beginRollback: () => undefined,
      read: async () => klona(base),
    };
    const result = await commitWorkingCopy({ adapter, base, decisions: approveAll(base, working), working });
    expect(result.status).toBe('rolled-back');
    if (result.status === 'rolled-back') {
      expect(result.error.message).toBe('commit-string');
      expect(result.rollbackError?.message).toBe('rollback-string');
    }
  });
});
