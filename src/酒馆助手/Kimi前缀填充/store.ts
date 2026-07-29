import { registerAsUniqueScript } from '@util/script';

export const SCRIPT_NAME = 'Kimi 前缀填充';

const SettingsSchema = z
  .object({
    enabled: z.boolean().default(false).catch(false),
  })
  .prefault({});

type Settings = z.infer<typeof SettingsSchema>;

function getScriptVariableScope() {
  return { type: 'script' as const, script_id: getScriptId() };
}

function readSettings(): Settings {
  const variables = getVariables(getScriptVariableScope());
  const result = SettingsSchema.safeParse(variables);
  if (!result.success) {
    console.warn(`[${SCRIPT_NAME}] 设置读取失败，已使用默认设置。`, result.error);
    return SettingsSchema.parse({});
  }

  if (variables.enabled === undefined) {
    replaceVariables(klona(result.data), getScriptVariableScope());
  }
  return result.data;
}

export const useKimiPartialModeStore = defineStore(SCRIPT_NAME, () => {
  const enabled_value = ref(readSettings().enabled);
  const should_enable = ref(false);
  const listeners = new Set<(enabled: boolean) => void>();
  const unique_script = registerAsUniqueScript(SCRIPT_NAME);

  should_enable.value = unique_script.getPreferredScriptId() === getScriptId();
  const preference_event = unique_script.listenPreferenceState(preferred_script_id => {
    should_enable.value = preferred_script_id === getScriptId();
  });

  function setEnabled(value: boolean) {
    const enabled = Boolean(value);
    if (enabled_value.value === enabled) {
      return;
    }

    const variables = klona(getVariables(getScriptVariableScope()));
    variables.enabled = enabled;
    replaceVariables(variables, getScriptVariableScope());
    enabled_value.value = enabled;
    listeners.forEach(listener => {
      try {
        listener(enabled);
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] 推送设置状态失败。`, error);
      }
    });
  }

  const enabled = computed({
    get: () => enabled_value.value,
    set: setEnabled,
  });

  function subscribe(callback: (enabled: boolean) => void): { stop: () => void } {
    listeners.add(callback);
    callback(enabled_value.value);
    return {
      stop: () => listeners.delete(callback),
    };
  }

  function destroy() {
    listeners.clear();
    preference_event.stop();
    unique_script.unregister();
  }

  return {
    destroy,
    enabled,
    setEnabled,
    should_enable,
    subscribe,
  };
});
