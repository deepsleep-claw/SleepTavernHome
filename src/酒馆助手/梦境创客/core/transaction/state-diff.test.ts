import { klona } from 'klona';
import { describe, expect, it } from 'vitest';
import {
  applyStateOperation,
  applyStateOperations,
  diffCardStates,
  pathsOverlap,
  readStatePath,
  type StateOperation,
} from './state-diff';
import { transactionEntry, transactionState } from './test-fixture';

describe('semantic state diff', () => {
  it('生成语义级操作并可完整重放', () => {
    const base = transactionState();
    const working = klona(base);
    working.character.fields.description = 'new description';
    working.character.creator = '新作者';
    working.character.tags.push('new');
    working.character.greetings[0].content = 'edited greeting';
    working.character.greetings.reverse();
    working.worldbooks[0].name = '重命名世界书';
    working.worldbooks[0].unknownFields = { updated: true };
    working.worldbooks[0].entries[0].content = 'edited entry';
    working.worldbooks[0].entries.reverse();
    working.bindings.primary = '重命名世界书';
    const operations = diffCardStates(base, working);
    expect(operations.map(item => item.path)).toEqual(
      expect.arrayContaining([
        '/character/fields/description',
        '/character/greetings/greeting~11',
        '/character/greetings-order',
        '/worldbooks/book~11/name',
        '/worldbooks/book~11/metadata',
        '/worldbooks/book~11/entries/entry-1',
        '/worldbooks/book~11/entries-order',
        '/bindings/primary',
      ]),
    );
    expect(applyStateOperations(base, operations)).toEqual(working);
    expect(readStatePath(working, '/worldbooks/book~11/entries/entry-1')).toMatchObject({ content: 'edited entry' });
  });

  it('处理新增、删除、排序和未知路径', () => {
    const base = transactionState();
    const working = klona(base);
    working.character.greetings.splice(0, 1);
    working.character.greetings.unshift({ content: 'new', id: 'new-greeting', name: '新开场' });
    working.worldbooks[0].entries.splice(0, 1);
    working.worldbooks[0].entries.push(transactionEntry('new-entry', 9));
    working.worldbooks.push({
      entries: [],
      name: '新书',
      resourceId: 'new-book',
      roundTripSafe: true,
      unknownFields: {},
      writable: true,
    });
    const operations = diffCardStates(base, working);
    expect(operations.some(item => item.kind === 'create')).toBe(true);
    expect(operations.some(item => item.kind === 'delete')).toBe(true);
    expect(applyStateOperations(base, operations)).toEqual(working);
    expect(readStatePath(working, '/unknown')).toBeUndefined();
  });

  it('标记清空开场白、绑定、删书和大量删条目为高危', () => {
    const base = transactionState(20);
    const working = klona(base);
    working.character.greetings = [];
    working.worldbooks[0].entries.splice(0, 10);
    working.bindings.primary = null;
    const changes = diffCardStates(base, working);
    expect(changes.find(item => item.path === '/character/greetings-order')?.highRisk).toBe(true);
    expect(changes.find(item => item.path === '/bindings/primary')?.highRisk).toBe(true);
    expect(changes.filter(item => item.path.includes('/entries/') && item.kind === 'delete').every(item => item.highRisk)).toBe(
      true,
    );

    const deleteBook = klona(base);
    deleteBook.worldbooks = [];
    expect(diffCardStates(base, deleteBook).find(item => item.path === '/worldbooks/book~11')?.highRisk).toBe(true);
  });

  it('支持逆向应用和不存在资源的安全删除', () => {
    const state = transactionState();
    const modify: StateOperation = {
      after: 'new',
      before: 'base description',
      highRisk: false,
      kind: 'modify',
      label: '修改',
      path: '/character/fields/description',
    };
    applyStateOperation(state, modify);
    expect(state.character.fields.description).toBe('new');
    applyStateOperation(state, modify, 'before');
    expect(state.character.fields.description).toBe('base description');

    applyStateOperation(state, { ...modify, after: undefined, kind: 'delete', path: '/worldbooks/missing' });
    expect(state.worldbooks).toHaveLength(1);
  });

  it('判断相同、父子和无关路径的重叠关系', () => {
    expect(pathsOverlap('/a', '/a')).toBe(true);
    expect(pathsOverlap('/a', '/a/b')).toBe(true);
    expect(pathsOverlap('/a/b', '/a')).toBe(true);
    expect(pathsOverlap('/a', '/ab')).toBe(false);
  });

  it('读取并应用全部语义路径分支', () => {
    const state = transactionState();
    expect(readStatePath(state, '/character/creator')).toBe('作者');
    expect(readStatePath(state, '/character/version')).toBe('1');
    expect(readStatePath(state, '/character/tags')).toEqual(['tag']);
    expect(readStatePath(state, '/character/extensions/card_agent')).toMatchObject({ binding_id: 'binding-1' });
    expect(readStatePath(state, '/character/greetings-order')).toEqual(['greeting/1', 'greeting-2']);
    expect(readStatePath(state, '/character/greetings/greeting~11')).toMatchObject({ name: '初见' });
    expect(readStatePath(state, '/worldbooks/book~11/name')).toBe('主世界书');
    expect(readStatePath(state, '/worldbooks/book~11/metadata')).toMatchObject({ roundTripSafe: true });
    expect(readStatePath(state, '/worldbooks/book~11/entries-order')).toEqual(['entry-1', 'entry-2']);
    expect(readStatePath(state, '/worldbooks/missing/metadata')).toBeUndefined();
    expect(readStatePath(state, '/bindings/primary')).toBe('主世界书');

    const operations: StateOperation[] = [
      { after: { updated: true }, before: {}, highRisk: false, kind: 'modify', label: 'meta', path: '/character/extensions/card_agent' },
      { after: 'renamed', before: '主世界书', highRisk: false, kind: 'modify', label: 'name', path: '/worldbooks/book~11/name' },
      {
        after: { roundTripSafe: true, unknownFields: { changed: true }, writable: true },
        before: {},
        highRisk: false,
        kind: 'modify',
        label: 'metadata',
        path: '/worldbooks/book~11/metadata',
      },
      { after: ['entry-1'], before: [], highRisk: false, kind: 'reorder', label: 'order', path: '/worldbooks/book~11/entries-order' },
      { after: null, before: '主世界书', highRisk: true, kind: 'modify', label: 'binding', path: '/bindings/primary' },
      { after: 'ignored', before: undefined, highRisk: false, kind: 'modify', label: 'missing', path: '/worldbooks/missing/name' },
    ];
    operations.forEach(item => applyStateOperation(state, item));
    expect(state.character.extensions.card_agent).toEqual({ updated: true });
    expect(state.worldbooks[0]).toMatchObject({ name: 'renamed', unknownFields: { changed: true } });
    expect(state.worldbooks[0].entries.map(item => item.resourceId)).toEqual(['entry-1', 'entry-2']);
    expect(state.bindings.primary).toBeNull();
  });
});
