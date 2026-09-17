import { describe, expect, it } from 'vitest';
import { getBaiBaiInjections, getEntryKeywords, getRubyOutputKeywords } from './plugin_sources';
import { BuiltinWorldbookRules, createBuiltinWorldbookRule, WorldbookSettings } from './worldbook_settings';
import { compileWorldbookRules, getWorldbookPlacements, type WorldbookRuleFacts } from './worldbook_rules';

describe('插件专属来源', () => {
  const config = {
    activePresetId: 'active',
    presets: [
      { id: 'other', tasks: [{ outputKey: '其他方案输出' }] },
      {
        id: 'active',
        startupTask: { outputKey: '开局输出' },
        tasks: [{ outputKey: '  自定义输出  ', extraKeys: '人物名', selectiveKeys: ['条件'], enabled: false }],
      },
    ],
  };
  it('RUBY 读取生效方案输出键，与附加触发词分离，且保持配置只读', () => {
    const original = structuredClone(config);
    const context = {
      chat_worldbook: '聊天书',
      character: { avatar: 'a.png', data: { extensions: { RubyAnalyzer: config } } },
    };
    expect([...getRubyOutputKeywords(context)]).toEqual(['开局输出', '自定义输出']);
    expect(config).toEqual(original);
    const changed = structuredClone(context);
    changed.character.data.extensions.RubyAnalyzer.presets[1].tasks[0].outputKey = '新的输出键';
    expect(getRubyOutputKeywords(changed).has('新的输出键')).toBe(true);
    expect(getRubyOutputKeywords(changed).has('自定义输出')).toBe(false);
  });
  it('RUBY 兼容头像绑定配置，角色卡配置优先，全局暂存不作为当前角色配置', () => {
    const context = {
      chat_worldbook: '聊天书',
      character: { avatar: 'a.png' },
      extension_settings: { RubyAnalyzer: { characterConfigs: { 'a.png': config }, global: config } },
    };
    expect(getRubyOutputKeywords(context).has('开局输出')).toBe(true);
    expect(getRubyOutputKeywords({ ...context, character: { avatar: 'b.png' } }).size).toBe(0);
    expect(
      getRubyOutputKeywords({ ...context, character: { avatar: 'a.png', data: { extensions: { RubyAnalyzer: {} } } } })
        .size,
    ).toBe(0);
  });
  it('主关键词兼容数组与逗号文本，并保留完整键的精确匹配', () => {
    expect(getEntryKeywords(['分析, 角色', '分析', '', null])).toEqual(['分析, 角色', '分析', '角色']);
    expect(getEntryKeywords('输出')).toEqual(['输出']);
  });
  it('柏宝书只接入就绪插件的明确槽位及实际启用的注入', () => {
    const context = {
      chat_worldbook: null,
      baibai_ready: true,
      extension_prompts: {
        baibai_book_memory_state: { value: '当前状态', position: 1, depth: 2, role: 0 },
        baibai_book_vector_recall: { value: '回忆', position: 1, depth: 0, role: 0 },
        baibai_book_unrelated: { value: '其他内容', position: 1, depth: 0 },
        another_plugin: { value: '其他内容', position: 1, depth: 0 },
      },
    };
    expect(getBaiBaiInjections(context, new Set(['baibai_state']))).toEqual([
      {
        provider: 'baibai_state',
        id: 'baibai_book_memory_state',
        name: '柏宝书当前状态',
        content: '当前状态',
        depth: 2,
        role: 'system',
      },
    ]);
    expect(getBaiBaiInjections({ ...context, baibai_ready: false }, new Set(['baibai_state']))).toEqual([]);
    expect(
      getBaiBaiInjections(
        { ...context, extension_prompts: { baibai_book_memory_state: { value: '状态', position: -1 } } },
        new Set(['baibai_state']),
      ),
    ).toEqual([]);
  });
});

describe('内置规则模板与持久化列表', () => {
  it('已有列表的内容、顺序和删除状态在重复解析后保持不变', () => {
    const current = createBuiltinWorldbookRule('green');
    current.name = '我的规则';
    current.placeholder = '{{压缩相邻消息::自定义}}';
    current.enabled = false;
    const parsed = WorldbookSettings.parse({ rules: [current] });
    expect(parsed.rules).toEqual([current]);
    expect(WorldbookSettings.parse(parsed)).toEqual(parsed);
    expect(WorldbookSettings.parse({ rules: [] }).rules).toEqual([]);
    expect(WorldbookSettings.parse({ rules: [], constant: { enabled: true } }).rules).toEqual([]);
  });
  it('模板每次添加生成独立副本，不会修改模板或其他实例', () => {
    const first = createBuiltinWorldbookRule('ruby-output');
    const second = createBuiltinWorldbookRule('ruby-output');
    expect(first.id).not.toBe(second.id);
    first.name = '修改名称';
    first.sources.splice(0);
    expect(second.sources).toEqual(['chat']);
    expect(createBuiltinWorldbookRule('ruby-output').name).toBe('RUBY 分析输出');
    expect(BuiltinWorldbookRules).toHaveLength(9);
  });
  it('列表中的无效项不替换有效规则，未知来源和扩展字段可保留', () => {
    const rule = {
      ...createBuiltinWorldbookRule('green'),
      provider: 'future_provider',
      future_option: { enabled: true },
    };
    expect(WorldbookSettings.parse({ rules: [null, rule] }).rules).toEqual([rule]);
    expect(WorldbookSettings.parse({ rules: null }).rules).toEqual([]);
  });
  it('保留原位是终止匹配的动作，专属注入不被普通世界书规则接管', () => {
    const keep = createBuiltinWorldbookRule('blue-static');
    keep.action = 'keep';
    const facts: WorldbookRuleFacts = {
      world: '书',
      name: '条目',
      content: '正文',
      sources: ['character'],
      trigger: 'constant',
      has_dynamic_content: false,
      can_cache: false,
    };
    const ordinary = createBuiltinWorldbookRule('blue-static');
    const compiled = compileWorldbookRules([ordinary, keep]);
    expect(getWorldbookPlacements(facts, compiled, new Set([ordinary.placeholder]))).toEqual([
      { rule_id: keep.id, kind: 'keep', placeholder: keep.placeholder },
    ]);
    expect(
      getWorldbookPlacements(
        { ...facts, trigger: 'extension', plugin: 'baibai_state' },
        compileWorldbookRules([ordinary]),
        new Set([ordinary.placeholder]),
      ),
    ).toEqual([]);
  });
});
