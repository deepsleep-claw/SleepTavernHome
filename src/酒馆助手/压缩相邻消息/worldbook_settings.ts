import _ from 'lodash';
import { z } from 'zod';

export const WorldbookExtractionPositionOrder = [
  'before_character_definition',
  'after_character_definition',
  'before_example_messages',
  'after_example_messages',
  'before_author_note',
  'after_author_note',
  'at_depth',
] as const;
export const WorldbookSources = ['character', 'character_additional', 'chat', 'persona', 'global'] as const;
export type WorldbookSource = (typeof WorldbookSources)[number];

export const WorldbookRule = z.looseObject({
  id: z.string().default(() => crypto.randomUUID()),
  name: z.string().default('世界书提取规则'),
  enabled: z.boolean().default(true).catch(true),
  builtin_id: z.string().optional().catch(undefined),
  provider: z.string().default('worldbook').catch('worldbook'),
  action: z.enum(['extract', 'keep']).default('extract').catch('keep'),
  sources: z
    .array(z.enum(WorldbookSources))
    .default(() => [...WorldbookSources])
    .catch([...WorldbookSources])
    .transform(sources => [...new Set(sources)]),
  target: z.enum(['worldbook_name', 'entry_name', 'content']).default('entry_name').catch('entry_name'),
  pattern: z.string().default('').catch(''),
  trigger: z.enum(['all', 'constant', 'selective']).default('all').catch('all'),
  content: z.enum(['all', 'static', 'dynamic']).default('all').catch('all'),
  placeholder: z.string().default('').catch(''),
  aggressive_green_cache: z.boolean().default(false).catch(false),
});
export type WorldbookRule = z.infer<typeof WorldbookRule>;

export function createWorldbookRule(values: Partial<WorldbookRule> = {}): WorldbookRule {
  return WorldbookRule.parse(values);
}

export function getExtractionKeyword(placeholder: string): string {
  return placeholder.match(/^\{\{压缩相邻消息::(?:lora_custom::)?([\s\S]*?)\}\}$/)?.[1] ?? placeholder;
}

export function makeExtractionPlaceholder(keyword: string): string {
  const value = keyword.trim();
  return !value || value.startsWith('{{') ? value : `{{压缩相邻消息::${value}}}`;
}

export function getPlaceholderAliases(placeholder: string): string[] {
  if (!placeholder) return [];
  if (!/^\{\{压缩相邻消息::[\s\S]*\}\}$/.test(placeholder)) return [placeholder];
  const keyword = getExtractionKeyword(placeholder);
  return [makeExtractionPlaceholder(keyword), `{{压缩相邻消息::lora_custom::${keyword}}}`];
}

export const WorldbookProviderLabels: Record<string, string> = {
  worldbook: '世界书条目',
  ruby: 'RUBY 分析输出',
  baibai_history: '柏宝书历史摘要',
  baibai_state: '柏宝书当前状态',
  baibai_recall: '柏宝书向量召回',
  baibai_instructions: '柏宝书时间标签指令',
};

export const BuiltinWorldbookRules: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  values: Partial<WorldbookRule>;
}> = [
  {
    id: 'blue-static',
    name: '静态蓝灯提取规则',
    description: '常驻且不含动态内容的世界书条目。',
    values: { trigger: 'constant', content: 'static', placeholder: makeExtractionPlaceholder('lora_constant') },
  },
  {
    id: 'green',
    name: '绿灯提取规则',
    description: '关键词触发的世界书条目，可配置绿灯缓存。',
    values: { trigger: 'selective', placeholder: makeExtractionPlaceholder('lora_key') },
  },
  {
    id: 'blue-dynamic',
    name: '动态蓝灯提取规则',
    description: '常驻且包含动态内容的世界书条目。',
    values: { trigger: 'constant', content: 'dynamic', placeholder: makeExtractionPlaceholder('lora_key') },
  },
  {
    id: 'acu-memory',
    name: '黑科技世界书规则',
    description: '标题匹配 TavernDB-ACU 的世界书条目。',
    values: { pattern: '/TavernDB-ACU-(.*)/gi', placeholder: makeExtractionPlaceholder('sp_memory') },
  },
  {
    id: 'ruby-output',
    name: 'RUBY 分析输出',
    description: '当前聊天绑定书中，命中生效方案 outputKey 的条目。',
    values: { provider: 'ruby', sources: ['chat'], placeholder: makeExtractionPlaceholder('ruby_state') },
  },
  {
    id: 'baibai-history',
    name: '柏宝书历史摘要',
    description: '柏宝书实际注入的历史剧情摘要。',
    values: { provider: 'baibai_history', placeholder: makeExtractionPlaceholder('bbs_history') },
  },
  {
    id: 'baibai-state',
    name: '柏宝书当前状态',
    description: '柏宝书实际注入的时间、地点、人物及变量状态。',
    values: { provider: 'baibai_state', placeholder: makeExtractionPlaceholder('bbs_state') },
  },
  {
    id: 'baibai-recall',
    name: '柏宝书向量召回',
    description: '柏宝书本轮召回的相关记忆。',
    values: { provider: 'baibai_recall', placeholder: makeExtractionPlaceholder('bbs_recall') },
  },
  {
    id: 'baibai-instructions',
    name: '柏宝书时间标签指令',
    description: '默认保留原位置，也可改为提取到提取词。',
    values: {
      provider: 'baibai_instructions',
      action: 'keep',
      placeholder: makeExtractionPlaceholder('bbs_instructions'),
    },
  },
];

export function createBuiltinWorldbookRule(builtin_id: string, id: string = crypto.randomUUID()): WorldbookRule {
  const template = BuiltinWorldbookRules.find(value => value.id === builtin_id);
  if (!template) throw new Error('内置规则不存在');
  return createWorldbookRule({ ...structuredClone(template.values), name: template.name, builtin_id, id });
}

function createBaseRules(): WorldbookRule[] {
  return ['blue-static', 'green', 'blue-dynamic'].map(id => createBuiltinWorldbookRule(id, id));
}

export function createDefaultWorldbookRules(): WorldbookRule[] {
  return [...createBaseRules(), createBuiltinWorldbookRule('acu-memory', 'acu-memory')];
}

function migrateWorldbookSettings(input: unknown): unknown {
  if (!_.isPlainObject(input)) return input;
  const data = input as Record<string, any>;
  if ('rules' in data || !['constant', 'keyed', 'custom_routes', 'aggressive_green_cache'].some(key => key in data))
    return data;

  const [constant, green, dynamic] = createBaseRules();
  constant.enabled = typeof data.constant?.enabled === 'boolean' ? data.constant.enabled : true;
  constant.placeholder =
    typeof data.constant?.placeholder === 'string' ? data.constant.placeholder : constant.placeholder;
  const keyed_enabled = typeof data.keyed?.enabled === 'boolean' ? data.keyed.enabled : true;
  const keyed_placeholder = typeof data.keyed?.placeholder === 'string' ? data.keyed.placeholder : green.placeholder;
  green.aggressive_green_cache = data.aggressive_green_cache?.enabled === true;
  green.enabled = keyed_enabled || green.aggressive_green_cache;
  green.placeholder = keyed_enabled ? keyed_placeholder : '';
  dynamic.enabled = keyed_enabled;
  dynamic.placeholder = keyed_placeholder;
  const routes: WorldbookRule[] = (Array.isArray(data.custom_routes) ? data.custom_routes : []).flatMap(
    (route: any, index: number) => {
      if (
        typeof route?.title_regex !== 'string' ||
        !route.title_regex.trim() ||
        typeof route.tag !== 'string' ||
        !route.tag.trim()
      )
        return [];
      return [
        createWorldbookRule({
          id: `custom-${index}`,
          name: `自定义提取 ${index + 1}`,
          pattern: route.title_regex,
          placeholder: `{{压缩相邻消息::lora_custom::${route.tag.trim()}}}`,
        }),
      ];
    },
  );
  return { ...data, rules: [constant, green, dynamic, ...routes.reverse()] };
}

export const WorldbookSettings = z.preprocess(
  migrateWorldbookSettings,
  z
    .object({
      rules: z
        .preprocess(
          input =>
            Array.isArray(input)
              ? input.flatMap(value => {
                  const parsed = WorldbookRule.safeParse(value);
                  return parsed.success ? [parsed.data] : [];
                })
              : input,
          z.array(WorldbookRule).default(createDefaultWorldbookRules).catch([]),
        )
        .transform(rules => {
          const ids = new Set<string>();
          return rules.map(rule => {
            let id = rule.id || crypto.randomUUID();
            while (ids.has(id)) id = crypto.randomUUID();
            ids.add(id);
            return { ...rule, id };
          });
        }),
      position_order: z
        .array(z.enum(WorldbookExtractionPositionOrder))
        .default(() => [...WorldbookExtractionPositionOrder])
        .catch(() => [...WorldbookExtractionPositionOrder])
        .transform(order => [
          ...new Set(order),
          ...WorldbookExtractionPositionOrder.filter(position => !order.includes(position)),
        ]),
    })
    .prefault({}),
);
