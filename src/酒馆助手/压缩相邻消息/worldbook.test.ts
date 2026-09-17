import { describe, expect, it } from 'vitest';
import { applyWorldbookEntryMetadataAnalysis, type WorldbookEntryMetadata } from './worldbook_analysis';
import {
  groupWorldbookExtractions,
  replaceWorldbookPlaceholders,
  sortWorldbookExtractionItems,
} from './worldbook_output';
import {
  compileWorldbookRules,
  getWorldbookPlacements,
  planWorldbookExtraction,
  type WorldbookRuleFacts,
} from './worldbook_rules';
import { createWorldbookRule, makeExtractionPlaceholder, WorldbookSettings } from './worldbook_settings';
import { collectWorldbookSources } from './worldbook_sources';

const placeholder = makeExtractionPlaceholder;
const facts = (values: Partial<WorldbookRuleFacts> = {}): WorldbookRuleFacts => ({
  world: '设定',
  name: '条目',
  content: '正文',
  sources: ['character'],
  trigger: 'constant',
  has_dynamic_content: false,
  can_cache: false,
  ...values,
});
const rule = (values: Parameters<typeof createWorldbookRule>[0] = {}) =>
  createWorldbookRule({ placeholder: placeholder('target'), ...values });

describe('世界书规则规划', () => {
  it('下方规则优先，目标缺失时继续向上', () => {
    const compiled = compileWorldbookRules([
      rule({ id: 'top', placeholder: placeholder('top') }),
      rule({ id: 'bottom', placeholder: placeholder('bottom') }),
    ]);
    expect(
      getWorldbookPlacements(facts(), compiled, new Set([placeholder('top'), placeholder('bottom')]))[0].rule_id,
    ).toBe('bottom');
    expect(getWorldbookPlacements(facts(), compiled, new Set([placeholder('top')]))[0].rule_id).toBe('top');
  });

  it('来源为多选并集，并与触发、动态性和匹配字段共同筛选', () => {
    const compiled = compileWorldbookRules([
      rule({
        sources: ['chat', 'persona'],
        trigger: 'selective',
        content: 'dynamic',
        target: 'worldbook_name',
        pattern: '^设定$',
      }),
    ]);
    const matching = facts({ sources: ['character', 'chat'], trigger: 'selective', has_dynamic_content: true });
    const available = new Set([placeholder('target')]);
    expect(getWorldbookPlacements(matching, compiled, available)).toHaveLength(1);
    for (const values of [
      { sources: ['character'] as const },
      { trigger: 'constant' as const },
      { has_dynamic_content: false },
      { world: '其他' },
    ]) {
      expect(
        getWorldbookPlacements(
          { ...matching, ...values, sources: [...(values.sources ?? matching.sources)] },
          compiled,
          available,
        ),
      ).toEqual([]);
    }
  });

  it('正文匹配读取原始正文，带全局标记的正则可连续匹配', () => {
    const compiled = compileWorldbookRules([rule({ target: 'content', pattern: '/状态/gi' })]);
    const available = new Set([placeholder('target')]);
    expect(getWorldbookPlacements(facts({ content: '状态甲' }), compiled, available)).toHaveLength(1);
    expect(getWorldbookPlacements(facts({ content: '状态乙' }), compiled, available)).toHaveLength(1);
    expect(getWorldbookPlacements(facts({ name: '状态', content: '正文' }), compiled, available)).toEqual([]);
  });

  it('空正则全匹配，无效正则与关闭规则不参与规划', () => {
    const compiled = compileWorldbookRules([
      rule({ id: 'fallback' }),
      rule({ id: 'invalid', pattern: '/[/' }),
      rule({ id: 'disabled', enabled: false }),
    ]);
    expect(compiled.errors).toEqual([{ rule_id: 'invalid', message: '正则表达式无效' }]);
    expect(getWorldbookPlacements(facts(), compiled, new Set([placeholder('target')]))[0].rule_id).toBe('fallback');
    expect(
      getWorldbookPlacements(facts(), compileWorldbookRules([rule({ sources: [] })]), new Set([placeholder('target')])),
    ).toEqual([]);
  });

  it('缓存策略属于规则，且只接受具有缓存资格的非动态绿灯', () => {
    const compiled = compileWorldbookRules([
      rule({ id: 'cached', aggressive_green_cache: true }),
      rule({ id: 'ordinary', pattern: '^自定义$' }),
    ]);
    const green = facts({ trigger: 'selective', can_cache: true });
    expect(getWorldbookPlacements(green, compiled, new Set())[0].kind).toBe('cache');
    expect(
      getWorldbookPlacements({ ...green, name: '自定义' }, compiled, new Set([placeholder('target')]))[0],
    ).toMatchObject({ rule_id: 'ordinary', kind: 'placeholder' });
    expect(getWorldbookPlacements({ ...green, has_dynamic_content: true }, compiled, new Set())).toEqual([]);
    expect(getWorldbookPlacements({ ...green, trigger: 'constant' }, compiled, new Set())).toEqual([]);
    expect(getWorldbookPlacements({ ...green, can_cache: false }, compiled, new Set())).toEqual([]);
  });

  it('共享提取词统一排序，两种占位符写法共用结果', () => {
    const compiled = compileWorldbookRules([
      rule({ trigger: 'selective', placeholder: placeholder('lora_key') }),
      rule({ trigger: 'constant', content: 'dynamic', placeholder: '{{压缩相邻消息::lora_custom::lora_key}}' }),
    ]);
    const items = [
      {
        key: 'blue',
        facts: facts({ has_dynamic_content: true }),
        position: 'at_depth' as const,
        depth: 4,
        order: 20,
        index: 0,
      },
      {
        key: 'green',
        facts: facts({ trigger: 'selective' }),
        position: 'at_depth' as const,
        depth: 4,
        order: 10,
        index: 1,
      },
    ];
    const plan = planWorldbookExtraction(items, compiled, [placeholder('lora_key')]);
    const groups = groupWorldbookExtractions(items, plan);
    expect(groups.size).toBe(1);
    expect(
      sortWorldbookExtractionItems(groups.get(placeholder('lora_key'))!, {
        entry_processing: { worldbook: WorldbookSettings.parse({}) },
      }).map(item => item.key),
    ).toEqual(['green', 'blue']);
  });

  it('回填只扫描输入文本，不递归处理刚插入的内容', () => {
    const replacements = new Map([
      ['<A>', '<B>'],
      ['<B>', '正文'],
    ]);
    expect(replaceWorldbookPlaceholders('<A>|<B>', replacements)).toBe('<B>|正文');
  });

  it('蓝绿灯、动态性、目标存在性及缓存策略的组合保持独立', () => {
    for (const constant of [false, true])
      for (const dynamic of [false, true])
        for (const custom of [false, true])
          for (const custom_present of [false, true])
            for (const cache of [false, true])
              for (const constant_present of [false, true])
                for (const keyed_present of [false, true]) {
                  const settings = WorldbookSettings.parse({
                    aggressive_green_cache: { enabled: cache },
                    custom_routes: [{ title_regex: '/TavernDB-ACU-(.*)/gi', tag: 'sp_memory' }],
                  });
                  const compiled = compileWorldbookRules(settings.rules);
                  const available = new Set([
                    ...(custom_present ? [placeholder('sp_memory')] : []),
                    ...(constant_present ? [placeholder('lora_constant')] : []),
                    ...(keyed_present ? [placeholder('lora_key')] : []),
                  ]);
                  const match = getWorldbookPlacements(
                    facts({
                      name: custom ? 'TavernDB-ACU-memory' : '条目',
                      trigger: constant ? 'constant' : 'selective',
                      has_dynamic_content: dynamic,
                      can_cache: !constant && !dynamic,
                    }),
                    compiled,
                    available,
                  )[0];
                  const selected = match?.kind === 'cache' ? 'cache' : (match?.placeholder ?? 'origin');
                  const target = constant && !dynamic ? 'lora_constant' : 'lora_key';
                  const expected =
                    custom && custom_present
                      ? placeholder('sp_memory')
                      : cache && !constant && !dynamic
                        ? 'cache'
                        : available.has(placeholder(target))
                          ? placeholder(target)
                          : 'origin';
                  expect(selected).toBe(expected);
                }
  });
});

describe('世界书设置与来源', () => {
  it('转换设置保留提取开关、缓存、完整占位符和自定义优先级，并可重复解析', () => {
    const settings = WorldbookSettings.parse({
      constant: { enabled: false, placeholder: '[设定]' },
      keyed: { enabled: false },
      aggressive_green_cache: { enabled: true },
      custom_routes: [
        { title_regex: '^A', tag: 'first' },
        { title_regex: '^B', tag: 'second' },
        { title_regex: '', tag: 'empty' },
      ],
    });
    expect(settings.rules.map(value => value.id)).toEqual([
      'blue-static',
      'green',
      'blue-dynamic',
      'custom-1',
      'custom-0',
    ]);
    expect(settings.rules[0]).toMatchObject({ enabled: false, placeholder: '[设定]' });
    expect(settings.rules[1]).toMatchObject({ enabled: true, placeholder: '', aggressive_green_cache: true });
    expect(settings.rules[2].enabled).toBe(false);
    expect(WorldbookSettings.parse(settings)).toEqual(settings);
    expect(WorldbookSettings.parse({ rules: [] }).rules).toEqual([]);
    expect(WorldbookSettings.parse({}).rules).toHaveLength(4);
  });

  it('同一条目的多个来源合并，角色主书与可选书分别标记', () => {
    const primary = { world: '设定', uid: 1 };
    const extra = { world: '补充', uid: 1 };
    const sources = collectWorldbookSources(
      { globalLore: [primary], characterLore: [primary, extra], chatLore: [primary], personaLore: [extra] },
      { primary: '设定', additional: ['补充'] },
    );
    expect(new Set(sources.get('设定.1'))).toEqual(new Set(['global', 'character', 'chat']));
    expect(new Set(sources.get('补充.1'))).toEqual(new Set(['character_additional', 'persona']));
  });
});

describe('世界书内容分析', () => {
  function metadata(uid: number, name: string, content: string, constant = true): WorldbookEntryMetadata {
    return {
      key: `设定.${uid}`,
      world: '设定',
      uid,
      name,
      content,
      is_constant: constant,
      is_disabled: false,
      content_candidates: [content],
      split_getwi_parts: [],
      content_hash: content,
      has_dynamic_macro: true,
      rule_context: facts({ name, content, trigger: constant ? 'constant' : 'selective' }),
    };
  }

  it('身份宏视为静态，混合安全引用拆分成静态与动态处理单元', () => {
    const fixed = metadata(1, '设定', '{{user}} 与 <CHAR>');
    const dynamic = metadata(2, '状态', '{{get_chat_variable::hp}}');
    const combined = metadata(3, '汇总', "<%- await getwi('设定') -%>\n<%- await getwi('状态') -%>");
    const entries = new Map([fixed, dynamic, combined].map(value => [value.key, value]));
    const worlds = new Set(['设定']);
    applyWorldbookEntryMetadataAnalysis(fixed, entries, worlds);
    applyWorldbookEntryMetadataAnalysis(combined, entries, worlds);
    expect(fixed.has_dynamic_macro).toBe(false);
    expect(combined.split_getwi_parts.map(part => part.has_dynamic_content)).toEqual([false, true]);
  });

  it('绿灯引用、缺失引用与循环引用采用保守动态判定', () => {
    const fixed = metadata(1, '固定', '设定');
    const green = metadata(2, '绿灯', "<%- await getwi('固定') -%>", false);
    const missing = metadata(3, '缺失', "<%- await getwi('不存在') -%>");
    const loop = metadata(4, '循环', "<%- await getwi('循环') -%>");
    const entries = new Map([fixed, green, missing, loop].map(value => [value.key, value]));
    [green, missing, loop].forEach(value => {
      applyWorldbookEntryMetadataAnalysis(value, entries, new Set(['设定']));
      expect(value.has_dynamic_macro).toBe(true);
    });
  });
});
