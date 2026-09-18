import { describe, expect, it, vi } from 'vitest';
import { readCharacterTavernState, readGlobalTavernState } from '../tavern/global-state-reader';
import { ProductionCardStateAdapter } from '../tavern/production-adapter';
import { FakeTavernBridge } from '../tavern/test-bridge';
import { CardWorkspaceLiveSource } from '../workspace/card-live-source';
import { LiveWorkspaceRepository } from '../workspace/live-repository';
import { createWorkspaceRunnerTools } from './tools';
import { createWorldbookRunnerTools } from './worldbook-tools';

async function fixture(global = false) {
  const bridge = new FakeTavernBridge();
  bridge.books.get('主世界书')![0].name = '开头（不能动）';
  bridge.books.set('资料库', structuredClone(bridge.books.get('主世界书')!));
  const mounted = new Set<string>();
  const adapter = new ProductionCardStateAdapter(bridge, current =>
    (global ? readGlobalTavernState : readCharacterTavernState)(current, mounted));
  const repository = new LiveWorkspaceRepository({ source: new CardWorkspaceLiveSource(adapter, {
    mountWorldbook: name => mounted.add(name),
    synchronizeMetadata: !global,
  }) });
  await repository.initialize();
  const tools = new Map([
    ...createWorkspaceRunnerTools(repository),
    ...createWorldbookRunnerTools(repository, bridge, {
      getBaseState: () => adapter.read(),
      onMount: name => { mounted.add(name); },
      onUnmount: name => { mounted.delete(name); },
    }),
  ].map(item => [item.name, item]));
  return { adapter, bridge, mounted, repository, tools };
}

describe('世界书工具实时宿主读写', () => {
  it.each([false, true])('创建和克隆后可以立即读写，global=%s', async global => {
    const { bridge, repository, tools } = await fixture(global);
    const manage = tools.get('manage_worldbook')!;
    await expect(manage.execute({ action: 'create', name: '新界面UI' }, 'create')).resolves.toMatchObject({ created: true });
    expect(bridge.books.has('新界面UI')).toBe(true);
    expect(await repository.list('/worldbooks/新界面UI/entries')).toEqual([]);
    await expect(manage.execute({ action: 'clone', name: '界面副本', source: '主世界书' }, 'clone')).resolves.toMatchObject({ cloned: true });
    expect(await repository.list('/worldbooks/界面副本/entries')).toHaveLength(2);
    const cloned = bridge.books.get('界面副本')!;
    expect(cloned[0].name).toBe('开头（不能动）');
    expect(cloned[0].extra).not.toEqual(bridge.books.get('主世界书')![0].extra);
    const written = await tools.get('write_file')!.execute({
      content: '---\nname: 新条目\n---\n新的内容', path: '/worldbooks/新界面UI/entries/new.md',
    }, 'new-entry') as { path: string };
    expect(written.path).toMatch(/\/entries\/0001-\d+-新条目\.md$/u);
    expect((await repository.read(written.path)).content).toContain('新的内容');
  });

  it('挂载后的删除立即刷新列表，批次中的旧编号继续定位同一条目', async () => {
    const { bridge, repository, tools } = await fixture();
    await tools.get('manage_worldbook')!.execute({ action: 'mount', name: '资料库' }, 'mount');
    const entries = await repository.list('/worldbooks/资料库/entries');
    await repository.remove(entries[0].path, 'delete-first');
    expect(await repository.list('/worldbooks/资料库/entries')).toHaveLength(1);
    await expect(repository.read(entries[0].path)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await repository.remove(entries[1].path, 'delete-second');
    expect(await repository.list('/worldbooks/资料库/entries')).toEqual([]);
    expect(bridge.books.get('资料库')).toEqual([]);
  });

  it('挂载已绑定世界书保留宿主身份，宿主外部改动会立即可见', async () => {
    const { bridge, repository, tools } = await fixture();
    const before = await repository.read('/worldbooks/主世界书/book.yaml');
    await tools.get('manage_worldbook')!.execute({ action: 'mount', name: '主世界书' }, 'mount');
    expect(await repository.read(before.path)).toEqual(before);
    bridge.books.get('主世界书')![0].content = '外部更新';
    const entries = await repository.list('/worldbooks/主世界书/entries');
    expect((await repository.read(entries[0].path)).content).toContain('外部更新');
    await expect(tools.get('search_worldbooks')!.execute({}, 'search')).resolves.toMatchObject({ returned: 2 });
  });

  it('复制世界书目录创建独立副本并保留源书和绑定', async () => {
    const { bridge, repository, tools } = await fixture();
    const before = structuredClone(bridge.books.get('主世界书'));
    await tools.get('copy_path')!.execute({ from: '/worldbooks/主世界书', to: '/worldbooks/复制书' }, 'copy-book');
    expect(bridge.books.get('主世界书')).toEqual(before);
    expect(bridge.bindings.primary).toBe('主世界书');
    const copied = bridge.books.get('复制书')!;
    expect(copied.map(entry => entry.content)).toEqual(before!.map(entry => entry.content));
    expect(copied[0].extra).not.toEqual(before![0].extra);
    expect(await repository.list('/worldbooks/复制书/entries')).toHaveLength(2);
    await expect(tools.get('search_worldbooks')!.execute({}, 'search')).resolves.toMatchObject({ returned: 3 });
  });

  it('写入失败会清理未提交投影，同一调用可以重试且查询保持可用', async () => {
    const { bridge, repository, tools } = await fixture();
    vi.spyOn(bridge, 'createWorldbook').mockRejectedValueOnce(new Error('宿主暂不可用'));
    const manage = tools.get('manage_worldbook')!;
    await expect(manage.execute({ action: 'create', name: '重试书' }, 'retry')).rejects.toThrow('宿主暂不可用');
    expect(repository.snapshot().some(file => file.path.startsWith('/worldbooks/重试书/'))).toBe(false);
    await expect(tools.get('search_worldbooks')!.execute({}, 'search')).resolves.toMatchObject({ returned: 2 });
    await expect(manage.execute({ action: 'create', name: '重试书' }, 'retry')).resolves.toMatchObject({ created: true });
    expect(bridge.books.has('重试书')).toBe(true);
  });

  it('重命名接受宿主补齐的默认字段，验证完成后才移除旧书', async () => {
    const { bridge, repository } = await fixture();
    const createEntries = bridge.createWorldbookEntries.bind(bridge);
    vi.spyOn(bridge, 'createWorldbookEntries').mockImplementationOnce(async (name, entries) =>
      createEntries(name, entries.map(entry => ({ ...entry, vendor_default: '宿主默认值' }))));
    await repository.move('/worldbooks/主世界书', '/worldbooks/改名书', 'rename');
    expect(repository.mutationResult('rename')).toMatchObject({ status: 'success' });
    expect(bridge.books.has('主世界书')).toBe(false);
    expect(bridge.books.get('改名书')![0].vendor_default).toBe('宿主默认值');
    expect(await repository.list('/worldbooks/改名书/entries')).toHaveLength(2);
  });

  it('重命名时宿主返回的条目内容不匹配会保留源书', async () => {
    const { bridge, repository } = await fixture();
    const before = structuredClone(bridge.books.get('主世界书'));
    const createEntries = bridge.createWorldbookEntries.bind(bridge);
    vi.spyOn(bridge, 'createWorldbookEntries').mockImplementationOnce(async (name, entries) =>
      createEntries(name, entries.map(entry => ({ ...entry, content: '损坏的内容' }))));
    await repository.move('/worldbooks/主世界书', '/worldbooks/错误副本', 'rename-bad');
    expect(repository.mutationResult('rename-bad')).toMatchObject({ status: 'partial_success' });
    expect(bridge.books.get('主世界书')).toEqual(before);
  });

  it('部分复制失败后仍能搜索和修改其他世界书', async () => {
    const { bridge, repository, tools } = await fixture();
    vi.spyOn(bridge, 'createWorldbookEntries').mockRejectedValueOnce(new Error('条目保存失败'));
    await tools.get('copy_path')!.execute({ from: '/worldbooks/主世界书', to: '/worldbooks/部分副本' }, 'copy-partial');
    expect(repository.mutationResult('copy-partial')).toMatchObject({ status: 'partial_success' });
    expect(bridge.books.get('主世界书')).toHaveLength(2);
    await expect(tools.get('search_worldbooks')!.execute({}, 'search')).resolves.toMatchObject({ returned: 3 });
    const [entry] = await repository.list('/worldbooks/主世界书/entries');
    await repository.remove(entry.path, 'delete');
    expect(bridge.books.get('主世界书')).toHaveLength(1);
  });
});
