import { describe, expect, it } from 'vitest';
import { FakeTavernBridge } from './test-bridge';
import { readTavernState } from './state-reader';

describe('readTavernState', () => {
  it('读取全部角色字段、稳定ID、世界书未知字段与聊天', async () => {
    const bridge = new FakeTavernBridge();
    const result = await readTavernState(bridge);
    expect(result.warnings).toEqual([]);
    expect(result.state.character).toMatchObject({
      bindingId: 'binding-1',
      fields: {
        description: 'base description',
        personality: 'base personality',
        system_prompt: 'system',
      },
      greetings: [{ id: 'greeting/1', name: '初见' }, { id: 'greeting-2', name: '重逢' }],
    });
    expect(result.state.worldbooks[0].entries[0]).toMatchObject({
      resourceId: 'entry-1',
      unknownFields: { vendor_field: 'preserve' },
    });
    expect(result.state.worldbooks[0].entries[0].extra).toEqual({ keep: true });
    expect(result.state.chat).toEqual([
      { hidden: false, id: 0, name: '角色', role: 'assistant', text: 'hello' },
    ]);
    expect(result.state.resources.regexes['preset-current'].targetId).toBe('preset:默认预设');
  });

  it('读取三个作用域的正则和脚本，单项失败时只降级对应资源', async () => {
    const bridge = new FakeTavernBridge();
    bridge.regexes.set('character', [{ id: 'r1', placement: [1], scriptName: '角色正则' }]);
    bridge.scripts.set('global', [
      {
        button: { buttons: [], enabled: false },
        content: '',
        data: {},
        enabled: false,
        export_with: { button: true, data: true },
        id: 's1',
        info: '',
        name: '全局脚本',
        type: 'script',
      },
    ]);
    bridge.getRawScriptTrees = scope => {
      if (scope === 'preset-current') throw new Error('missing api');
      return structuredClone(bridge.scripts.get(scope) ?? []);
    };
    const result = await readTavernState(bridge);
    expect(result.state.resources.regexes.character.regexes[0].name).toBe('角色正则');
    expect(result.state.resources.scripts.global.scripts[0].name).toBe('全局脚本');
    expect(result.state.resources.scripts['preset-current']).toMatchObject({ available: false, scripts: [] });
    expect(result.warnings).toContain('当前预设脚本读取失败，已降级为不可用：missing api');
  });

  it('为旧角色卡生成确定性绑定、开场白与世界书ID', async () => {
    const bridge = new FakeTavernBridge();
    delete bridge.raw!.data.extensions!.card_agent;
    const first = await readTavernState(bridge);
    const second = await readTavernState(bridge);
    expect(second.state.character.bindingId).toBe(first.state.character.bindingId);
    expect(second.state.character.greetings.map(item => item.id)).toEqual(first.state.character.greetings.map(item => item.id));
    expect(second.state.worldbooks[0].resourceId).toBe(first.state.worldbooks[0].resourceId);
    expect(first.state.character.greetings.map(item => item.name)).toEqual(['默认开场白', '开场白 2']);
  });

  it('把无法读取的全局世界书降级为只读并给出警告', async () => {
    const bridge = new FakeTavernBridge();
    bridge.globalWorldbooks = ['损坏书'];
    const result = await readTavernState(bridge);
    expect(result.warnings).toEqual(['世界书“损坏书”无法无损读取，已降级为只读。']);
    expect(result.state.worldbooks.find(book => book.name === '损坏书')).toMatchObject({
      roundTripSafe: false,
      writable: false,
    });
  });

  it('拒绝群聊、未打开角色卡和读取失败', async () => {
    const group = new FakeTavernBridge();
    group.groupId = 'group-1';
    await expect(readTavernState(group)).rejects.toThrow('不支持群聊');

    const empty = new FakeTavernBridge();
    empty.raw = null;
    await expect(readTavernState(empty)).rejects.toThrow('请先打开');

    const missingRaw = new FakeTavernBridge();
    const original = missingRaw.getRawCharacter.bind(missingRaw);
    missingRaw.getRawCharacter = () => null;
    await expect(readTavernState(missingRaw)).rejects.toThrow('无法读取');
    missingRaw.getRawCharacter = original;
  });

  it('兼容V1字段、损坏的旧元数据和没有资源ID的条目', async () => {
    const bridge = new FakeTavernBridge();
    bridge.raw!.description = 'v1 description';
    bridge.raw!.personality = 'v1 personality';
    bridge.raw!.scenario = 'v1 scenario';
    bridge.raw!.mes_example = 'v1 example';
    bridge.raw!.creatorcomment = 'v1 notes';
    bridge.raw!.tags = ['v1'];
    bridge.raw!.first_mes = 'v1 greeting';
    bridge.raw!.data = {
      extensions: { card_agent: { greetings: [null, { id: 1, name: false }], worldbooks: [null] } },
      name: '角色',
    };
    const source = bridge.books.get('主世界书')![0];
    source.extra = { card_agent: { other: true } };
    const result = await readTavernState(bridge);
    expect(result.state.character.fields).toMatchObject({
      creator_notes: 'v1 notes',
      description: 'v1 description',
      mes_example: 'v1 example',
      personality: 'v1 personality',
      scenario: 'v1 scenario',
    });
    expect(result.state.character.greetings).toHaveLength(1);
    expect(result.state.worldbooks[0].entries[0]).toMatchObject({
      extra: { card_agent: { other: true } },
      resourceId: expect.stringContaining(':uid:1'),
    });
  });

  it('规范化非Error的世界书读取失败原因', async () => {
    const bridge = new FakeTavernBridge();
    bridge.getWorldbook = async () => Promise.reject('string failure');
    const result = await readTavernState(bridge);
    expect(result.state.worldbooks[0].unknownFields).toEqual({ mapping_error: 'string failure' });
  });
});
