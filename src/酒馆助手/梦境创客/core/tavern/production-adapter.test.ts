import { klona } from 'klona';
import { describe, expect, it } from 'vitest';
import { commitWorkingCopy } from '../transaction/commit';
import { diffCardStates, type StateOperation } from '../transaction/state-diff';
import { ProductionCardStateAdapter } from './production-adapter';
import { FakeTavernBridge } from './test-bridge';

function operation(path: string, before: unknown, after: unknown, kind: StateOperation['kind'] = 'modify'): StateOperation {
  return { after, before, highRisk: false, kind, label: path, path };
}

describe('ProductionCardStateAdapter', () => {
  it('角色字段写入保留不认识的原始字段', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    await adapter.read();
    await adapter.apply(operation('/character/fields/personality', 'base personality', 'new personality'));
    expect(bridge.raw?.data.personality).toBe('new personality');
    expect(bridge.raw?.personality).toBe('new personality');
    expect(bridge.raw?.unknown_server_field).toEqual({ keep: true });
    expect(bridge.raw?.data.extensions?.foreign).toEqual({ keep: true });
  });

  it('支持开场白、绑定和世界书条目的增改删与排序', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const greeting = base.character.greetings[0];
    await adapter.apply(operation(`/character/greetings/${greeting.id.replace('/', '~1')}`, greeting, { ...greeting, content: 'edited' }));
    expect(bridge.raw?.data.first_mes).toBe('edited');

    await adapter.apply(operation('/bindings/chat', null, '主世界书'));
    await adapter.apply(operation('/bindings/additional', [], ['主世界书']));
    expect(bridge.chatWorldbook).toBe('主世界书');
    expect(bridge.bindings.additional).toEqual(['主世界书']);

    const book = (await adapter.read()).worldbooks[0];
    const first = book.entries[0];
    await adapter.apply(operation(`/worldbooks/${book.resourceId.replace('/', '~1')}/entries/${first.resourceId}`, first, { ...first, content: 'changed' }));
    expect(bridge.books.get('主世界书')?.[0].content).toBe('changed');
    await adapter.apply(operation(`/worldbooks/${book.resourceId.replace('/', '~1')}/entries/${first.resourceId}`, first, undefined, 'delete'));
    expect(bridge.books.get('主世界书')).toHaveLength(1);
  });

  it('新条目正式UID会反馈给事务快照', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    working.worldbooks[0].entries.push({
      ...klona(working.worldbooks[0].entries[0]),
      content: 'new',
      name: 'new',
      resourceId: 'temp-entry',
      uid: 'temp:temp-entry',
    });
    const decisions = Object.fromEntries(diffCardStates(base, working).map(item => [item.path, 'agent' as const]));
    const result = await commitWorkingCopy({ adapter, base, decisions, working });
    expect(result.status).toBe('committed');
    if (result.status === 'committed') {
      expect(result.state.worldbooks[0].entries.find(item => item.resourceId === 'temp-entry')?.uid).toBe(100);
    }
  });

  it('重命名与整书增删保留条目资源ID', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const book = base.worldbooks[0];
    await adapter.apply(operation(`/worldbooks/${book.resourceId.replace('/', '~1')}/name`, book.name, '新书名'));
    expect(bridge.books.has('主世界书')).toBe(false);
    expect(bridge.books.get('新书名')?.[0].extra).toMatchObject({ card_agent: { resource_id: 'entry-1' } });

    const added = { ...klona(book), entries: [], name: '空书', resourceId: 'book-new' };
    await adapter.apply(operation('/worldbooks/book-new', undefined, added, 'create'));
    expect(bridge.books.has('空书')).toBe(true);
    await adapter.apply(operation('/worldbooks/book-new', added, undefined, 'delete'));
    expect(bridge.books.has('空书')).toBe(false);
  });

  it('覆盖角色元数据、空开场白和世界书元数据/排序分支', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    await adapter.apply(operation('/character/creator', base.character.creator, '新作者'));
    await adapter.apply(operation('/character/version', base.character.version, '2'));
    await adapter.apply(operation('/character/tags', base.character.tags, ['new-tag']));
    await adapter.apply(
      operation('/character/extensions/card_agent', base.character.extensions.card_agent, {
        binding_id: 'new-binding',
        greetings: [],
        worldbooks: [{ id: base.worldbooks[0].resourceId, name: base.worldbooks[0].name }],
      }),
    );
    for (const greeting of base.character.greetings) {
      await adapter.apply(
        operation(`/character/greetings/${greeting.id.replace('/', '~1')}`, greeting, undefined, 'delete'),
      );
    }
    await adapter.apply(operation('/character/greetings-order', base.character.greetings.map(item => item.id), [], 'reorder'));
    expect(bridge.raw?.data).toMatchObject({ character_version: '2', creator: '新作者', first_mes: '', tags: ['new-tag'] });

    const refreshed = await adapter.read();
    const book = refreshed.worldbooks[0];
    await adapter.apply(
      operation(`/worldbooks/${book.resourceId.replace('/', '~1')}/metadata`, {}, {
        roundTripSafe: true,
        unknownFields: { local: true },
        writable: true,
      }),
    );
    await adapter.apply(
      operation(
        `/worldbooks/${book.resourceId.replace('/', '~1')}/entries-order`,
        book.entries.map(item => item.resourceId),
        [book.entries[1].resourceId],
        'reorder',
      ),
    );
    expect(bridge.books.get('主世界书')?.map(item => item.uid)).toEqual([2, 1]);
  });

  it('整书创建包含条目时分配正式UID，并报告缺失资源和角色', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const added = {
      ...klona(base.worldbooks[0]),
      entries: [
        {
          ...klona(base.worldbooks[0].entries[0]),
          extra: undefined,
          resourceId: 'created-entry',
          uid: 'temp:created-entry' as const,
        },
      ],
      name: '有内容的新书',
      resourceId: 'created-book',
    };
    const normalized = await adapter.apply(operation('/worldbooks/created-book', undefined, added, 'create'));
    expect((normalized?.after as typeof added).entries[0].uid).toBe(100);
    expect(bridge.books.get('有内容的新书')?.[0].extra).toMatchObject({ card_agent: { resource_id: 'created-entry' } });
    await expect(adapter.apply(operation('/worldbooks/missing/name', 'x', 'y'))).rejects.toThrow('资源不存在');

    bridge.raw = null;
    await expect(adapter.apply(operation('/character/creator', '作者', 'x'))).rejects.toThrow('无法重新读取');
  });
});
