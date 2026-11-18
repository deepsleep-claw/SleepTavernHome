import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { z } from 'zod';
import type { RpgSettings } from './protocol';

export const SCRIPT_NAME = '梦境RPG';
const KEY = 'dream_rpg_settings';
const Settings = z.object({
  version: z.literal(1).default(1),
  enabled: z.boolean().default(true),
  reuse_rolls: z.boolean().default(true),
  preview_results: z.boolean().default(false),
  allow_secret_reveal: z.boolean().default(false),
  theme: z.enum(['auto', 'light', 'dark']).default('auto'),
});

export const useRpgStore = defineStore('dream-rpg-settings', () => {
  const scope = { type: 'script' as const, script_id: getScriptId() };
  const parsed = Settings.safeParse(getVariables(scope)[KEY] ?? {});
  const settings = ref(parsed.success ? parsed.data : Settings.parse({}));
  const error = ref('');
  watch(
    settings,
    value =>
      replaceVariables(
        { ...getVariables(scope), [KEY]: JSON.parse(JSON.stringify(value)) },
        { type: 'script', script_id: getScriptId() },
      ),
    { deep: true },
  );
  const updateSettings = (patch: Partial<RpgSettings>) => {
    settings.value = Settings.parse({ ...settings.value, ...patch });
  };
  return { settings, updateSettings, error };
});
