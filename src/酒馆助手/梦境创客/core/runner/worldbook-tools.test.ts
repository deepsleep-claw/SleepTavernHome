import { describe, expect, it } from 'vitest';
import { materializeCardWorkspace, projectCardWorkspace } from '../mapping/card-workspace-mapper';
import { transactionState } from '../transaction/test-fixture';
import { FakeTavernBridge } from '../tavern/test-bridge';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import { createWorldbookRunnerTools } from './worldbook-tools';

function fixture() {
  const base = transactionState();
  const bridge = new FakeTavernBridge();
  bridge.books.set('资料库', structuredClone(bridge.books.get('主世界书')!));
  const repository = new MemoryWorkspaceRepository({
    files: projectCardWorkspace(base),
    readonlyRoots: ['/context'],
  });
  const tools = new Map(
    createWorldbookRunnerTools(repository, bridge, { getBaseState: () => base }).map(item => [item.name, item]),
  );
  return { base, bridge, repository, tools };
}

describe('世界书Runner工具', () => {
  it('搜索名称而不读取正文', async () => {
    const { bridge, tools } = fixture();
    const result = await tools.get('search_worldbooks')!.execute({ query: '资料' }, 'search');
    expect(result).toMatchObject({ matches: [{ editable: false, name: '资料库' }], returned: 1 });
    expect(bridge.calls).not.toContain('get-worldbook:资料库');
  });

  it('把参考世界书挂载到worldbooks且不产生Diff', async () => {
    const { repository, tools } = fixture();
    await tools.get('manage_worldbook')!.execute({ action: 'mount', name: '资料库' }, 'mount');
    expect((await repository.list('/worldbooks/资料库')).map(item => item.name)).toEqual([
      'entries',
      'book.yaml',
    ]);
    expect((await repository.read('/worldbooks/资料库/book.yaml')).readonly).toBe(false);
    expect(repository.changes()).toEqual([]);
  });

  it('新建空世界书并拒绝重名', async () => {
    const { base, repository, tools } = fixture();
    await tools.get('manage_worldbook')!.execute({ action: 'create', name: '新版本' }, 'create');
    expect(await repository.list('/worldbooks/新版本/entries')).toEqual([]);
    expect(await repository.list('/worldbooks/新版本')).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'directory', name: 'entries' })]),
    );
    const result = materializeCardWorkspace(base, repository.snapshot()).state;
    expect(result.worldbooks.find(book => book.name === '新版本')).toMatchObject({ entries: [], writable: true });
    await expect(tools.get('manage_worldbook')!.execute({ action: 'create', name: '资料库' }, 'duplicate')).rejects.toThrow(
      '世界书名称已存在',
    );
  });

  it('复制完整世界书并分配独立资源身份', async () => {
    const { base, repository, tools } = fixture();
    await tools.get('manage_worldbook')!.execute({ action: 'clone', name: '主世界书 v2', source: '主世界书' }, 'clone');
    const books = materializeCardWorkspace(base, repository.snapshot()).state.worldbooks;
    const source = books.find(book => book.name === '主世界书')!;
    const cloned = books.find(book => book.name === '主世界书 v2')!;
    expect(cloned.entries).toHaveLength(source.entries.length);
    expect(cloned.entries.map(entry => entry.resourceId)).not.toEqual(source.entries.map(entry => entry.resourceId));
    expect(cloned.entries.map(entry => entry.unknownFields)).toEqual(source.entries.map(entry => entry.unknownFields));
  });

  it('绑定尚未挂载的现有世界书并支持增删附加绑定', async () => {
    const { base, repository, tools } = fixture();
    await tools.get('manage_worldbook')!.execute(
      {
        action: 'set_binding',
        binding: {
          addCharacterAdditional: ['资料库'],
          characterPrimary: '资料库',
          removeCharacterAdditional: ['旧资料'],
        },
      },
      'bind',
    );
    const result = materializeCardWorkspace(base, repository.snapshot()).state;
    expect(result.bindings).toMatchObject({ additional: ['资料库'], primary: '资料库' });
    expect(result.worldbooks.find(book => book.name === '资料库')).toMatchObject({ writable: true });
    expect(
      repository
        .changes()
        .some(change => change.path.startsWith('/worldbooks/') && change.path !== '/worldbooks/bindings.yaml'),
    ).toBe(false);
  });

  it('没有聊天控制器时拒绝聊天绑定且不留下部分修改', async () => {
    const { repository, tools } = fixture();
    await expect(
      tools.get('manage_worldbook')!.execute(
        { action: 'set_binding', binding: { characterPrimary: null, chat: { chatId: 'c01', worldbook: null } } },
        'chat-bind',
      ),
    ).rejects.toThrow('CHAT_WORKSPACE_UNAVAILABLE');
    expect(repository.changes()).toEqual([]);
  });
});
