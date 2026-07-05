import default_config_raw from './default_config.json?raw';

export const SCRIPT_NAME = '预设适配器';
export const DEFAULT_SCRIPT_BUTTON_NAME = '打开预设适配器';

const PromptMatcherSchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1) }),
  z.object({ regex: z.string().min(1), flags: z.string().default('') }),
]);

const AdapterOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  type: z.enum(['between']).optional(),
  match: z
    .object({
      below: z.string(),
      above: z.string(),
    })
    .optional(),
  enable: z.array(PromptMatcherSchema).default([]),
  disable: z.array(PromptMatcherSchema).default([]),
}).superRefine((option, context) => {
  if (option.type === 'between' && !option.match) {
    context.addIssue({
      code: 'custom',
      path: ['match'],
      message: 'type 为 between 时必须填写 match.below 和 match.above',
    });
  }
});

const AdapterGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(''),
  mode: z.enum(['single', 'multiple']).default('single'),
  options: z.array(AdapterOptionSchema).default([]),
});

const AdapterConfigSchema = z
  .object({
    title: z.string().min(1).default(SCRIPT_NAME),
    description: z.string().default(''),
    script_button_name: z.string().min(1).default(DEFAULT_SCRIPT_BUTTON_NAME),
    groups: z.array(AdapterGroupSchema).default([]),
  })
  .prefault({});

const ScriptButtonConfigSchema = z
  .object({
    script_button_name: z.string().min(1).default(DEFAULT_SCRIPT_BUTTON_NAME),
  })
  .prefault({});

type PromptMatcher = z.infer<typeof PromptMatcherSchema>;
type AdapterConfig = z.infer<typeof AdapterConfigSchema>;
type AdapterGroup = AdapterConfig['groups'][number];
type AdapterOption = AdapterGroup['options'][number];
type ResolvedOption = Pick<AdapterOption, 'id' | 'label' | 'description' | 'enable' | 'disable'>;

export type OptionStatus = 'active' | 'inactive' | 'unmatched';

export type OptionView = {
  id: string;
  label: string;
  description: string;
  status: OptionStatus;
  status_icon_class: string;
  matched_summary: string;
  enable_indexes: number[];
  disable_indexes: number[];
};

export type GroupView = {
  id: string;
  label: string;
  description: string;
  mode: AdapterGroup['mode'];
  mode_label: string;
  layout: 'row' | 'grid';
  options: OptionView[];
};

type ReadConfigResult = {
  config: AdapterConfig;
  errors: string[];
};

type BuildGroupsResult = {
  groups: GroupView[];
  errors: string[];
};

type ResolveOptionsResult = {
  options: ResolvedOption[];
  errors: string[];
};

type LoadedState = {
  config: AdapterConfig;
  preset?: Preset;
  groups: GroupView[];
  errors: string[];
};

const EMPTY_CONFIG = AdapterConfigSchema.parse({});
const DEFAULT_CONFIG = AdapterConfigSchema.parse(JSON.parse(default_config_raw));

const STATUS_ICON_CLASSES: Record<OptionStatus, string> = {
  active: 'fa-solid fa-circle-check',
  inactive: 'fa-regular fa-circle',
  unmatched: 'fa-solid fa-triangle-exclamation',
};

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => `${issue.path.length === 0 ? '配置' : issue.path.join('.')}: ${issue.message}`)
    .join('\n');
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getScriptVariableScope() {
  return { type: 'script' as const, script_id: getScriptId() };
}

function cloneDefaultConfig(): AdapterConfig {
  return AdapterConfigSchema.parse(JSON.parse(default_config_raw));
}

function readScriptVariables(): Record<string, any> {
  const variables = getVariables(getScriptVariableScope());
  if (Object.keys(variables).length > 0) {
    return variables;
  }

  const default_config = cloneDefaultConfig();
  replaceVariables(default_config, getScriptVariableScope());
  console.info(`[${SCRIPT_NAME}] 脚本变量为空，已写入默认测试配置。`);
  return default_config;
}

function getDuplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
      continue;
    }
    seen.add(value);
  }
  return [...duplicated];
}

function getDuplicateIdErrors(config: AdapterConfig): string[] {
  const errors: string[] = [];
  for (const id of getDuplicateValues(config.groups.map(group => group.id))) {
    errors.push(`选项组 id 重复：${id}`);
  }
  for (const group of config.groups) {
    for (const id of getDuplicateValues(group.options.map(option => option.id))) {
      errors.push(`选项组“${group.label}”内的选项 id 重复：${id}`);
    }
  }
  return errors;
}

function readAdapterConfig(): ReadConfigResult {
  const variables = readScriptVariables();
  const result = AdapterConfigSchema.safeParse(variables);
  if (!result.success) {
    const message = formatZodError(result.error);
    console.warn(`[${SCRIPT_NAME}] 配置读取失败。`, result.error);
    return { config: EMPTY_CONFIG, errors: [`配置读取失败：\n${message}`] };
  }

  const errors = getDuplicateIdErrors(result.data);
  if (errors.length > 0) {
    console.warn(`[${SCRIPT_NAME}] 配置存在重复 id。`, errors);
  }
  return { config: result.data, errors };
}

export function readScriptButtonName(): string {
  const variables = readScriptVariables();
  const result = ScriptButtonConfigSchema.safeParse(variables);
  if (result.success) {
    return result.data.script_button_name;
  }

  console.warn(`[${SCRIPT_NAME}] 脚本按钮名读取失败，已使用默认按钮名。`, result.error);
  return DEFAULT_CONFIG.script_button_name;
}

function describeMatcher(matcher: PromptMatcher): string {
  if (typeof matcher === 'string') {
    return matcher;
  }
  if ('name' in matcher) {
    return matcher.name;
  }
  return `/${matcher.regex}/${matcher.flags}`;
}

function getMatcherIndexes(matcher: PromptMatcher, preset: Preset): { indexes: number[]; error?: string } {
  if (typeof matcher === 'string') {
    return {
      indexes: preset.prompts
        .map((prompt, index) => (prompt.name === matcher ? index : -1))
        .filter(index => index >= 0),
    };
  }

  if ('name' in matcher) {
    return {
      indexes: preset.prompts
        .map((prompt, index) => (prompt.name === matcher.name ? index : -1))
        .filter(index => index >= 0),
    };
  }

  try {
    const regex = new RegExp(matcher.regex, matcher.flags);
    return {
      indexes: preset.prompts
        .map((prompt, index) => {
          regex.lastIndex = 0;
          return regex.test(prompt.name) ? index : -1;
        })
        .filter(index => index >= 0),
    };
  } catch (error) {
    const message = `正则匹配器 ${describeMatcher(matcher)} 无效：${normalizeError(error)}`;
    console.warn(`[${SCRIPT_NAME}] ${message}`, error);
    return { indexes: [], error: message };
  }
}

function collectMatcherIndexes(matchers: PromptMatcher[], preset: Preset): { indexes: number[]; errors: string[] } {
  const indexes = new Set<number>();
  const errors: string[] = [];
  for (const matcher of matchers) {
    const result = getMatcherIndexes(matcher, preset);
    result.indexes.forEach(index => indexes.add(index));
    if (result.error) {
      errors.push(result.error);
    }
  }
  return { indexes: [...indexes], errors };
}

function getDesiredStates(enable_indexes: number[], disable_indexes: number[]): Map<number, boolean> {
  const desired_states = new Map<number, boolean>();
  disable_indexes.forEach(index => desired_states.set(index, false));
  enable_indexes.forEach(index => desired_states.set(index, true));
  return desired_states;
}

function resolveStatus(preset: Preset, enable_indexes: number[], disable_indexes: number[]): OptionStatus {
  const desired_states = getDesiredStates(enable_indexes, disable_indexes);
  if (desired_states.size === 0) {
    return 'unmatched';
  }

  let satisfied_count = 0;
  desired_states.forEach((enabled, index) => {
    if (preset.prompts[index]?.enabled === enabled) {
      satisfied_count += 1;
    }
  });

  if (satisfied_count === desired_states.size) {
    return 'active';
  }
  return 'inactive';
}

function summarizePromptNames(preset: Preset, indexes: number[]): string {
  const names = [...new Set(indexes.map(index => preset.prompts[index]?.name).filter((name): name is string => !!name))];
  if (names.length === 0) {
    return '无命中';
  }
  if (names.length <= 4) {
    return names.join('、');
  }
  return `${names.slice(0, 4).join('、')} 等 ${names.length} 项`;
}

function fillMatchPlaceholder(value: string, match: string): string {
  return value.split('{match}').join(match);
}

function fillMatcherPlaceholder(matcher: PromptMatcher, match: string): PromptMatcher {
  if (typeof matcher === 'string') {
    return fillMatchPlaceholder(matcher, match);
  }
  if ('name' in matcher) {
    return { name: fillMatchPlaceholder(matcher.name, match) };
  }
  return {
    regex: fillMatchPlaceholder(matcher.regex, match),
    flags: fillMatchPlaceholder(matcher.flags, match),
  };
}

function buildUnmatchedBetweenOption(option: AdapterOption, message: string): ResolvedOption {
  return {
    id: `${option.id}:between-unmatched`,
    label: option.label === '{match}' ? '未找到区间选项' : option.label,
    description: option.description ? `${option.description} ${message}` : message,
    enable: [],
    disable: [],
  };
}

function getRegexLiteralClosingSlash(value: string): number {
  if (!value.startsWith('/')) {
    return -1;
  }

  for (let index = value.length - 1; index > 0; index -= 1) {
    if (value[index] !== '/') {
      continue;
    }

    let backslash_count = 0;
    for (let cursor = index - 1; cursor > 0 && value[cursor] === '\\'; cursor -= 1) {
      backslash_count += 1;
    }
    if (backslash_count % 2 === 0) {
      return index;
    }
  }
  return -1;
}

function parseBetweenBoundaryMatcher(boundary: string): { test: (name: string) => boolean; error?: string } {
  const closing_slash = getRegexLiteralClosingSlash(boundary);
  if (closing_slash < 0) {
    return { test: name => name === boundary };
  }

  try {
    const regex = new RegExp(boundary.slice(1, closing_slash), boundary.slice(closing_slash + 1));
    return {
      test: name => {
        regex.lastIndex = 0;
        return regex.test(name);
      },
    };
  } catch (error) {
    return { test: () => false, error: `区间边界正则 ${boundary} 无效：${normalizeError(error)}` };
  }
}

function getPromptIndexByBoundary(preset: Preset, boundary: string, start_index = 0): { index: number; error?: string } {
  const matcher = parseBetweenBoundaryMatcher(boundary);
  if (matcher.error) {
    console.warn(`[${SCRIPT_NAME}] ${matcher.error}`);
    return { index: -1, error: matcher.error };
  }

  return {
    index: preset.prompts.findIndex((prompt, index) => index >= start_index && matcher.test(prompt.name)),
  };
}

function resolveBetweenOptions(option: AdapterOption, preset: Preset): ResolveOptionsResult {
  if (option.type !== 'between') {
    return { options: [option], errors: [] };
  }

  const match = option.match;
  if (!match) {
    return { options: [buildUnmatchedBetweenOption(option, '区间匹配配置缺少 match。')], errors: [] };
  }

  const below_result: { index: number; error?: string } =
    match.below === '' ? { index: -1 } : getPromptIndexByBoundary(preset, match.below);
  if (below_result.error) {
    return {
      options: [buildUnmatchedBetweenOption(option, below_result.error)],
      errors: [below_result.error],
    };
  }
  if (below_result.index < 0) {
    return { options: [buildUnmatchedBetweenOption(option, `未找到起始标记“${match.below}”。`)], errors: [] };
  }

  const above_result: { index: number; error?: string } =
    match.above === '' ? { index: preset.prompts.length } : getPromptIndexByBoundary(preset, match.above, below_result.index + 1);
  if (above_result.error) {
    return {
      options: [buildUnmatchedBetweenOption(option, above_result.error)],
      errors: [above_result.error],
    };
  }
  if (above_result.index < 0) {
    return {
      options: [buildUnmatchedBetweenOption(option, `未在“${match.below}”之后找到结束标记“${match.above}”。`)],
      errors: [],
    };
  }

  const matched_prompts = preset.prompts
    .map((prompt, index) => ({ prompt, index }))
    .slice(below_result.index + 1, above_result.index);
  if (matched_prompts.length === 0) {
    return { options: [buildUnmatchedBetweenOption(option, `“${match.below}”和“${match.above}”之间没有提示词。`)], errors: [] };
  }

  return {
    options: matched_prompts.map(({ prompt, index }) => ({
      id: `${fillMatchPlaceholder(option.id, prompt.name)}:${index}`,
      label: fillMatchPlaceholder(option.label, prompt.name),
      description: fillMatchPlaceholder(option.description, prompt.name),
      enable: option.enable.map(matcher => fillMatcherPlaceholder(matcher, prompt.name)),
      disable: option.disable.map(matcher => fillMatcherPlaceholder(matcher, prompt.name)),
    })),
    errors: [],
  };
}

function resolveGroupOptions(group: AdapterGroup, preset: Preset): ResolveOptionsResult {
  const options: ResolvedOption[] = [];
  const errors: string[] = [];
  for (const option of group.options) {
    const result = resolveBetweenOptions(option, preset);
    options.push(...result.options);
    errors.push(...result.errors);
  }
  return { options, errors };
}

function buildOptionView(option: ResolvedOption, preset: Preset): { view: OptionView; errors: string[] } {
  const enable_result = collectMatcherIndexes(option.enable, preset);
  const disable_result = collectMatcherIndexes(option.disable, preset);
  const matched_indexes = [...new Set([...enable_result.indexes, ...disable_result.indexes])];
  const status = resolveStatus(preset, enable_result.indexes, disable_result.indexes);

  return {
    view: {
      id: option.id,
      label: option.label,
      description: option.description,
      status,
      status_icon_class: STATUS_ICON_CLASSES[status],
      matched_summary: summarizePromptNames(preset, matched_indexes),
      enable_indexes: enable_result.indexes,
      disable_indexes: disable_result.indexes,
    },
    errors: [...enable_result.errors, ...disable_result.errors],
  };
}

function buildGroupViews(config: AdapterConfig, preset: Preset): BuildGroupsResult {
  const errors: string[] = [];
  const groups = config.groups.map(group => {
    const resolved_options = resolveGroupOptions(group, preset);
    errors.push(...resolved_options.errors);
    const options = resolved_options.options.map(option => {
      const result = buildOptionView(option, preset);
      errors.push(...result.errors);
      return result.view;
    });
    return {
      id: group.id,
      label: group.label,
      description: group.description,
      mode: group.mode,
      mode_label: group.mode === 'single' ? '单选' : '多选',
      layout: options.length <= 3 ? 'row' : 'grid',
      options,
    };
  });
  return { groups, errors };
}

export const usePresetAdapterStore = defineStore(SCRIPT_NAME, () => {
  const config = ref<AdapterConfig>(EMPTY_CONFIG);
  const title = ref(SCRIPT_NAME);
  const description = ref('');
  const loaded_preset_name = ref('');
  const groups = ref<GroupView[]>([]);
  const errors = ref<string[]>([]);
  const is_applying = ref(false);
  const has_blocking_errors = computed(() => errors.value.length > 0);

  function loadState(): LoadedState {
    const config_result = readAdapterConfig();
    config.value = config_result.config;
    title.value = config_result.config.title;
    description.value = config_result.config.description;
    loaded_preset_name.value = getLoadedPresetName();

    let preset: Preset | undefined;
    try {
      preset = getPreset('in_use');
    } catch (error) {
      const message = `读取当前使用预设失败：${normalizeError(error)}`;
      console.warn(`[${SCRIPT_NAME}] ${message}`, error);
      groups.value = [];
      errors.value = [...config_result.errors, message];
      return { config: config_result.config, groups: [], errors: errors.value };
    }

    const built = buildGroupViews(config_result.config, preset);
    groups.value = built.groups;
    errors.value = [...config_result.errors, ...built.errors];
    return { config: config_result.config, preset, groups: built.groups, errors: errors.value };
  }

  function refresh() {
    loadState();
  }

  async function applyOption(group_id: string, option_id: string): Promise<void> {
    if (is_applying.value) {
      return;
    }

    is_applying.value = true;
    try {
      const state = loadState();
      if (state.errors.length > 0 || !state.preset) {
        toastr.error('配置存在错误，未修改预设。', SCRIPT_NAME);
        return;
      }

      const group_config = state.config.groups.find(group => group.id === group_id);
      const group_view = state.groups.find(group => group.id === group_id);
      const option_view = group_view?.options.find(option => option.id === option_id);
      if (!group_config || !group_view || !option_view) {
        toastr.error('没有找到要应用的选项。', SCRIPT_NAME);
        return;
      }

      const target_states = new Map<number, boolean>();
      if (group_config.mode === 'single') {
        group_view.options
          .filter(option => option.id !== option_id)
          .forEach(option => option.enable_indexes.forEach(index => target_states.set(index, false)));
        option_view.disable_indexes.forEach(index => target_states.set(index, false));
        option_view.enable_indexes.forEach(index => target_states.set(index, true));
      } else if (option_view.status === 'active') {
        option_view.enable_indexes.forEach(index => target_states.set(index, false));
      } else {
        option_view.disable_indexes.forEach(index => target_states.set(index, false));
        option_view.enable_indexes.forEach(index => target_states.set(index, true));
      }

      if (target_states.size === 0) {
        toastr.warning('该选项没有命中任何提示词。', SCRIPT_NAME);
        return;
      }

      let changed = false;
      target_states.forEach((enabled, index) => {
        const prompt = state.preset?.prompts[index];
        if (prompt && prompt.enabled !== enabled) {
          prompt.enabled = enabled;
          changed = true;
        }
      });

      if (!changed) {
        toastr.info('当前预设已经符合该选项。', SCRIPT_NAME);
        refresh();
        return;
      }

      await replacePreset('in_use', state.preset, { render: 'immediate' });
      toastr.success(`已应用“${option_view.label}”。`, SCRIPT_NAME);
      refresh();
    } finally {
      is_applying.value = false;
    }
  }

  return {
    applyOption,
    description,
    errors,
    groups,
    has_blocking_errors,
    is_applying,
    loaded_preset_name,
    refresh,
    title,
  };
});
