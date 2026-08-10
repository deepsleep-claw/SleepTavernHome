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

  it('自动合并同一脚本文本中互不重叠的玩家与Agent行修改', () => {
    const base = transactionState();
    base.resources.scripts.character.scripts.push({
      button: { buttons: [], enabled: false },
      content: 'first\nmiddle\nlast',
      data: {},
      enabled: false,
      exportWith: { button: true, data: true },
      id: 's1',
      info: '',
      name: '脚本',
      resourceId: 'script:s1',
      unknownFields: {},
    });
    base.resources.scripts.character.trees = [{ scriptId: 's1', type: 'script' }];
    const working = klona(base);
    const current = klona(base);
    working.resources.scripts.character.scripts[0].content = 'agent first\nmiddle\nlast';
    current.resources.scripts.character.scripts[0].content = 'first\nmiddle\nplayer last';
    const preparation = prepareThreeWayMerge(base, working, current);
    const path = '/resources/scripts/character/items/script:s1/content';
    expect(preparation.conflicts).toEqual([]);
    expect(resolveMerge(current, preparation, { [path]: 'agent' }).state.resources.scripts.character.scripts[0].content).toBe(
      'agent first\nmiddle\nplayer last',
    );
  });
});
