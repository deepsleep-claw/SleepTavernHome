import type { WorldbookEntryMetadata } from './worldbook_analysis';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export type PluginSourceContext = {
  chat_worldbook: string | null;
  character?: unknown;
  extension_settings?: unknown;
  extension_prompts?: unknown;
  baibai_ready?: boolean;
};

export function getEntryKeywords(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [
    ...new Set(
      values.flatMap(item => {
        const text = String(item ?? '').trim();
        return text
          ? [
              text,
              ...text
                .split(',')
                .map(part => part.trim())
                .filter(Boolean),
            ]
          : [];
      }),
    ),
  ];
}

export function getRubyOutputKeywords(context: PluginSourceContext): Set<string> {
  const character = record(context.character);
  const card = record(record(character?.data)?.extensions)?.RubyAnalyzer;
  const local = record(record(record(context.extension_settings)?.RubyAnalyzer)?.characterConfigs);
  const selected = card && typeof card === 'object' ? card : local?.[String(character?.avatar ?? '')];
  const config = record(selected);
  const presets = Array.isArray(config?.presets)
    ? config.presets.flatMap(item => (record(item) ? [record(item)!] : []))
    : [];
  const preset = presets.find(item => item.id === config?.activePresetId) ?? presets[0];
  const tasks = [preset?.startupTask, ...(Array.isArray(preset?.tasks) ? preset.tasks : [])];
  return new Set(
    tasks.flatMap(task => {
      const key = record(task)?.outputKey;
      return typeof key === 'string' && key.trim() ? [key.trim()] : [];
    }),
  );
}

export function identifyRubyEntries(metadata: Map<string, WorldbookEntryMetadata>, context: PluginSourceContext) {
  if (!context.chat_worldbook) return;
  const outputs = getRubyOutputKeywords(context);
  for (const entry of metadata.values()) {
    if (entry.world !== context.chat_worldbook || !entry.rule_context.keywords?.some(key => outputs.has(key))) continue;
    entry.rule_context.plugin = 'ruby';
    entry.rule_context.sources = [...new Set([...entry.rule_context.sources, 'chat'] as const)];
  }
}

export const BaiBaiInjectionSlots = [
  { provider: 'baibai_history', id: 'baibai_book_memory_history', name: '柏宝书历史摘要' },
  { provider: 'baibai_state', id: 'baibai_book_memory_state', name: '柏宝书当前状态' },
  { provider: 'baibai_recall', id: 'baibai_book_vector_recall', name: '柏宝书向量召回' },
  { provider: 'baibai_instructions', id: 'baibai_book_time_tag', name: '柏宝书时间标签指令' },
] as const;

export function getBaiBaiInjections(context: PluginSourceContext, providers: ReadonlySet<string>) {
  if (!context.baibai_ready) return [];
  const prompts = record(context.extension_prompts);
  return BaiBaiInjectionSlots.flatMap(definition => {
    if (!providers.has(definition.provider)) return [];
    const slot = record(prompts?.[definition.id]);
    if (
      !slot ||
      typeof slot.value !== 'string' ||
      !slot.value.trim() ||
      slot.position !== 1 ||
      typeof slot.filter === 'function'
    )
      return [];
    const role = Number(slot.role ?? 0);
    if (![0, 1, 2].includes(role)) return [];
    return [
      {
        ...definition,
        content: slot.value.trim(),
        depth: typeof slot.depth === 'number' && Number.isFinite(slot.depth) ? Math.max(0, slot.depth) : 0,
        role: (['system', 'user', 'assistant'] as const)[role],
      },
    ];
  });
}

export function readPluginSourceContext(): PluginSourceContext {
  const id = SillyTavern.characterId;
  const api = record((window.parent as unknown as Record<string, unknown>).STBaiBaiBook);
  return {
    chat_worldbook: getChatWorldbookName('current'),
    character: id == null ? undefined : SillyTavern.characters?.[Number(id)],
    extension_settings: SillyTavern.extensionSettings,
    extension_prompts: SillyTavern.extensionPrompts,
    baibai_ready: api?.apiVersion === 1 && typeof api.getSnapshot === 'function',
  };
}
