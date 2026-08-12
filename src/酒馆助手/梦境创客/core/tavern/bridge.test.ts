import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGlobalTavernBridge, type RawCharacterData } from './bridge';
import { FakeTavernBridge } from './test-bridge';

const calls = {
  getCharacters: vi.fn(async () => undefined),
  getRequestHeaders: vi.fn(() => ({ 'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'csrf' })),
};

describe('global Tavern bridge', () => {
  beforeEach(() => {
    vi.stubGlobal('SillyTavern', { ...calls, groupId: '' });
    vi.stubGlobal('getCharacter', vi.fn(async () => ({})));
    vi.stubGlobal('getCurrentCharacterName', vi.fn(() => '角色'));
    vi.stubGlobal('getCurrentCharacterId', vi.fn(() => 'avatar.png'));
    vi.stubGlobal('getCharData', vi.fn(() => new FakeTavernBridge().raw));
    vi.stubGlobal('getCharWorldbookNames', vi.fn(() => ({ additional: [], primary: '主世界书' })));
    vi.stubGlobal('getChatWorldbookName', vi.fn(() => null));
    vi.stubGlobal('getGlobalWorldbookNames', vi.fn(() => []));
    vi.stubGlobal('getChatMessages', vi.fn(() => []));
    vi.stubGlobal('getWorldbook', vi.fn(async () => []));
    vi.stubGlobal('getWorldbookNames', vi.fn(() => ['主世界书', '新书']));
    vi.stubGlobal('createWorldbook', vi.fn(async () => true));
    vi.stubGlobal('deleteWorldbook', vi.fn(async () => true));
    vi.stubGlobal('createWorldbookEntries', vi.fn(async (_name, entries) => ({ new_entries: entries, worldbook: entries })));
    vi.stubGlobal('updateWorldbookWith', vi.fn(async (_name, updater) => updater([])));
    vi.stubGlobal('rebindCharWorldbooks', vi.fn(async () => undefined));
    vi.stubGlobal('setChatLorebook', vi.fn(async () => undefined));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('把酒馆现有角色、聊天与世界书接口收束为单一桥接层', async () => {
    const bridge = createGlobalTavernBridge();
    await bridge.ensureCharacterLoaded();
    expect(bridge.getCurrentCharacterName()).toBe('角色');
    expect(bridge.getCurrentCharacterId()).toBe('avatar.png');
    expect(bridge.getCharacterBindings()).toEqual({ additional: [], primary: '主世界书' });
    expect(bridge.getChatWorldbook()).toBeNull();
    expect(bridge.getGlobalWorldbooks()).toEqual([]);
    expect(bridge.getChatMessages()).toEqual([]);
    expect(bridge.getGroupId()).toBe('');
    expect(bridge.getRawCharacter()).toMatchObject({ name: '角色' });
    expect(await bridge.getWorldbook('主世界书')).toEqual([]);

    await bridge.createWorldbook('新书');
    await bridge.createWorldbookEntries('新书', [{ name: '条目' }]);
    await bridge.updateWorldbook('新书', entries => entries);
    await bridge.setCharacterBindings({ additional: ['新书'], primary: null });
    await bridge.setChatWorldbook('新书');
    await bridge.deleteWorldbook('新书');
    expect(vi.mocked(createWorldbook)).toHaveBeenCalledWith('新书');
    expect(vi.mocked(rebindCharWorldbooks)).toHaveBeenCalledWith('current', { additional: ['新书'] });
    expect(vi.mocked(setChatLorebook)).toHaveBeenCalledWith('新书');
  });

  it('用原始角色卡和显式字段构造FormData，且不手动发送Content-Type', async () => {
    const source = new FakeTavernBridge().raw!;
    source.data.alternate_greetings = ['g2', 'g3'];
    source.talkativeness = 0.75;
    source.fav = true;
    source.data.extensions = { ...source.data.extensions, world: '主世界书' };
    const bridge = createGlobalTavernBridge();
    await bridge.saveRawCharacter(source);
    const [_url, init] = vi.mocked(fetch).mock.calls[0];
    expect(_url).toBe('/api/characters/edit');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    const form = init?.body as FormData;
    expect(form.get('personality')).toBe('base personality');
    expect(form.getAll('alternate_greetings')).toEqual(['g2', 'g3']);
    expect(form.get('world')).toBeNull();
    expect(form.get('extensions')).toContain('主世界书');
    expect(form.get('json_data')).toContain('unknown_server_field');
    expect(calls.getCharacters).toHaveBeenCalled();
  });

  it('把主要世界书保存为外部名称绑定，并清除酒馆生成的同名内嵌镜像', async () => {
    const raw = new FakeTavernBridge().raw!;
    raw.data.extensions = { ...raw.data.extensions, world: null };
    raw.data.character_book = { entries: [], name: '新书' };
    vi.mocked(getCharData).mockReturnValue(raw as ReturnType<typeof getCharData>);
    vi.mocked(getCharWorldbookNames).mockReturnValue({ additional: [], primary: null });
    vi.mocked(getWorldbookNames).mockReturnValue(['新书']);

    const bridge = createGlobalTavernBridge();
    await bridge.setCharacterBindings({ additional: [], primary: '新书' });

    const form = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    const json = JSON.parse(String(form.get('json_data'))) as RawCharacterData;
    expect(form.get('world')).toBeNull();
    expect(json.data.extensions?.world).toBe('新书');
    expect(json.data.character_book).toBeUndefined();
    expect(rebindCharWorldbooks).not.toHaveBeenCalled();
  });

  it('报告角色写入、建书和删书失败', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('broken', { status: 500 }));
    const bridge = createGlobalTavernBridge();
    await expect(bridge.saveRawCharacter(new FakeTavernBridge().raw!)).rejects.toThrow('角色卡写入失败');

    vi.mocked(createWorldbook).mockResolvedValueOnce(false);
    await expect(bridge.createWorldbook('重复')).rejects.toThrow('已存在');
    vi.mocked(deleteWorldbook).mockResolvedValueOnce(false);
    await expect(bridge.deleteWorldbook('不存在')).rejects.toThrow('删除失败');
  });

  it('旧卡字段缺省时仍提交完整、明确的空值', async () => {
    const bridge = createGlobalTavernBridge();
    await bridge.saveRawCharacter({
      avatar: 'legacy.png',
      data: {},
      description: 'v1 description',
      first_mes: 'v1 greeting',
      name: '旧卡',
      personality: 'v1 personality',
      scenario: 'v1 scenario',
      tags: ['v1'],
    });
    const form = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(form.get('description')).toBe('v1 description');
    expect(form.get('personality')).toBe('v1 personality');
    expect(form.get('system_prompt')).toBe('');
    expect(form.get('tags')).toBe('v1');
    expect(form.getAll('alternate_greetings')).toEqual([]);
  });
});
