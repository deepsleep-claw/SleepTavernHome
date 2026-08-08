import { klona } from 'klona';
import { describe, expect, it } from 'vitest';
import { defaultApprovals, prepareThreeWayMerge, resolveMerge } from './merge';
import { transactionState } from './test-fixture';

describe('three-way merge', () => {
  it('自动保留不重叠的用户手动编辑', () => {
    const base = transactionState();
    const working = klona(base);
    const current = klona(base);
    working.character.fields.description = 'agent description';
    current.character.fields.personality = 'user personality';
    const preparation = prepareThreeWayMerge(base, working, current);
    expect(preparation.conflicts).toEqual([]);
    const decisions = { '/character/fields/description': 'agent' as const };
    const result = resolveMerge(current, preparation, decisions).state;
    expect(result.character.fields).toMatchObject({
      description: 'agent description',
      personality: 'user personality',
    });
  });

  it('列出Base、Current和Agent三版冲突并允许逐项选择', () => {
    const base = transactionState();
    const working = klona(base);
    const current = klona(base);
    working.character.fields.description = 'agent';
    current.character.fields.description = 'manual';
    const preparation = prepareThreeWayMerge(base, working, current);
    expect(preparation.conflicts).toEqual([
      expect.objectContaining({ agent: 'agent', base: 'base description', current: 'manual' }),
    ]);
    expect(resolveMerge(current, preparation, { '/character/fields/description': 'current' }).state.character.fields.description).toBe(
      'manual',
    );
    expect(resolveMerge(current, preparation, { '/character/fields/description': 'agent' }).state.character.fields.description).toBe(
      'agent',
    );
  });

  it('相同的并发结果视为冗余，父级删除与子项编辑视为冲突', () => {
    const base = transactionState();
    const working = klona(base);
    const current = klona(base);
    working.character.fields.description = 'same';
    current.character.fields.description = 'same';
    expect(prepareThreeWayMerge(base, working, current).redundantPaths).toEqual(['/character/fields/description']);

    const deleting = klona(base);
    deleting.worldbooks = [];
    const editing = klona(base);
    editing.worldbooks[0].entries[0].content = 'manual edit';
    expect(prepareThreeWayMerge(base, deleting, editing).conflicts).toEqual([
      expect.objectContaining({ path: '/worldbooks/book~11' }),
    ]);
  });

  it('普通模式不预批，YOLO仅预批非高危干净修改', () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'agent';
    working.bindings.primary = null;
    const preparation = prepareThreeWayMerge(base, working, base);
    expect(defaultApprovals(preparation, 'normal')).toEqual({});
    expect(defaultApprovals(preparation, 'yolo')).toEqual({ '/character/fields/description': 'agent' });
  });
});
