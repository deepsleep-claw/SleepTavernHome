import { z } from 'zod';

export const SELECTION_PRESETS_KEY = 'dream_whale_selection_presets';

const SelectionReferenceSchema = z.object({
  group_id: z.string().min(1),
  option_id: z.string().min(1),
  prompt_name: z.string().min(1).optional(),
  group_label: z.string(),
  label: z.string(),
});

export type SelectionReference = z.infer<typeof SelectionReferenceSchema>;

export function selectionKey(reference: SelectionReference): string {
  return JSON.stringify([reference.group_id, reference.option_id, reference.prompt_name ?? null]);
}

const SelectionContentSchema = z.object({
  name: z.string().trim().min(1, '请输入选项组预设名称'),
  selections: z.array(SelectionReferenceSchema).superRefine((selections, context) => {
    const keys = new Set<string>();
    selections.forEach((selection, index) => {
      const key = selectionKey(selection);
      if (keys.has(key)) context.addIssue({ code: 'custom', path: [index], message: '存在重复选项' });
      keys.add(key);
    });
  }),
});

export const SelectionPresetSchema = SelectionContentSchema.extend({ id: z.string().min(1) });
export type SelectionPreset = z.infer<typeof SelectionPresetSchema>;
export type SelectionContent = z.infer<typeof SelectionContentSchema>;

export const SelectionLibrarySchema = z.object({
  version: z.literal(1).default(1),
  active_id: z.string().default(''),
  presets: z
    .array(SelectionPresetSchema)
    .default([])
    .superRefine((presets, context) => {
      for (const field of ['id', 'name'] as const) {
        const seen = new Set<string>();
        presets.forEach((preset, index) => {
          if (seen.has(preset[field])) {
            context.addIssue({
              code: 'custom',
              path: [index, field],
              message: `预设${field === 'id' ? '标识' : '名称'}重复`,
            });
          }
          seen.add(preset[field]);
        });
      }
    }),
});
export type SelectionLibrary = z.infer<typeof SelectionLibrarySchema>;

export const SelectionPresetFileSchema = z.object({
  type: z.literal('sleep-preset-adapter.option-preset'),
  version: z.literal(1),
  preset: SelectionContentSchema,
});

export function selectionPresetFile(preset: SelectionPreset) {
  return SelectionPresetFileSchema.parse({
    type: 'sleep-preset-adapter.option-preset',
    version: 1,
    preset,
  });
}

type SelectableOption = {
  selection: SelectionReference;
  selection_available?: boolean;
  status: 'active' | 'inactive' | 'unmatched';
  enable_indexes: number[];
  disable_indexes: number[];
  effects: string[];
};

export type SelectionGroup = {
  id: string;
  label: string;
  mode: 'single' | 'multiple';
  options: SelectableOption[];
  disable_group_indexes: number[];
  enable_group_indexes: number[];
};

export function captureSelections(groups: SelectionGroup[]): SelectionReference[] {
  return SelectionContentSchema.parse({
    name: '快照',
    selections: groups.flatMap(group =>
      group.options.filter(option => option.status === 'active').map(option => option.selection),
    ),
  }).selections;
}

export function resolveSelections(selections: SelectionReference[], groups: SelectionGroup[]) {
  const matched = new Map<string, SelectableOption[]>();
  const missing: string[] = [];
  const ignored_group_ids = new Set<string>();
  for (const reference of selections) {
    const group = groups.find(candidate => candidate.id === reference.group_id);
    const candidates =
      group?.options.filter(option => selectionKey(option.selection) === selectionKey(reference)) ?? [];
    if (
      candidates.length !== 1 ||
      candidates[0].status === 'unmatched' ||
      candidates[0].selection_available === false
    ) {
      const reason = candidates.length > 1 ? '存在同名选项，无法唯一匹配' : '当前预设中不可用';
      missing.push(
        `${reference.group_label || reference.group_id} / ${reference.label || reference.prompt_name || reference.option_id}：${reason}`,
      );
      continue;
    }
    const options = matched.get(reference.group_id) ?? [];
    options.push(candidates[0]);
    matched.set(reference.group_id, options);
  }
  for (const reference of selections) {
    if (!matched.has(reference.group_id)) ignored_group_ids.add(reference.group_id);
  }
  return { matched, missing, ignored_group_ids };
}

export function isSelectionModified(selections: SelectionReference[], groups: SelectionGroup[]): boolean {
  const { matched, ignored_group_ids } = resolveSelections(selections, groups);
  const expected = new Set([...matched.values()].flat().map(option => selectionKey(option.selection)));
  const actual = new Set(
    groups
      .filter(group => !ignored_group_ids.has(group.id))
      .flatMap(group =>
        group.options.filter(option => option.status === 'active').map(option => selectionKey(option.selection)),
      ),
  );
  return expected.size !== actual.size || [...expected].some(key => !actual.has(key));
}

export function buildSelectionPlan(selections: SelectionReference[], groups: SelectionGroup[]) {
  const resolved = resolveSelections(selections, groups);
  const prompt_states = new Map<number, boolean>();
  const effect_states = new Map<string, boolean>();
  const explicit_states = new Map<number, { enabled: boolean; group: string }>();
  const errors: string[] = [];
  if (selections.length > 0 && resolved.matched.size === 0) {
    return { ...resolved, prompt_states, effect_states, errors };
  }
  for (const group of groups) {
    if (resolved.ignored_group_ids.has(group.id)) continue;
    const selected = resolved.matched.get(group.id) ?? [];
    if (group.mode === 'single' && selected.length > 1) {
      errors.push(`“${group.label}”是单选组，但保存了多个启用选项。`);
      continue;
    }
    for (const option of group.options.filter(
      option => option.status !== 'unmatched' && option.selection_available !== false,
    )) {
      option.enable_indexes.forEach(index => prompt_states.set(index, false));
      option.effects.forEach(effect => effect_states.set(effect, false));
    }
    const group_states = new Map<number, boolean>();
    if (group.mode === 'single' && selected.length > 0) {
      group.disable_group_indexes.forEach(index => group_states.set(index, false));
      group.enable_group_indexes.forEach(index => group_states.set(index, true));
    }
    const selected_states = new Map<number, boolean>();
    for (const option of selected) {
      const option_states = new Map<number, boolean>();
      option.disable_indexes.forEach(index => option_states.set(index, false));
      option.enable_indexes.forEach(index => option_states.set(index, true));
      option_states.forEach((enabled, index) => {
        if (selected_states.has(index) && selected_states.get(index) !== enabled) {
          errors.push(`“${group.label}”的所选项要求同一提示词处于不同状态。`);
        }
        selected_states.set(index, enabled);
        group_states.set(index, enabled);
      });
    }
    group_states.forEach((enabled, index) => {
      const previous = explicit_states.get(index);
      if (previous && previous.enabled !== enabled) {
        errors.push(`“${previous.group}”与“${group.label}”要求同一提示词处于不同状态。`);
      }
      explicit_states.set(index, { enabled, group: group.label });
    });
  }
  // 显式选择优先于各组的关闭基线，共享的启用目标只应用一次。
  explicit_states.forEach(({ enabled }, index) => prompt_states.set(index, enabled));
  [...resolved.matched.values()]
    .flat()
    .forEach(option => option.effects.forEach(effect => effect_states.set(effect, true)));
  return { ...resolved, prompt_states, effect_states, errors: [...new Set(errors)] };
}
