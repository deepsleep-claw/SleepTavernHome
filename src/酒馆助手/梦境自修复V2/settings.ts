import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { z } from 'zod';
import format_prompt from './prompts/format.md?raw';
import review_prompt from './prompts/review.md?raw';

export const SCRIPT_NAME = '梦境自修复V2';
export const BUTTON_NAME = '正文修复';
export const SETTINGS_KEY = 'dream_self_repair_v2_settings';
export const STATE_KEY = 'dream_self_repair';
export const SettingsSchema = z.object({
  version: z.literal(2).default(2),
  auto: z.boolean().default(true),
  format: z.boolean().default(true),
  review: z.boolean().default(true),
  link_mvu: z.boolean().default(true),
  format_prompt: z.string().default(format_prompt.trim()),
  review_prompt: z.string().default(review_prompt.trim()),
  intercept: z.boolean().default(true),
  tail: z.string().default('/^<\\/dream_dx_setting>/m'),
  insert_before: z.string().default('/^<StatusPlaceHolderImpl\\/>/m'),
  source: z.enum(['current', 'custom']).default('current'),
  apiurl: z.string().default(''),
  key: z.string().default(''),
  model: z.string().default(''),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  max_tokens: z.coerce.number().int().min(256).max(131072).default(8192),
  stream: z.boolean().default(false),
  timeout_seconds: z.coerce.number().int().min(30).max(1800).default(300),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const DEFAULT_SETTINGS = SettingsSchema.parse({});

export const useRepairStore = defineStore('dream-self-repair-v2', () => {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const migrated = variables[SETTINGS_KEY] ?? {
    format_prompt: variables.sleep_var_format_append,
    tail: variables.sleep_var_format_append_intercept_tail,
    insert_before: variables.sleep_var_format_append_insert_prefix,
    stream: variables.sleep_var_format_append_stream_enabled,
  };
  const parsed = SettingsSchema.safeParse(migrated);
  const settings = ref<Settings>(parsed.success ? parsed.data : { ...DEFAULT_SETTINGS });
  const open = ref(false);
  const enabled = ref(true);
  const busy = ref(false);
  const stage = ref('就绪');
  const error = ref('');
  const result = ref('');
  const stream_text = ref('');
  const actual_request = ref('');
  watch(
    settings,
    value => {
      const scope = { type: 'script' as const, script_id: getScriptId() };
      replaceVariables({ ...getVariables(scope), [SETTINGS_KEY]: JSON.parse(JSON.stringify(value)) }, scope);
    },
    { deep: true },
  );
  return { settings, open, enabled, busy, stage, error, result, stream_text, actual_request };
});
