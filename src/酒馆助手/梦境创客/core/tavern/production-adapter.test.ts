import { klona } from 'klona';
import { describe, expect, it } from 'vitest';
import { synchronizeCardAgentMetadata } from '../mapping/card-workspace-mapper';
import { applyRealtimeStateOperations } from '../transaction/realtime-apply';
import { diffCardStates, type StateOperation } from '../transaction/state-diff';
import type { TavernWorldbookEntry } from './bridge';
import { ProductionCardStateAdapter } from './production-adapter';
import { FakeTavernBridge } from './test-bridge';

function operation(path: string, before: unknown, after: unknown, kind: StateOperation['kind'] = 'modify'): StateOperation {
  return { after, before, highRisk: false, kind, label: path, path };
}

async function applyWorking(adapter: ProductionCardStateAdapter, base: Awaited<ReturnType<ProductionCardStateAdapter['read']>>, working: Awaited<ReturnType<ProductionCardStateAdapter['read']>>) {
  synchronizeCardAgentMetadata(working);
  const result = await applyRealtimeStateOperations(adapter, diffCardStates(base, working));
  if (result.error) throw result.error;
  return adapter.read();
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

  it('新条目正式UID会反馈给实时工作区', async () => {
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
    const state = await applyWorking(adapter, base, working);
    expect(state.worldbooks[0].entries.find(item => item.resourceId === 'temp-entry')?.uid).toBe(100);
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

  it('同一次实时写入先重命名世界书，再对新名称执行条目增改删和重排', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    const book = working.worldbooks[0];
    book.name = '重命名后的世界书';
    book.entries[0].content = '重命名后修改';
    book.entries.splice(1, 1);
    book.entries.unshift({
      ...klona(book.entries[0]),
      content: '重命名后新增',
      name: '新增条目',
      resourceId: 'rename-created-entry',
      uid: 'temp:rename-created-entry',
    });
    await applyWorking(adapter, base, working);
    expect(bridge.books.has('主世界书')).toBe(false);
    expect(bridge.books.get('重命名后的世界书')?.map(entry => entry.content)).toEqual([
      '重命名后新增',
      '重命名后修改',
    ]);
    expect(bridge.calls.indexOf('create-book:重命名后的世界书')).toBeLessThan(
      bridge.calls.indexOf('create-entries:重命名后的世界书'),
    );
  });

  it('实时创建未绑定世界书后同步元数据并采用写后回读', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    working.worldbooks.push({
      entries: [
        {
          ...klona(base.worldbooks[0].entries[0]),
          name: '新条目',
          resourceId: 'new-entry',
          uid: 'temp:new-entry',
        },
      ],
      name: '未绑定新书',
      resourceId: 'new-book',
      roundTripSafe: true,
      unknownFields: {},
      writable: true,
    });
    const state = await applyWorking(adapter, base, working);
    expect(bridge.bindings).toEqual({ additional: [], primary: '主世界书' });
    expect(bridge.raw?.data.extensions?.card_agent).toMatchObject({
      worldbooks: expect.arrayContaining([{ id: 'new-book', name: '未绑定新书' }]),
    });
    expect(state.worldbooks.find(book => book.resourceId === 'new-book')?.entries[0].uid).toBe(100);
  });

  it('创建并绑定世界书后同步元数据不会把刚写入的primary绑定覆盖回旧值', async () => {
    const bridge = new FakeTavernBridge();
    bridge.raw!.data.extensions!.world = '主世界书';
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    working.worldbooks.push({
      entries: [],
      name: '外部绑定新书',
      resourceId: 'external-bound-book',
      roundTripSafe: true,
      unknownFields: {},
      writable: true,
    });
    working.bindings.primary = '外部绑定新书';
    await applyWorking(adapter, base, working);
    expect(bridge.raw?.data.extensions?.world).toBe('外部绑定新书');
    expect(bridge.raw?.data.extensions?.card_agent).toMatchObject({
      worldbooks: expect.arrayContaining([{ id: 'external-bound-book', name: '外部绑定新书' }]),
    });
  });

  it('整书创建时接受酒馆补齐的隐式字段并以真实回读结果完成校验', async () => {
    const bridge = new FakeTavernBridge();
    bridge.createWorldbookEntries = async (name, entries) => {
      const book = bridge.books.get(name);
      if (!book) throw new Error('missing');
      const created = entries.map(entry => ({
        ...klona(entry),
        uid: bridge.nextUid++,
        vendor_default: '由酒馆补齐',
      })) as TavernWorldbookEntry[];
      book.push(...created);
      return klona(created);
    };
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    working.worldbooks.push({
      entries: [
        {
          ...klona(base.worldbooks[0].entries[0]),
          resourceId: 'implicit-entry',
          uid: 'temp:implicit-entry',
          unknownFields: {},
        },
      ],
      name: '带酒馆默认值的新书',
      resourceId: 'implicit-book',
      roundTripSafe: true,
      unknownFields: {},
      writable: true,
    });
    const state = await applyWorking(adapter, base, working);
    expect(state.worldbooks.find(book => book.resourceId === 'implicit-book')?.entries[0].unknownFields)
      .toMatchObject({ vendor_default: '由酒馆补齐' });
  });

  it('向现有世界书新增条目时接受酒馆补齐的隐式字段', async () => {
    const bridge = new FakeTavernBridge();
    bridge.createWorldbookEntries = async (name, entries) => {
      const book = bridge.books.get(name);
      if (!book) throw new Error('missing');
      const created = entries.map(entry => ({
        ...klona(entry),
        uid: bridge.nextUid++,
        vendor_default: '由酒馆补齐',
      })) as TavernWorldbookEntry[];
      book.push(...created);
      return klona(created);
    };
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    working.worldbooks[0].entries.push({
      ...klona(base.worldbooks[0].entries[0]),
      name: '带默认值的新条目',
      resourceId: 'implicit-existing-book-entry',
      uid: 'temp:implicit-existing-book-entry',
      unknownFields: {},
    });
    const state = await applyWorking(adapter, base, working);
    expect(
      state.worldbooks[0].entries.find(entry => entry.resourceId === 'implicit-existing-book-entry')?.unknownFields,
    ).toMatchObject({ vendor_default: '由酒馆补齐' });
  });

  it('修改既有条目时接受酒馆补齐的未知字段', async () => {
    const bridge = new FakeTavernBridge();
    const originalUpdate = bridge.updateWorldbook.bind(bridge);
    bridge.updateWorldbook = async (name, updater) => {
      await originalUpdate(name, updater);
      const entries = bridge.books.get(name)!;
      entries[0].vendor_default = '修改后由酒馆补齐';
      return klona(entries);
    };
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    working.worldbooks[0].entries[0].content = '确认写入的新正文';
    const state = await applyWorking(adapter, base, working);
    expect(state.worldbooks[0].entries[0]).toMatchObject({
      content: '确认写入的新正文',
      unknownFields: { vendor_default: '修改后由酒馆补齐', vendor_field: 'preserve' },
    });
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
    await expect(
      adapter.apply(
        operation(`/worldbooks/${book.resourceId.replace('/', '~1')}/metadata`, {}, {
          roundTripSafe: true,
          unknownFields: { local: true },
          writable: true,
        }),
      ),
    ).rejects.toThrow('内部元数据只读');
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

  it('按作用域整批写入正则和脚本，并阻止向已切换的预设提交', async () => {
    const bridge = new FakeTavernBridge();
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const regexes = klona(base.resources.regexes.character);
    regexes.regexes.push({
      destination: { display: true, prompt: true },
      enabled: true,
      findRegex: '/foo/u',
      id: 'new-regex',
      maxDepth: null,
      minDepth: null,
      name: '新正则',
      order: 100,
      replaceString: 'bar',
      resourceId: 'regex:new-regex',
      runOnEdit: false,
      source: { aiOutput: true, reasoning: false, slashCommand: false, userInput: false, worldInfo: false },
      substituteRegex: 'none',
      trimStrings: [],
      unknownFields: {},
      unknownPlacements: [],
    });
    await adapter.apply(operation('/resources/regexes/character', base.resources.regexes.character, regexes));
    expect(bridge.regexes.get('character')?.[0]).toMatchObject({ id: 'new-regex', scriptName: '新正则' });

    const changedPreset = klona(base.resources.scripts['preset-current']);
    changedPreset.targetId = 'preset:另一个预设';
    await expect(
      adapter.apply(operation('/resources/scripts/preset-current', base.resources.scripts['preset-current'], changedPreset)),
    ).rejects.toThrow('TARGET_SCOPE_CHANGED');
  });

  it('正则与脚本写入后以酒馆真实回读结果刷新缓存', async () => {
    const bridge = new FakeTavernBridge();
    bridge.regexes.set('character', [
      { disabled: false, findRegex: '/old/u', id: 'r1', placement: [1], replaceString: '', scriptName: '旧正则' },
    ]);
    const originalRegexWrite = bridge.replaceRawRegexes.bind(bridge);
    bridge.replaceRawRegexes = async (scope, regexes) => {
      await originalRegexWrite(scope, regexes);
      bridge.regexes.get(scope)![0].vendor_default = '酒馆正则默认值';
    };
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const regexScope = klona(base.resources.regexes.character);
    regexScope.regexes[0].name = '新正则';
    const normalizedRegex = await adapter.apply(
      operation('/resources/regexes/character', base.resources.regexes.character, regexScope),
    );
    expect(normalizedRegex?.after).toMatchObject({
      regexes: [expect.objectContaining({ name: '新正则', unknownFields: { vendor_default: '酒馆正则默认值' } })],
    });

    bridge.scripts.set('character', [
      {
        button: { buttons: [], enabled: false },
        content: 'old',
        data: {},
        enabled: true,
        export_with: { button: true, data: true },
        id: 's1',
        info: '',
        name: '脚本',
        type: 'script',
      },
    ]);
    const originalScriptWrite = bridge.replaceRawScriptTrees.bind(bridge);
    bridge.replaceRawScriptTrees = async (scope, trees) => {
      await originalScriptWrite(scope, trees);
      bridge.scripts.get(scope)![0].vendor_default = '酒馆脚本默认值';
    };
    const refreshed = await adapter.read();
    const scriptScope = klona(refreshed.resources.scripts.character);
    scriptScope.scripts[0].content = 'new';
    const normalizedScript = await adapter.apply(
      operation('/resources/scripts/character', refreshed.resources.scripts.character, scriptScope),
    );
    expect(normalizedScript?.after).toMatchObject({
      scripts: [expect.objectContaining({ content: 'new', unknownFields: { vendor_default: '酒馆脚本默认值' } })],
    });
  });

  it('一次实时操作内同一资源作用域无论多少语义字段都只写酒馆一次', async () => {
    const bridge = new FakeTavernBridge();
    bridge.regexes.set('character', [
      { disabled: false, findRegex: '/old/u', id: 'r1', placement: [1], replaceString: 'old', scriptName: '旧正则' },
    ]);
    const adapter = new ProductionCardStateAdapter(bridge);
    const base = await adapter.read();
    const working = klona(base);
    working.resources.regexes.character.regexes[0].name = '新正则';
    working.resources.regexes.character.regexes[0].findRegex = '/new/u';
    working.resources.regexes.character.regexes[0].replaceString = 'new';
    await applyWorking(adapter, base, working);
    expect(bridge.calls.filter(call => call === 'replace-regexes:character')).toHaveLength(1);
  });
});
