import { registerAsUniqueScript } from '@util/script';

export const SCRIPT_NAME = '空正文梦境提取';
export const DEFAULT_START_REGEX = '^<dream_plot>';
export const DEFAULT_END_REGEX = '';

export type DreamExtractionSettings = z.infer<typeof DreamExtractionSettings>;
export const DreamExtractionSettings = z
  .object({
    start_regex: z.string().default(DEFAULT_START_REGEX).catch(DEFAULT_START_REGEX),
    end_regex: z.string().default(DEFAULT_END_REGEX).catch(DEFAULT_END_REGEX),
  })
  .prefault({});

function readSettings(): DreamExtractionSettings {
  const result = DreamExtractionSettings.safeParse(getVariables({ type: 'script', script_id: getScriptId() }));
  if (result.success) {
    return result.data;
  }
  console.warn(`[${SCRIPT_NAME}] 设置读取失败，已使用默认设置。`, result.error);
  return DreamExtractionSettings.parse({});
}

export const useDreamExtractionStore = defineStore(SCRIPT_NAME, () => {
  const settings = ref(readSettings());
  const should_enable = ref(false);

  const { getPreferredScriptId, listenPreferenceState } = registerAsUniqueScript(SCRIPT_NAME);
  should_enable.value = getPreferredScriptId() === getScriptId();
  listenPreferenceState(preferred_script_id => {
    should_enable.value = preferred_script_id === getScriptId();
  });

  watchEffect(() => {
    replaceVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
  });

  function resetSettings() {
    settings.value = DreamExtractionSettings.parse({});
  }

  return { settings, should_enable, resetSettings };
});
