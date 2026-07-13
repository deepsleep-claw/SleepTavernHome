import default_config_raw from './default_config.json?raw';

export const SCRIPT_NAME = '梦鲸思客设置';
export const DEFAULT_SCRIPT_BUTTON_NAME = '梦鲸思客设置';

const LEGACY_SCRIPT_NAME = '预设适配器';
const LEGACY_SCRIPT_BUTTON_NAME = '打开预设适配器';
const SQUASH_DEBUG_GLOBAL_KEY = '__dream_whale_squash_debug_api__';

const PromptMatcherSchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1) }),
  z.object({ regex: z.string().min(1), flags: z.string().default('') }),
]);

const AdapterOptionSchema = z
  .object({
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
  })
  .superRefine((option, context) => {
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

const SummaryHideRulesSchema = z
  .object({
    hide_first: z.boolean().default(false),
    hide_user: z.boolean().default(true),
    hide_assistant_system: z.boolean().default(true),
    hide_summary: z.boolean().default(false),
    auto_hide_after_manual: z.boolean().default(true),
  })
  .default({
    hide_first: false,
    hide_user: true,
    hide_assistant_system: true,
    hide_summary: false,
    auto_hide_after_manual: true,
  });

const SummarySettingsSchema = z
  .object({
    content_handling: z.enum(['direct', 'worldbook', 'first_message']).default('direct'),
    filter_html_code_blocks: z.boolean().default(true),
    manual_prompt_enabled: z.boolean().default(false),
    hide_rules: SummaryHideRulesSchema,
  })
  .default({
    content_handling: 'direct',
    filter_html_code_blocks: true,
    manual_prompt_enabled: false,
    hide_rules: SummaryHideRulesSchema.parse({}),
  });

const SummaryConfigSchema = z
  .object({
    generation: z
      .object({
        group_id: z.string().default(''),
        option_id: z.string().default(''),
        detect_regexes: z.array(z.string()).default([]),
      })
      .default({
        group_id: '',
        option_id: '',
        detect_regexes: [],
      }),
    settings: SummarySettingsSchema,
  })
  .default({
    generation: {
      group_id: '',
      option_id: '',
      detect_regexes: [],
    },
    settings: SummarySettingsSchema.parse({}),
  });

const AdapterConfigSchema = z
  .object({
    title: z.string().min(1).default(SCRIPT_NAME),
    description: z.string().default(''),
    script_button_name: z.string().min(1).default(DEFAULT_SCRIPT_BUTTON_NAME),
    summary: SummaryConfigSchema,
    groups: z.array(AdapterGroupSchema).default([]),
  })
  .prefault({});

const EXPORT_FILE_TYPE = 'sleep-preset-adapter.match-settings';
const EXPORT_FILE_VERSION = 1;

const ExportFileSchema = z.object({
  type: z.literal(EXPORT_FILE_TYPE),
  version: z.literal(EXPORT_FILE_VERSION),
  exported_at: z.string().optional(),
  title: z.string().optional(),
  items: z.array(
    z.object({
      group_id: z.string().min(1),
      match_id: z.string().min(1),
      name: z.string().min(1),
      prompt: z.object({ name: z.string().min(1) }).passthrough(),
    }),
  ),
});

const ScriptButtonConfigSchema = z
  .object({
    script_button_name: z.string().min(1).default(DEFAULT_SCRIPT_BUTTON_NAME),
  })
  .prefault({});

type PromptMatcher = z.infer<typeof PromptMatcherSchema>;
type AdapterConfig = z.infer<typeof AdapterConfigSchema>;
type AdapterGroup = AdapterConfig['groups'][number];
type AdapterOption = AdapterGroup['options'][number];
type ExportFile = z.infer<typeof ExportFileSchema>;
export type SummaryConfig = z.infer<typeof SummaryConfigSchema>;
export type SummarySettings = z.infer<typeof SummarySettingsSchema>;
export type SummaryHideRules = z.infer<typeof SummaryHideRulesSchema>;
export type SummaryContentHandling = SummarySettings['content_handling'];
type ExportSource = {
  group_id: string;
  match_id: string;
  prompt_index: number;
};
type ResolvedOption = Pick<AdapterOption, 'id' | 'label' | 'description' | 'enable' | 'disable'> & {
  export_source?: ExportSource;
};

export type OptionStatus = 'active' | 'inactive' | 'unmatched';

export type OptionView = {
  id: string;
  label: string;
  description: string;
  export_source?: ExportSource;
  exportable: boolean;
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

type TabId = 'preset' | 'summary' | 'debug';

export type SummaryMessageView = {
  message_id: number;
  exists: boolean;
  role?: ChatMessage['role'];
  is_hidden?: boolean;
  content_segments: string[];
};

export type SummaryFloorRow = {
  key: string;
  message_ids: number[];
  operation_label?: string;
  operation_target_hidden?: boolean;
  range: string;
  status: string;
  token_count: string;
  total?: boolean;
};

export type SummaryViewState = {
  has_chat: boolean;
  chat_id: string;
  total_message_count: number;
  unhidden_message_count: number;
  summary_count: number;
  summary_messages: SummaryMessageView[];
  floor_rows: SummaryFloorRow[];
};

export type SummaryGenerationStatus = {
  group_id: string;
  option_id: string;
  group_label: string;
  option_label: string;
  status_label: string;
  matched_summary: string;
  can_start: boolean;
  errors: string[];
};

type SquashDebugRecord = {
  id: string;
  created_at: string;
  title: string;
  summary: {
    error_count: number;
    failed: number;
    green_cache_insertions: number;
    loaded_total: number;
    total_rows: number;
    triggered_rows: number;
    wrapper_orphan: number;
    wrapper_paired: number;
  };
  state: Record<string, any>;
};

type SquashDebugApiCommon = {
  getRecords: () => SquashDebugRecord[];
  max_records: number;
  subscribe: (callback: (records: SquashDebugRecord[]) => void) => { stop: () => void };
};

type SquashDebugApiV1 = SquashDebugApiCommon & {
  clearRecords: () => void;
  getContent: (record_id: string, content_id: string) => string | undefined;
  storage_key: string;
  version: 1;
};

type SquashDebugApiV2 = SquashDebugApiCommon & {
  clearRecords: () => Promise<void>;
  database_name: string;
  getContent: (record_id: string, content_id: string) => Promise<string | undefined>;
  ready: Promise<void>;
  version: 2;
};

type SquashDebugApi = SquashDebugApiV1 | SquashDebugApiV2;

type ImportAction = 'create' | 'overwrite';

type ReviewPromptItem = {
  key: string;
  group_id: string;
  group_label: string;
  match_id: string;
  name: string;
  action: 'export' | ImportAction;
  action_label: string;
  preview: string;
  source: ExportFile['items'][number];
};

type ReviewFailedItem = {
  key: string;
  group_id: string;
  match_id: string;
  name: string;
  action_label: string;
  issue: string;
  preview: string;
  source: ExportFile['items'][number];
};

type ReviewPanel =
  | {
      kind: 'export';
      title: string;
      filename: string;
      file: ExportFile;
      items: ReviewPromptItem[];
    }
  | {
      kind: 'import';
      title: string;
      file: ExportFile;
      items: ReviewPromptItem[];
      failed_items: ReviewFailedItem[];
    };

type ImportPlan =
  | {
      action: ImportAction;
      index: number;
    }
  | {
      error: string;
    };

const EMPTY_CONFIG = AdapterConfigSchema.parse({});
const DEFAULT_CONFIG = AdapterConfigSchema.parse(JSON.parse(default_config_raw));

const STATUS_ICON_CLASSES: Record<OptionStatus, string> = {
  active: 'fa-solid fa-circle-check',
  inactive: 'fa-regular fa-circle',
  unmatched: 'fa-solid fa-triangle-exclamation',
};

const SUMMARY_VARIABLE_PATH = `${SCRIPT_NAME}.总结`;
const SUMMARY_VARIABLE_VERSION = 1;
const EMPTY_SUMMARY_STATE: SummaryViewState = {
  chat_id: '',
  floor_rows: [],
  has_chat: false,
  summary_count: 0,
  summary_messages: [],
  total_message_count: 0,
  unhidden_message_count: 0,
};
type SummaryChatVariables = {
  version: typeof SUMMARY_VARIABLE_VERSION;
  summary_message_ids: number[];
};

type CompiledSummaryRegex = {
  display: string;
  regex: RegExp;
};

const manual_summary_running = ref(false);
let manual_summary_task: Promise<void> | undefined;
let summary_token_refresh_serial = 0;
const summary_token_count_cache = new Map<string, number>();

function isHostGenerationInProgress(): boolean {
  try {
    const host_window = window.parent ?? window;
    const host_document = host_window.document;
    const generating = host_document.body?.getAttribute('data-generating');
    if (generating !== null && generating !== 'false') {
      return true;
    }

    return [...host_document.querySelectorAll<HTMLElement>('#mes_stop, .mes_stop')].some(element => {
      const style = host_window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });
  } catch {
    return false;
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => `${issue.path.length === 0 ? '配置' : issue.path.join('.')}: ${issue.message}`)
    .join('\n');
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getCurrentChatIdSafe(): string {
  try {
    return SillyTavern.getCurrentChatId?.() ?? '';
  } catch {
    return '';
  }
}

function readCurrentChatMessages(): ChatMessage[] {
  if (!getCurrentChatIdSafe()) {
    return [];
  }

  try {
    const last_message_id = getLastMessageId();
    if (last_message_id < 0) {
      return [];
    }
    return getChatMessages(`0-${last_message_id}`, { hide_state: 'all' });
  } catch (error) {
    console.warn(`[${SCRIPT_NAME}] 读取聊天楼层失败。`, error);
    return [];
  }
}

function normalizeSummaryMessageIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((id): id is number => Number.isInteger(id) && id >= 0))].sort(
    (lhs, rhs) => lhs - rhs,
  );
}

function normalizeSummaryChatVariables(value: unknown): SummaryChatVariables {
  if (!_.isPlainObject(value)) {
    return {
      version: SUMMARY_VARIABLE_VERSION,
      summary_message_ids: [],
    };
  }
  const variables = value as Record<string, unknown>;
  return {
    version: SUMMARY_VARIABLE_VERSION,
    summary_message_ids: normalizeSummaryMessageIds(variables.summary_message_ids),
  };
}

function readSummaryChatVariables(): SummaryChatVariables {
  try {
    const variables = getVariables({ type: 'chat' });
    return normalizeSummaryChatVariables(_.get(variables, SUMMARY_VARIABLE_PATH));
  } catch {
    return {
      version: SUMMARY_VARIABLE_VERSION,
      summary_message_ids: [],
    };
  }
}

function writeSummaryChatVariables(summary: SummaryChatVariables) {
  const variables = getVariables({ type: 'chat' });
  const normalized = normalizeSummaryChatVariables(summary);
  if (normalized.summary_message_ids.length === 0) {
    _.unset(variables, SUMMARY_VARIABLE_PATH);
  } else {
    _.set(variables, SUMMARY_VARIABLE_PATH, normalized);
  }
  replaceVariables(variables, { type: 'chat' });
}

function addSummaryMessageId(message_id: number): boolean {
  const current = readSummaryChatVariables();
  if (current.summary_message_ids.includes(message_id)) {
    return false;
  }
  writeSummaryChatVariables({
    version: SUMMARY_VARIABLE_VERSION,
    summary_message_ids: [...current.summary_message_ids, message_id],
  });
  return true;
}

function removeSummaryMessageId(message_id: number) {
  const current = readSummaryChatVariables();
  writeSummaryChatVariables({
    version: SUMMARY_VARIABLE_VERSION,
    summary_message_ids: current.summary_message_ids.filter(id => id !== message_id),
  });
}

function filterHtmlCodeBlocksForSummaryRender(content: string): string {
  return content.replace(/```[ \t]*html\b[^\r\n]*(?:\r?\n|$)[\s\S]*?(?:```|$)/gi, '');
}

function splitSummaryContentSegments(content: string, filter_html_code_blocks: boolean): string[] {
  const render_content = filter_html_code_blocks ? filterHtmlCodeBlocksForSummaryRender(content) : content;
  return render_content
    .split(/\n{2,}/)
    .map(segment => segment.trim())
    .filter(Boolean);
}

function getSummaryMessageContent(message: ChatMessage): string {
  return typeof message.message === 'string' ? message.message : '';
}

function getSummaryTokenCacheKey(message: ChatMessage): string {
  const content = getSummaryMessageContent(message);
  return `${message.message_id}:${content.length}:${content.slice(0, 128)}:${content.slice(-128)}`;
}

function getCachedSummaryTokenCount(message: ChatMessage): number | undefined {
  if (message.is_hidden) {
    return 0;
  }
  return summary_token_count_cache.get(getSummaryTokenCacheKey(message));
}

function getMessagesTokenCountText(messages: ChatMessage[]): string {
  let total = 0;
  for (const message of messages) {
    const token_count = getCachedSummaryTokenCount(message);
    if (token_count === undefined) {
      return '统计中';
    }
    total += token_count;
  }
  return String(total);
}

function getHiddenLabel(is_hidden: boolean): string {
  return is_hidden ? '隐藏' : '显示';
}

function getMessageRangeLabel(messages: ChatMessage[]): string {
  const first = messages[0].message_id;
  const last = messages[messages.length - 1].message_id;
  return first === last ? `第${first}层` : `第${first} - ${last}层`;
}

function buildFloorRangeRow(messages: ChatMessage[], row_index: number): SummaryFloorRow | undefined {
  if (messages.length === 0) {
    return undefined;
  }

  const hidden_states = [...new Set(messages.map(message => message.is_hidden))];
  const is_all_hidden = hidden_states.length === 1 && hidden_states[0];
  const message_ids = messages.map(message => message.message_id);
  if (hidden_states.length === 1) {
    return {
      key: `range-${row_index}`,
      message_ids,
      operation_label: is_all_hidden ? '显示' : '隐藏',
      operation_target_hidden: !is_all_hidden,
      range: getMessageRangeLabel(messages),
      status: getHiddenLabel(hidden_states[0]),
      token_count: getMessagesTokenCountText(messages),
    };
  }

  return {
    key: `range-${row_index}`,
    message_ids,
    operation_label: '隐藏',
    operation_target_hidden: true,
    range: getMessageRangeLabel(messages),
    status: '混合',
    token_count: getMessagesTokenCountText(messages),
  };
}

function buildSingleFloorRow(message: ChatMessage, kind: 'first' | 'summary'): SummaryFloorRow {
  const hidden_label = getHiddenLabel(message.is_hidden);
  return {
    key: `${kind}-${message.message_id}`,
    message_ids: [message.message_id],
    operation_label: message.is_hidden ? '显示' : '隐藏',
    operation_target_hidden: !message.is_hidden,
    range: `第${message.message_id}层`,
    status: kind === 'summary' ? `总结 ${hidden_label}` : `首层 ${hidden_label}`,
    token_count: getMessagesTokenCountText([message]),
  };
}

function buildFloorSummaryRows(messages: ChatMessage[], summary_ids: Set<number>): SummaryFloorRow[] {
  const rows: SummaryFloorRow[] = [];
  let pending_range: ChatMessage[] = [];

  const flushRange = () => {
    const row = buildFloorRangeRow(pending_range, rows.length);
    if (row) {
      rows.push(row);
    }
    pending_range = [];
  };

  messages.forEach(message => {
    if (message.message_id === 0) {
      flushRange();
      rows.push(buildSingleFloorRow(message, summary_ids.has(message.message_id) ? 'summary' : 'first'));
      return;
    }

    if (!summary_ids.has(message.message_id)) {
      pending_range.push(message);
      return;
    }

    flushRange();
    rows.push(buildSingleFloorRow(message, 'summary'));
  });
  flushRange();

  if (messages.length === 0) {
    return rows;
  }
  return [
    ...rows,
    {
      key: 'total',
      message_ids: [],
      range: '总计',
      status: '非隐藏楼层',
      token_count: getMessagesTokenCountText(messages),
      total: true,
    },
  ];
}

function buildSummaryViewState(messages: ChatMessage[] | undefined, filter_html_code_blocks: boolean): SummaryViewState {
  const chat_id = getCurrentChatIdSafe();
  if (!chat_id) {
    return { ...EMPTY_SUMMARY_STATE };
  }

  const chat_messages = messages ?? readCurrentChatMessages();
  const messages_by_id = new Map(chat_messages.map(message => [message.message_id, message] as const));
  const summary_ids = readSummaryChatVariables().summary_message_ids;
  const summary_id_set = new Set(summary_ids);
  return {
    chat_id,
    floor_rows: buildFloorSummaryRows(chat_messages, summary_id_set),
    has_chat: true,
    summary_count: summary_ids.length,
    summary_messages: summary_ids.map(message_id => {
      const message = messages_by_id.get(message_id);
      if (!message) {
        return {
          content_segments: [],
          exists: false,
          message_id,
        };
      }
      return {
        content_segments: splitSummaryContentSegments(message.message, filter_html_code_blocks),
        exists: true,
        is_hidden: message.is_hidden,
        message_id,
        role: message.role,
      };
    }),
    total_message_count: chat_messages.length,
    unhidden_message_count: chat_messages.filter(message => !message.is_hidden).length,
  };
}

async function refreshSummaryTokenCounts(messages: ChatMessage[], chat_id: string, serial: number) {
  const visible_messages = messages.filter(message => !message.is_hidden);
  const missing_messages = visible_messages.filter(
    message => !summary_token_count_cache.has(getSummaryTokenCacheKey(message)),
  );
  if (missing_messages.length === 0) {
    return;
  }

  const counts = await Promise.all(
    missing_messages.map(async message => ({
      key: getSummaryTokenCacheKey(message),
      token_count: await SillyTavern.getTokenCountAsync(getSummaryMessageContent(message), 0),
    })),
  );
  if (serial !== summary_token_refresh_serial || getCurrentChatIdSafe() !== chat_id) {
    return;
  }

  counts.forEach(({ key, token_count }) => summary_token_count_cache.set(key, token_count));
}

function shouldHideMessageBySummaryRules(
  message: ChatMessage,
  summary_ids: Set<number>,
  rules: SummaryHideRules,
): boolean {
  if (summary_ids.has(message.message_id)) {
    return rules.hide_summary;
  }
  if (message.message_id === 0) {
    return rules.hide_first;
  }
  if (message.role === 'user') {
    return rules.hide_user;
  }
  return rules.hide_assistant_system;
}

async function applySummaryHideRules(settings: SummarySettings, sync_unmatched: boolean): Promise<number> {
  const messages = readCurrentChatMessages();
  const summary_ids = new Set(readSummaryChatVariables().summary_message_ids);
  const updates = messages.flatMap(message => {
    const is_hidden = shouldHideMessageBySummaryRules(message, summary_ids, settings.hide_rules);
    if (sync_unmatched ? message.is_hidden !== is_hidden : is_hidden && !message.is_hidden) {
      return [{ message_id: message.message_id, is_hidden }];
    }
    return [];
  });

  if (updates.length > 0) {
    await setChatMessages(updates, { refresh: 'affected' });
  }
  return updates.length;
}

async function unhideAllChatMessages(): Promise<number> {
  const messages = readCurrentChatMessages();
  const updates = messages
    .filter(message => message.is_hidden)
    .map(message => ({
      message_id: message.message_id,
      is_hidden: false,
    }));
  if (updates.length > 0) {
    await setChatMessages(updates, { refresh: 'affected' });
  }
  return updates.length;
}

async function setSummaryFloorRowsHidden(message_ids: number[], is_hidden: boolean): Promise<number> {
  const message_id_set = new Set(message_ids);
  const updates = readCurrentChatMessages()
    .filter(message => message_id_set.has(message.message_id) && message.is_hidden !== is_hidden)
    .map(message => ({
      is_hidden,
      message_id: message.message_id,
    }));
  if (updates.length > 0) {
    await setChatMessages(updates, { refresh: 'affected' });
  }
  return updates.length;
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
  return {
    config: {
      ...result.data,
      script_button_name:
        result.data.script_button_name === LEGACY_SCRIPT_BUTTON_NAME
          ? DEFAULT_SCRIPT_BUTTON_NAME
          : result.data.script_button_name,
      title: result.data.title === LEGACY_SCRIPT_NAME ? SCRIPT_NAME : result.data.title,
    },
    errors,
  };
}

export function readScriptButtonName(): string {
  const variables = readScriptVariables();
  const result = ScriptButtonConfigSchema.safeParse(variables);
  if (result.success) {
    return result.data.script_button_name === LEGACY_SCRIPT_BUTTON_NAME
      ? DEFAULT_SCRIPT_BUTTON_NAME
      : result.data.script_button_name;
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
  const names = [
    ...new Set(indexes.map(index => preset.prompts[index]?.name).filter((name): name is string => !!name)),
  ];
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

function getPromptIndexByBoundary(
  preset: Preset,
  boundary: string,
  start_index = 0,
): { index: number; error?: string } {
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
  if (match.below !== '' && below_result.index < 0) {
    return { options: [buildUnmatchedBetweenOption(option, `未找到起始标记“${match.below}”。`)], errors: [] };
  }

  const above_result: { index: number; error?: string } =
    match.above === ''
      ? { index: preset.prompts.length }
      : getPromptIndexByBoundary(preset, match.above, below_result.index + 1);
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
    return {
      options: [buildUnmatchedBetweenOption(option, `“${match.below}”和“${match.above}”之间没有提示词。`)],
      errors: [],
    };
  }

  return {
    options: matched_prompts.map(({ prompt, index }) => ({
      id: `${fillMatchPlaceholder(option.id, prompt.name)}:${index}`,
      label: fillMatchPlaceholder(option.label, prompt.name),
      description: fillMatchPlaceholder(option.description, prompt.name),
      enable: option.enable.map(matcher => fillMatcherPlaceholder(matcher, prompt.name)),
      disable: option.disable.map(matcher => fillMatcherPlaceholder(matcher, prompt.name)),
      export_source: {
        group_id: '',
        match_id: option.id,
        prompt_index: index,
      },
    })),
    errors: [],
  };
}

function resolveGroupOptions(group: AdapterGroup, preset: Preset): ResolveOptionsResult {
  const options: ResolvedOption[] = [];
  const errors: string[] = [];
  for (const option of group.options) {
    const result = resolveBetweenOptions(option, preset);
    options.push(
      ...result.options.map(resolved_option => ({
        ...resolved_option,
        export_source: resolved_option.export_source
          ? { ...resolved_option.export_source, group_id: group.id }
          : undefined,
      })),
    );
    errors.push(...result.errors);
  }
  return { options, errors };
}

function getExportOptionKey(group_id: string, option_id: string): string {
  return `${group_id}\u0000${option_id}`;
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
      export_source: option.export_source,
      exportable: option.export_source !== undefined,
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
      layout: (options.length <= 3 ? 'row' : 'grid') as GroupView['layout'],
      options,
    };
  });
  return { groups, errors };
}

function buildOptionTargetStates(
  group_config: AdapterGroup,
  group_view: GroupView,
  option_view: OptionView,
  force_enable: boolean,
): Map<number, boolean> {
  const target_states = new Map<number, boolean>();
  if (group_config.mode === 'single') {
    group_view.options
      .filter(option => option.id !== option_view.id)
      .forEach(option => option.enable_indexes.forEach(index => target_states.set(index, false)));
    option_view.disable_indexes.forEach(index => target_states.set(index, false));
    option_view.enable_indexes.forEach(index => target_states.set(index, true));
    return target_states;
  }

  if (!force_enable && option_view.status === 'active') {
    option_view.enable_indexes.forEach(index => target_states.set(index, false));
    return target_states;
  }

  option_view.disable_indexes.forEach(index => target_states.set(index, false));
  option_view.enable_indexes.forEach(index => target_states.set(index, true));
  return target_states;
}

function applyPromptTargetStates(preset: Preset, target_states: Map<number, boolean>): boolean {
  let changed = false;
  target_states.forEach((enabled, index) => {
    const prompt = preset.prompts[index];
    if (prompt && prompt.enabled !== enabled) {
      prompt.enabled = enabled;
      changed = true;
    }
  });
  return changed;
}

function getGroupPromptStateSnapshot(preset: Preset, group_view: GroupView): Map<number, boolean> {
  const indexes = new Set<number>();
  group_view.options.forEach(option => {
    option.enable_indexes.forEach(index => indexes.add(index));
    option.disable_indexes.forEach(index => indexes.add(index));
  });
  return new Map([...indexes].map(index => [index, preset.prompts[index]?.enabled ?? false]));
}

async function restorePromptStateSnapshot(snapshot: Map<number, boolean>) {
  if (snapshot.size === 0) {
    return;
  }
  const preset = getPreset('in_use');
  const changed = applyPromptTargetStates(preset, snapshot);
  if (changed) {
    await replacePreset('in_use', preset, { render: 'immediate' });
  }
}

function buildSummaryGenerationStatus(config: AdapterConfig, groups: GroupView[]): SummaryGenerationStatus {
  const { group_id, option_id } = config.summary.generation;
  const group = groups.find(candidate => candidate.id === group_id);
  const option = findSummaryOption(group, option_id);
  const errors: string[] = [];
  if (!group_id) {
    errors.push('未配置总结使用的 group_id。');
  } else if (!group) {
    errors.push(`未找到总结使用设置组：${group_id}`);
  }
  if (!option_id) {
    errors.push('未配置总结使用的 option_id。');
  } else if (group && !option) {
    errors.push(`未在“${group.label}”中找到总结使用选项：${option_id}`);
  }
  if (option?.status === 'unmatched') {
    errors.push('总结使用选项没有命中任何提示词。');
  }

  return {
    can_start: errors.length === 0,
    errors,
    group_id,
    group_label: group?.label ?? group_id,
    matched_summary: option?.matched_summary ?? '',
    option_id,
    option_label: option?.label ?? option_id,
    status_label: option
      ? option.status === 'active'
        ? '已启用'
        : option.status === 'inactive'
          ? '未启用'
          : '未命中'
      : '未配置',
  };
}

function findSummaryOption(group: GroupView | undefined, option_id: string): OptionView | undefined {
  if (!group || !option_id) {
    return undefined;
  }
  return group.options.find(option => option.id === option_id || option.label === option_id);
}

function getExportFilename(title: string): string {
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${title || SCRIPT_NAME}-导出-${timestamp}.json`;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getPromptPreview(prompt: ExportFile['items'][number]['prompt']): string {
  const content = (prompt as { content?: unknown }).content;
  if (typeof content === 'string' && content.trim()) {
    return content;
  }
  return JSON.stringify(prompt, null, 2);
}

function getReviewItemKey(group_id: string, match_id: string, name: string, index: number): string {
  return `${group_id}\u0000${match_id}\u0000${name}\u0000${index}`;
}

function findImportMatchOption(config: AdapterConfig, group_id: string, match_id: string): AdapterOption | undefined {
  const group = config.groups.find(candidate => candidate.id === group_id);
  return group?.options.find(option => option.id === match_id && option.type === 'between' && option.match);
}

function getImportPlan(preset: Preset, match: NonNullable<AdapterOption['match']>, name: string): ImportPlan {
  const below_result: { index: number; error?: string } =
    match.below === '' ? { index: -1 } : getPromptIndexByBoundary(preset, match.below);
  if (below_result.error) {
    return { error: below_result.error };
  }
  if (match.below !== '' && below_result.index < 0) {
    return { error: `未找到导入起始标记“${match.below}”。` };
  }

  const start_index = below_result.index + 1;
  const above_result: { index: number; error?: string } =
    match.above === '' ? { index: preset.prompts.length } : getPromptIndexByBoundary(preset, match.above, start_index);
  if (above_result.error) {
    return { error: above_result.error };
  }
  if (above_result.index < 0) {
    return { error: `未在起始标记之后找到导入位置标记“${match.above}”。` };
  }

  const existing_index = preset.prompts.findIndex(
    (prompt, index) => index >= start_index && index < above_result.index && prompt.name === name,
  );
  if (existing_index >= 0) {
    return {
      action: 'overwrite',
      index: existing_index,
    };
  }
  return {
    action: 'create',
    index: above_result.index,
  };
}

function buildImportReview(
  file: ExportFile,
  config: AdapterConfig,
  preset: Preset,
): Pick<Extract<ReviewPanel, { kind: 'import' }>, 'items' | 'failed_items'> {
  const items: ReviewPromptItem[] = [];
  const failed_items: ReviewFailedItem[] = [];

  file.items.forEach((item, index) => {
    const key = getReviewItemKey(item.group_id, item.match_id, item.name, index);
    const preview = getPromptPreview(item.prompt);
    const group = config.groups.find(candidate => candidate.id === item.group_id);
    const match_option = group?.options.find(
      option => option.id === item.match_id && option.type === 'between' && option.match,
    );
    if (!group || !match_option?.match) {
      failed_items.push({
        key,
        group_id: item.group_id,
        match_id: item.match_id,
        name: item.name,
        action_label: '追加到底部',
        issue: '未找到对应的动态匹配配置',
        preview,
        source: item,
      });
      return;
    }

    const plan = getImportPlan(preset, match_option.match, item.name);
    if ('error' in plan) {
      failed_items.push({
        key,
        group_id: item.group_id,
        match_id: item.match_id,
        name: item.name,
        action_label: '追加到底部',
        issue: plan.error,
        preview,
        source: item,
      });
      return;
    }

    items.push({
      key,
      group_id: item.group_id,
      group_label: group.label,
      match_id: item.match_id,
      name: item.name,
      action: plan.action,
      action_label: plan.action === 'overwrite' ? '覆盖' : '新增',
      preview,
      source: item,
    });
  });

  return { failed_items, items };
}

function cloneImportedPrompt(item: ExportFile['items'][number]): Preset['prompts'][number] {
  const prompt = cloneJson(item.prompt) as Preset['prompts'][number];
  prompt.name = item.name;
  prompt.enabled = false;
  return prompt;
}

function applyImportItem(preset: Preset, config: AdapterConfig, item: ExportFile['items'][number]): ImportPlan {
  const match_option = findImportMatchOption(config, item.group_id, item.match_id);
  if (!match_option?.match) {
    return { error: '未找到对应的动态匹配配置' };
  }

  const plan = getImportPlan(preset, match_option.match, item.name);
  if ('error' in plan) {
    return plan;
  }

  const prompt = cloneImportedPrompt(item);
  if (plan.action === 'overwrite') {
    preset.prompts.splice(plan.index, 1, prompt);
  } else {
    preset.prompts.splice(plan.index, 0, prompt);
  }
  return plan;
}

function appendImportItem(preset: Preset, item: ExportFile['items'][number]) {
  preset.prompts.push(cloneImportedPrompt(item));
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.') || '文件'}: ${issue.message}`).join('\n');
}

function getSquashDebugApi(): SquashDebugApi | undefined {
  const host_window = (window.parent ?? window) as Window &
    Partial<Record<typeof SQUASH_DEBUG_GLOBAL_KEY, SquashDebugApi>>;
  return host_window[SQUASH_DEBUG_GLOBAL_KEY];
}

function getSummaryRegexLiteral(value: string): { flags: string; source: string } | undefined {
  const trimmed = value.trim();
  const closing_slash = getRegexLiteralClosingSlash(trimmed);
  if (closing_slash <= 0) {
    return undefined;
  }
  return {
    flags: trimmed.slice(closing_slash + 1),
    source: trimmed.slice(1, closing_slash),
  };
}

function compileSummaryRegexes(regexes: SummaryConfig['generation']['detect_regexes']): {
  compiled: CompiledSummaryRegex[];
  errors: string[];
} {
  const compiled: CompiledSummaryRegex[] = [];
  const errors: string[] = [];
  regexes.forEach((regex, index) => {
    const regex_text = regex.trim();
    if (!regex_text) {
      return;
    }

    const literal = getSummaryRegexLiteral(regex_text);
    const source = literal?.source ?? regex_text;
    const actual_flags = literal?.flags ?? '';
    const display = literal ? regex_text : `/${source}/`;
    try {
      compiled.push({
        display,
        regex: new RegExp(source, actual_flags),
      });
    } catch (error) {
      const message = `第 ${index + 1} 条总结识别正则无效：${display}：${normalizeError(error)}`;
      errors.push(message);
      console.warn(`[${SCRIPT_NAME}] ${message}`, error);
    }
  });
  return { compiled, errors };
}

function isCompiledSummaryRegexMatched(text: string, regexes: CompiledSummaryRegex[]): boolean {
  return regexes.some(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(text);
  });
}

function getSummaryErrorDetail(stage: string, error: unknown, context?: Record<string, unknown>): string {
  const details = [`阶段：${stage}`, `错误：${normalizeError(error)}`];
  if (context && Object.keys(context).length > 0) {
    details.push(`上下文：${JSON.stringify(context, null, 2)}`);
  }
  return details.join('\n');
}

function notifySummaryError(stage: string, error: unknown, context?: Record<string, unknown>) {
  const detail = getSummaryErrorDetail(stage, error, context);
  toastr.error(detail, SCRIPT_NAME, { extendedTimeOut: 30000, timeOut: 15000 });
  console.error(`[${SCRIPT_NAME}] ${stage}失败。`, { context, error });
}

async function confirmAction(message: string): Promise<boolean> {
  const confirmed = await SillyTavern.callGenericPopup(message, SillyTavern.POPUP_TYPE.CONFIRM);
  return confirmed === true || confirmed === SillyTavern.POPUP_RESULT.AFFIRMATIVE;
}

async function requestManualSummaryPrompt(settings: SummarySettings): Promise<string | undefined> {
  if (!settings.manual_prompt_enabled) {
    const confirmed = await confirmAction(
      '确认开始总结？当前预设会临时切换到配置的总结选项，并发送“开始总结”，生成结束后恢复。',
    );
    return confirmed ? '开始总结' : undefined;
  }

  const result = await SillyTavern.callGenericPopup('请输入本次总结需求。', SillyTavern.POPUP_TYPE.INPUT);
  if (result === undefined || result === false || result === SillyTavern.POPUP_RESULT.CANCELLED) {
    return undefined;
  }
  const prompt = String(result).trim();
  if (!prompt) {
    toastr.warning('总结需求不能为空。', SCRIPT_NAME);
    return undefined;
  }
  return prompt;
}

function buildSummaryWorldbookEntry(message_id: number, content: string): TypeFest.PartialDeep<WorldbookEntry> {
  return {
    content,
    effect: {
      cooldown: null,
      delay: null,
      sticky: null,
    },
    enabled: true,
    name: `[Dream]梦境思客总结 第 ${message_id} 层`,
    position: {
      depth: 0,
      order: message_id,
      role: 'system',
      type: 'after_character_definition',
    },
    probability: 100,
    recursion: {
      delay_until: null,
      prevent_incoming: false,
      prevent_outgoing: false,
    },
    strategy: {
      keys: [],
      keys_secondary: {
        keys: [],
        logic: 'and_any',
      },
      scan_depth: 'same_as_global',
      type: 'constant',
    },
  };
}

async function writeSummaryToChatWorldbook(message_id: number, content: string): Promise<boolean> {
  const worldbook_name = getChatWorldbookName('current');
  if (!worldbook_name) {
    toastr.error('当前聊天没有绑定世界书，无法放置总结。', SCRIPT_NAME);
    return false;
  }

  const entry = buildSummaryWorldbookEntry(message_id, content);
  const entry_name = entry.name!;
  const worldbook = await getWorldbook(worldbook_name);
  const existing = worldbook.find(candidate => candidate.name === entry_name);
  if (existing) {
    const confirmed = await confirmAction(`世界书“${worldbook_name}”中已存在“${entry_name}”。是否覆盖？`);
    if (!confirmed) {
      return false;
    }
    await updateWorldbookWith(
      worldbook_name,
      entries =>
        entries.map(candidate =>
          candidate.uid === existing.uid
            ? {
                ...candidate,
                ...entry,
                uid: candidate.uid,
              }
            : candidate,
        ),
      { render: 'immediate' },
    );
    return true;
  }

  await createWorldbookEntries(worldbook_name, [entry], { render: 'immediate' });
  return true;
}

async function appendSummaryToFirstMessage(message_id: number, content: string): Promise<boolean> {
  const first_message = getChatMessages(0)[0];
  if (!first_message) {
    toastr.error('未找到第 0 层，无法把总结放置于首层。', SCRIPT_NAME);
    return false;
  }

  const block = `\n\n---\n\n## [Dream]梦境思客总结 第 ${message_id} 层\n\n${content}`;
  await setChatMessages([{ message_id: 0, message: `${first_message.message}${block}` }], { refresh: 'affected' });
  return true;
}

async function processGeneratedSummaryMessage(message_id: number, content: string, settings: SummarySettings) {
  if (settings.content_handling === 'worldbook') {
    await writeSummaryToChatWorldbook(message_id, content);
  } else if (settings.content_handling === 'first_message') {
    await appendSummaryToFirstMessage(message_id, content);
  }

  if (settings.hide_rules.auto_hide_after_manual) {
    await applySummaryHideRules(settings, false);
  }
}

export function markGeneratedMessageAsSummaryIfMatched(message_id: number): boolean {
  const config_result = readAdapterConfig();
  const regexes = config_result.config.summary.generation.detect_regexes;
  if (regexes.length === 0 || !getCurrentChatIdSafe()) {
    return false;
  }

  const candidate_ids = [...new Set([message_id, message_id - 1, getLastMessageId()].filter(id => id >= 0))];
  const { compiled } = compileSummaryRegexes(regexes);
  try {
    for (const candidate_id of candidate_ids) {
      const candidate = getChatMessages(candidate_id)[0];
      if (candidate && isCompiledSummaryRegexMatched(candidate.message, compiled)) {
        return addSummaryMessageId(candidate.message_id);
      }
    }
  } catch (error) {
    console.warn(`[${SCRIPT_NAME}] 读取生成楼层失败，无法自动标记总结。`, error);
    return false;
  }
  return false;
}

export const usePresetAdapterStore = defineStore(SCRIPT_NAME, () => {
  const config = ref<AdapterConfig>(EMPTY_CONFIG);
  const title = ref(SCRIPT_NAME);
  const description = ref('');
  const active_tab = ref<TabId>('preset');
  const summary_settings = ref<SummarySettings>(cloneJson(EMPTY_CONFIG.summary.settings));
  const summary_state = ref<SummaryViewState>({ ...EMPTY_SUMMARY_STATE });
  const debug_available = ref(false);
  const debug_loading = ref(false);
  const debug_records = ref<SquashDebugRecord[]>([]);
  const selected_debug_record_id = ref('');
  const export_mode = ref(false);
  const review_panel = ref<ReviewPanel>();
  const selected_export_keys = ref<Set<string>>(new Set());
  const loaded_preset_name = ref('');
  const groups = ref<GroupView[]>([]);
  const errors = ref<string[]>([]);
  const is_applying = ref(false);
  const is_summary_running = manual_summary_running;
  const has_blocking_errors = computed(() => errors.value.length > 0);
  const selected_export_count = computed(() =>
    groups.value.reduce(
      (total, group) =>
        total +
        group.options.filter(
          option => option.exportable && selected_export_keys.value.has(getExportOptionKey(group.id, option.id)),
        ).length,
      0,
    ),
  );
  const selected_debug_record = computed(() =>
    debug_records.value.find(record => record.id === selected_debug_record_id.value),
  );
  const summary_generation_status = computed(() => buildSummaryGenerationStatus(config.value, groups.value));
  let debug_api: SquashDebugApi | undefined;
  let debug_subscription: { stop: () => void } | undefined;
  let debug_poll_timer: ReturnType<typeof window.setInterval> | undefined;
  let debug_attach_serial = 0;
  let summary_event_stops: EventOnReturn[] = [];

  function applyDebugRecords(records: SquashDebugRecord[]) {
    debug_records.value = records;
    if (!records.some(record => record.id === selected_debug_record_id.value)) {
      selected_debug_record_id.value = records[0]?.id ?? '';
    }
  }

  function attachDebugApi(api: SquashDebugApi | undefined) {
    if (api === debug_api) {
      return;
    }

    const attach_serial = ++debug_attach_serial;
    debug_subscription?.stop();
    debug_subscription = undefined;
    debug_api = api;
    debug_available.value = !!api;
    if (!api) {
      debug_loading.value = false;
      applyDebugRecords([]);
      if (active_tab.value === 'debug') {
        active_tab.value = 'preset';
      }
      return;
    }

    debug_loading.value = api.version === 2;
    debug_subscription = api.subscribe(applyDebugRecords);
    if (api.version === 2) {
      void (async () => {
        try {
          await api.ready;
          if (debug_api === api && debug_attach_serial === attach_serial) {
            applyDebugRecords(api.getRecords());
          }
        } catch (error) {
          console.warn(`[${SCRIPT_NAME}] 等待压缩 Debug 存储就绪失败。`, error);
        } finally {
          if (debug_api === api && debug_attach_serial === attach_serial) {
            debug_loading.value = false;
          }
        }
      })();
    }
  }

  function refreshDebugApi() {
    attachDebugApi(getSquashDebugApi());
  }

  function startDebugWatch() {
    refreshDebugApi();
    if (debug_poll_timer !== undefined) {
      return;
    }

    debug_poll_timer = window.setInterval(refreshDebugApi, 1000);
  }

  function stopDebugWatch() {
    if (debug_poll_timer !== undefined) {
      window.clearInterval(debug_poll_timer);
      debug_poll_timer = undefined;
    }
    attachDebugApi(undefined);
  }

  function setActiveTab(tab: TabId) {
    if (tab === 'debug' && !debug_available.value) {
      return;
    }
    active_tab.value = tab;
  }

  function refreshSummaryState() {
    const messages = readCurrentChatMessages();
    const state = buildSummaryViewState(messages, summary_settings.value.filter_html_code_blocks);
    summary_state.value = state;
    if (!state.has_chat) {
      return;
    }

    const serial = ++summary_token_refresh_serial;
    refreshSummaryTokenCounts(messages, state.chat_id, serial)
      .then(() => {
        if (serial === summary_token_refresh_serial && getCurrentChatIdSafe() === state.chat_id) {
          summary_state.value = buildSummaryViewState(
            readCurrentChatMessages(),
            summary_settings.value.filter_html_code_blocks,
          );
        }
      })
      .catch(error => {
        console.warn(`[${SCRIPT_NAME}] 统计楼层 Token 数失败。`, error);
      });
  }

  function saveSummarySettings(settings: SummarySettings) {
    const normalized_settings = SummarySettingsSchema.parse(settings);
    const variables = readScriptVariables();
    _.set(variables, 'summary.settings', normalized_settings);
    replaceVariables(variables, getScriptVariableScope());
    config.value = AdapterConfigSchema.parse({
      ...config.value,
      summary: {
        ...config.value.summary,
        settings: normalized_settings,
      },
    });
    summary_settings.value = cloneJson(normalized_settings);
    refreshSummaryState();
  }

  function setSummaryContentHandling(content_handling: SummaryContentHandling) {
    saveSummarySettings({
      ...summary_settings.value,
      content_handling,
    });
  }

  function setSummaryFilterHtmlCodeBlocks(filter_html_code_blocks: boolean) {
    saveSummarySettings({
      ...summary_settings.value,
      filter_html_code_blocks,
    });
  }

  function setSummaryManualPromptEnabled(manual_prompt_enabled: boolean) {
    saveSummarySettings({
      ...summary_settings.value,
      manual_prompt_enabled,
    });
  }

  function setSummaryHideRule(rule: keyof SummaryHideRules, value: boolean) {
    saveSummarySettings({
      ...summary_settings.value,
      hide_rules: {
        ...summary_settings.value.hide_rules,
        [rule]: value,
      },
    });
  }

  function addSummaryMessageIdFromInput(message_id: number): boolean {
    if (!Number.isInteger(message_id) || message_id < 0) {
      toastr.error('总结楼层必须是大于等于 0 的整数。', SCRIPT_NAME);
      return false;
    }

    const exists = readCurrentChatMessages().some(message => message.message_id === message_id);
    if (!exists) {
      toastr.error(`第 ${message_id} 层不存在，不能标记为总结层。`, SCRIPT_NAME);
      return false;
    }

    const changed = addSummaryMessageId(message_id);
    refreshSummaryState();
    if (changed) {
      toastr.success(`已标记第 ${message_id} 层为总结层。`, SCRIPT_NAME);
    } else {
      toastr.info(`第 ${message_id} 层已经是总结层。`, SCRIPT_NAME);
    }
    return changed;
  }

  function deleteSummaryMessageId(message_id: number) {
    removeSummaryMessageId(message_id);
    refreshSummaryState();
    toastr.success(`已移除第 ${message_id} 层的总结标记。`, SCRIPT_NAME);
  }

  async function applySummaryHideOnly() {
    if (is_applying.value) {
      return;
    }

    is_applying.value = true;
    try {
      const changed_count = await applySummaryHideRules(summary_settings.value, false);
      refreshSummaryState();
      toastr.success(`已隐藏 ${changed_count} 个命中楼层。`, SCRIPT_NAME);
    } finally {
      is_applying.value = false;
    }
  }

  async function syncSummaryHideRules() {
    if (is_applying.value) {
      return;
    }

    is_applying.value = true;
    try {
      const changed_count = await applySummaryHideRules(summary_settings.value, true);
      refreshSummaryState();
      toastr.success(`已同步 ${changed_count} 个楼层的隐藏状态。`, SCRIPT_NAME);
    } finally {
      is_applying.value = false;
    }
  }

  async function unhideSummaryAll() {
    if (is_applying.value) {
      return;
    }

    is_applying.value = true;
    try {
      const changed_count = await unhideAllChatMessages();
      refreshSummaryState();
      toastr.success(`已取消隐藏 ${changed_count} 个楼层。`, SCRIPT_NAME);
    } finally {
      is_applying.value = false;
    }
  }

  async function setSummaryFloorRowHidden(row: SummaryFloorRow) {
    if (is_applying.value || row.operation_target_hidden === undefined || row.message_ids.length === 0) {
      return;
    }

    is_applying.value = true;
    try {
      const changed_count = await setSummaryFloorRowsHidden(row.message_ids, row.operation_target_hidden);
      refreshSummaryState();
      toastr.success(`已${row.operation_target_hidden ? '隐藏' : '显示'} ${changed_count} 个楼层。`, SCRIPT_NAME);
    } finally {
      is_applying.value = false;
    }
  }

  function startSummaryWatch() {
    refreshSummaryState();
    if (summary_event_stops.length > 0) {
      return;
    }

    const refresh_handler = () => {
      refreshSummaryState();
    };
    summary_event_stops = [
      eventOn(tavern_events.CHAT_CHANGED, refresh_handler),
      eventOn(tavern_events.MESSAGE_SENT, refresh_handler),
      eventOn(tavern_events.MESSAGE_RECEIVED, refresh_handler),
      eventOn(tavern_events.MESSAGE_EDITED, refresh_handler),
      eventOn(tavern_events.MESSAGE_DELETED, refresh_handler),
      eventOn(tavern_events.MESSAGE_UPDATED, refresh_handler),
      eventOn(tavern_events.MESSAGE_SWIPED, refresh_handler),
      eventOn(tavern_events.GENERATION_ENDED, refresh_handler),
    ];
  }

  function stopSummaryWatch() {
    summary_event_stops.forEach(event => event.stop());
    summary_event_stops = [];
  }

  function scanCurrentSummaryMessages() {
    const config_result = readAdapterConfig();
    const regexes = config_result.config.summary.generation.detect_regexes;
    if (regexes.length === 0) {
      toastr.error('未配置总结识别正则，无法手动扫描。', SCRIPT_NAME);
      return;
    }

    const { compiled, errors: regex_errors } = compileSummaryRegexes(regexes);
    if (compiled.length === 0) {
      toastr.error(`没有可用的总结识别正则：\n${regex_errors.join('\n')}`, SCRIPT_NAME);
      return;
    }

    const messages = readCurrentChatMessages();
    const matched_ids = messages
      .filter(message => isCompiledSummaryRegexMatched(message.message, compiled))
      .map(message => message.message_id);
    let added_count = 0;
    matched_ids.forEach(message_id => {
      if (addSummaryMessageId(message_id)) {
        added_count += 1;
      }
    });
    refreshSummaryState();

    const warning =
      regex_errors.length > 0 ? `\n有 ${regex_errors.length} 条正则无效：\n${regex_errors.slice(0, 3).join('\n')}` : '';
    toastr.success(
      `扫描完成：共扫描 ${messages.length} 层，命中 ${matched_ids.length} 层，新增 ${added_count} 个总结标记。${warning}`,
      SCRIPT_NAME,
    );
  }

  async function runManualSummary() {
    if (is_applying.value) {
      return;
    }

    const state = loadState();
    refreshSummaryState();
    if (!summary_state.value.has_chat) {
      toastr.error('需要先打开一个聊天。', SCRIPT_NAME);
      return;
    }
    if (state.errors.length > 0 || !state.preset) {
      toastr.error('配置存在错误，无法开始总结。', SCRIPT_NAME);
      return;
    }

    const status = buildSummaryGenerationStatus(state.config, state.groups);
    if (!status.can_start) {
      toastr.error(`总结使用设置不可用：\n${status.errors.join('\n')}`, SCRIPT_NAME);
      return;
    }
    if (summary_settings.value.content_handling === 'worldbook' && !getChatWorldbookName('current')) {
      toastr.error('当前聊天没有绑定世界书，无法使用“放置于世界书”。', SCRIPT_NAME);
      return;
    }

    const settings_snapshot = cloneJson(summary_settings.value);
    let summary_prompt: string | undefined;
    try {
      summary_prompt = await requestManualSummaryPrompt(settings_snapshot);
    } catch (error) {
      notifySummaryError(settings_snapshot.manual_prompt_enabled ? '输入总结需求' : '总结确认弹窗', error);
      return;
    }
    if (summary_prompt === undefined) {
      return;
    }

    if (isHostGenerationInProgress()) {
      toastr.warning('当前已有普通回复正在生成，请稍后重试。', SCRIPT_NAME);
      return;
    }

    const group_config = state.config.groups.find(group => group.id === status.group_id);
    const group_view = state.groups.find(group => group.id === status.group_id);
    const option_view = findSummaryOption(group_view, status.option_id);
    if (!group_config || !group_view || !option_view) {
      toastr.error('总结使用设置已失效，请刷新后重试。', SCRIPT_NAME);
      return;
    }

    const target_states = buildOptionTargetStates(group_config, group_view, option_view, true);
    if (target_states.size === 0) {
      toastr.error('总结使用选项没有命中任何提示词。', SCRIPT_NAME);
      return;
    }

    manual_summary_running.value = true;
    is_applying.value = true;
    try {
      let generated_message_id: number | undefined;
      let generation_failed = false;
      let restore_failed = false;
      let generation_stage = '切换总结预设';
      const snapshot = getGroupPromptStateSnapshot(state.preset, group_view);
      try {
        const preset = getPreset('in_use');
        const changed = applyPromptTargetStates(preset, target_states);
        if (changed) {
          await replacePreset('in_use', preset, { render: 'immediate' });
        }

        generation_stage = '发送总结需求';
        const before_request_message_id = getLastMessageId();
        await createChatMessages([{ message: summary_prompt, role: 'user' }], { refresh: 'affected' });
        const before_last_message_id = getLastMessageId();
        if (before_last_message_id <= before_request_message_id) {
          throw new Error('发送总结需求后没有检测到新的用户楼层。');
        }

        generation_stage = '总结生成';
        await Promise.resolve(SillyTavern.generate('normal'));
        const latest_message = getChatMessages(-1)[0];
        if (latest_message && latest_message.message_id > before_last_message_id) {
          generated_message_id = latest_message.message_id;
        }
      } catch (error) {
        generation_failed = true;
        notifySummaryError(generation_stage, error, {
          group_id: status.group_id,
          manual_prompt_enabled: settings_snapshot.manual_prompt_enabled,
          option_id: status.option_id,
          option: status.option_label,
        });
      } finally {
        try {
          await restorePromptStateSnapshot(snapshot);
        } catch (error) {
          restore_failed = true;
          notifySummaryError('恢复总结预设状态', error, {
            group_id: status.group_id,
            option_id: status.option_id,
            option: status.option_label,
          });
        }
      }

      if (generation_failed || restore_failed) {
        return;
      }
      if (generated_message_id === undefined) {
        toastr.warning('生成结束，但没有检测到新的总结楼层。', SCRIPT_NAME);
        return;
      }

      const generated_message = getChatMessages(generated_message_id)[0];
      if (!generated_message) {
        toastr.warning(`生成结束，但第 ${generated_message_id} 层已不存在。`, SCRIPT_NAME);
        return;
      }

      try {
        addSummaryMessageId(generated_message_id);
        await processGeneratedSummaryMessage(generated_message_id, generated_message.message, settings_snapshot);
        toastr.success(`已完成第 ${generated_message_id} 层总结。`, SCRIPT_NAME);
      } catch (error) {
        notifySummaryError('总结后处理', error, {
          content_handling: settings_snapshot.content_handling,
          generated_message_id,
          auto_hide_after_manual: settings_snapshot.hide_rules.auto_hide_after_manual,
          hide_summary: settings_snapshot.hide_rules.hide_summary,
        });
      }
    } catch (error) {
      notifySummaryError('手动总结流程', error, {
        group_id: status.group_id,
        option_id: status.option_id,
        option: status.option_label,
      });
    } finally {
      manual_summary_running.value = false;
      is_applying.value = false;
      refresh();
    }
  }

  async function startManualSummary() {
    if (manual_summary_task) {
      await manual_summary_task;
      return;
    }

    const task = runManualSummary();
    manual_summary_task = task;
    try {
      await task;
    } finally {
      if (manual_summary_task === task) {
        manual_summary_task = undefined;
      }
    }
  }

  function selectDebugRecord(id: string) {
    selected_debug_record_id.value = id;
  }

  async function clearDebugRecords() {
    const api = debug_api;
    if (!api) {
      return;
    }
    try {
      await Promise.resolve(api.clearRecords());
    } catch (error) {
      toastr.error(`清空 Debug 记录失败：${normalizeError(error)}`, SCRIPT_NAME);
      console.error(`[${SCRIPT_NAME}] 清空 Debug 记录失败。`, error);
    }
  }

  async function getDebugContent(record_id: string, content_id: string): Promise<string | undefined> {
    const api = debug_api;
    if (!api) {
      return undefined;
    }
    return await Promise.resolve(api.getContent(record_id, content_id));
  }

  function pruneSelectedExportKeys() {
    const valid_keys = new Set<string>();
    groups.value.forEach(group => {
      group.options.forEach(option => {
        if (option.exportable) {
          valid_keys.add(getExportOptionKey(group.id, option.id));
        }
      });
    });
    selected_export_keys.value = new Set([...selected_export_keys.value].filter(key => valid_keys.has(key)));
  }

  function loadState(): LoadedState {
    const config_result = readAdapterConfig();
    config.value = config_result.config;
    title.value = config_result.config.title;
    description.value = config_result.config.description;
    summary_settings.value = cloneJson(config_result.config.summary.settings);
    loaded_preset_name.value = getLoadedPresetName();

    let preset: Preset | undefined;
    try {
      preset = getPreset('in_use');
    } catch (error) {
      const message = `读取当前使用预设失败：${normalizeError(error)}`;
      console.warn(`[${SCRIPT_NAME}] ${message}`, error);
      groups.value = [];
      errors.value = [...config_result.errors, message];
      refreshSummaryState();
      return { config: config_result.config, groups: [], errors: errors.value };
    }

    const built = buildGroupViews(config_result.config, preset);
    groups.value = built.groups;
    pruneSelectedExportKeys();
    errors.value = [...config_result.errors, ...built.errors];
    refreshSummaryState();
    return { config: config_result.config, preset, groups: built.groups, errors: errors.value };
  }

  function refresh() {
    loadState();
    refreshDebugApi();
  }

  function startExportMode() {
    loadState();
    if (errors.value.length > 0) {
      toastr.error('配置存在错误，无法进入导出模式。', SCRIPT_NAME);
      return;
    }
    review_panel.value = undefined;
    export_mode.value = true;
    selected_export_keys.value = new Set();
  }

  function cancelExportMode() {
    review_panel.value = undefined;
    export_mode.value = false;
    selected_export_keys.value = new Set();
  }

  function closeReviewPanel() {
    review_panel.value = undefined;
  }

  function isExportOptionSelected(group_id: string, option_id: string): boolean {
    return selected_export_keys.value.has(getExportOptionKey(group_id, option_id));
  }

  function toggleExportOption(group_id: string, option_id: string) {
    const option = groups.value
      .find(group => group.id === group_id)
      ?.options.find(candidate => candidate.id === option_id);
    if (!option?.exportable) {
      toastr.warning('只有动态匹配选项可以导出。', SCRIPT_NAME);
      return;
    }

    const key = getExportOptionKey(group_id, option_id);
    const next_keys = new Set(selected_export_keys.value);
    if (next_keys.has(key)) {
      next_keys.delete(key);
    } else {
      next_keys.add(key);
    }
    selected_export_keys.value = next_keys;
  }

  function exportSelectedOptions() {
    const state = loadState();
    if (state.errors.length > 0 || !state.preset) {
      toastr.error('配置存在错误，无法导出。', SCRIPT_NAME);
      return;
    }

    const selected_keys = selected_export_keys.value;
    const items: ExportFile['items'] = [];
    const review_items: ReviewPromptItem[] = [];
    for (const group of state.groups) {
      for (const option of group.options) {
        if (!option.export_source || !selected_keys.has(getExportOptionKey(group.id, option.id))) {
          continue;
        }

        const prompt = state.preset.prompts[option.export_source.prompt_index];
        if (!prompt) {
          continue;
        }

        const source: ExportFile['items'][number] = {
          group_id: option.export_source.group_id,
          match_id: option.export_source.match_id,
          name: prompt.name,
          prompt: cloneJson(prompt),
        };
        const item_index = items.length;
        items.push(source);
        review_items.push({
          key: getReviewItemKey(source.group_id, source.match_id, source.name, item_index),
          group_id: source.group_id,
          group_label: group.label,
          match_id: source.match_id,
          name: source.name,
          action: 'export',
          action_label: '导出',
          preview: getPromptPreview(source.prompt),
          source,
        });
      }
    }

    if (items.length === 0) {
      toastr.warning('请先勾选要导出的动态匹配选项。', SCRIPT_NAME);
      return;
    }

    const file: ExportFile = {
      type: EXPORT_FILE_TYPE,
      version: EXPORT_FILE_VERSION,
      exported_at: new Date().toISOString(),
      title: state.config.title,
      items,
    };
    review_panel.value = {
      kind: 'export',
      title: `确认导出 ${items.length} 项设置`,
      filename: getExportFilename(state.config.title),
      file,
      items: review_items,
    };
  }

  function confirmExportReview() {
    const panel = review_panel.value;
    if (panel?.kind !== 'export') {
      return;
    }

    downloadJson(panel.filename, panel.file);
    toastr.success(`已导出 ${panel.items.length} 项设置。`, SCRIPT_NAME);
    cancelExportMode();
  }

  async function importPresetSettings(text: string): Promise<void> {
    if (is_applying.value) {
      return;
    }

    try {
      let parsed_json: unknown;
      try {
        parsed_json = JSON.parse(text);
      } catch (error) {
        toastr.error(`导入文件不是有效 JSON：${normalizeError(error)}`, SCRIPT_NAME);
        return;
      }

      const parsed = ExportFileSchema.safeParse(parsed_json);
      if (!parsed.success) {
        console.warn(`[${SCRIPT_NAME}] 导入文件校验失败。`, parsed.error);
        toastr.error(`只能导入预设适配器导出的设置文件：\n${formatZodIssues(parsed.error)}`, SCRIPT_NAME);
        return;
      }

      const state = loadState();
      if (state.errors.length > 0 || !state.preset) {
        toastr.error('配置存在错误，无法导入。', SCRIPT_NAME);
        return;
      }

      const review = buildImportReview(parsed.data, state.config, state.preset);
      if (review.items.length === 0 && review.failed_items.length === 0) {
        toastr.error('导入文件没有设置项。', SCRIPT_NAME);
        return;
      }

      review_panel.value = {
        kind: 'import',
        title: `确认导入 ${parsed.data.items.length} 项设置`,
        file: parsed.data,
        items: review.items,
        failed_items: review.failed_items,
      };
    } finally {
      is_applying.value = false;
    }
  }

  async function confirmImportReview(include_failed: boolean): Promise<void> {
    const panel = review_panel.value;
    if (panel?.kind !== 'import' || is_applying.value) {
      return;
    }

    is_applying.value = true;
    try {
      const state = loadState();
      if (state.errors.length > 0 || !state.preset) {
        toastr.error('配置存在错误，无法导入。', SCRIPT_NAME);
        return;
      }

      const review = buildImportReview(panel.file, state.config, state.preset);
      review_panel.value = {
        ...panel,
        items: review.items,
        failed_items: review.failed_items,
      };

      const skipped: string[] = [];
      let created_count = 0;
      let overwritten_count = 0;
      let appended_count = 0;
      for (const item of review.items.map(review_item => review_item.source)) {
        const result = applyImportItem(state.preset, state.config, item);
        if ('error' in result) {
          skipped.push(`${item.group_id}/${item.match_id}/${item.name}: ${result.error}`);
          continue;
        }
        if (result.action === 'overwrite') {
          overwritten_count += 1;
        } else {
          created_count += 1;
        }
      }
      if (include_failed) {
        for (const item of review.failed_items.map(review_item => review_item.source)) {
          appendImportItem(state.preset, item);
          appended_count += 1;
        }
      }

      const imported_count = created_count + overwritten_count + appended_count;
      if (imported_count === 0) {
        toastr.error(
          skipped.length > 0 ? `没有可导入的匹配项：\n${skipped.slice(0, 4).join('\n')}` : '导入文件没有设置项。',
          SCRIPT_NAME,
        );
        return;
      }

      const preset_name_to_save = getLoadedPresetName();
      await replacePreset('in_use', state.preset, { render: 'immediate' });
      if (preset_name_to_save && preset_name_to_save !== 'in_use') {
        await replacePreset(preset_name_to_save, state.preset, { render: 'none' });
      }
      review_panel.value = undefined;
      refresh();
      toastr.success(
        `已导入并保存 ${imported_count} 项设置：新增 ${created_count} 项，覆盖 ${overwritten_count} 项，追加 ${appended_count} 项。`,
        SCRIPT_NAME,
      );
      const skipped_count = (include_failed ? 0 : review.failed_items.length) + skipped.length;
      if (skipped_count > 0) {
        toastr.warning(`有 ${skipped_count} 项未导入，请检查 group id、match id 或区间标记。`, SCRIPT_NAME);
        console.warn(`[${SCRIPT_NAME}] 部分导入项未匹配。`, [...review.failed_items, ...skipped]);
      }
    } finally {
      is_applying.value = false;
    }
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
    active_tab,
    addSummaryMessageIdFromInput,
    applyOption,
    applySummaryHideOnly,
    cancelExportMode,
    clearDebugRecords,
    closeReviewPanel,
    confirmExportReview,
    confirmImportReview,
    debug_available,
    debug_loading,
    debug_records,
    description,
    errors,
    export_mode,
    exportSelectedOptions,
    getDebugContent,
    groups,
    has_blocking_errors,
    importPresetSettings,
    isExportOptionSelected,
    is_applying,
    is_summary_running,
    loaded_preset_name,
    refresh,
    refreshSummaryState,
    review_panel,
    scanCurrentSummaryMessages,
    selectDebugRecord,
    selected_debug_record,
    selected_debug_record_id,
    selected_export_count,
    setActiveTab,
    setSummaryFloorRowHidden,
    setSummaryContentHandling,
    setSummaryFilterHtmlCodeBlocks,
    setSummaryHideRule,
    setSummaryManualPromptEnabled,
    startExportMode,
    startDebugWatch,
    startManualSummary,
    startSummaryWatch,
    stopSummaryWatch,
    summary_generation_status,
    summary_settings,
    summary_state,
    syncSummaryHideRules,
    stopDebugWatch,
    title,
    toggleExportOption,
    deleteSummaryMessageId,
    unhideSummaryAll,
  };
});
