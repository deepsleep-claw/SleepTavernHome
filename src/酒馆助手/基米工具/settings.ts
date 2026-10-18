import { defineStore } from 'pinia';
import { ref } from 'vue';
import { configFromPreset, globalConfigFromSettings } from '../../../projects/tool-output-bridge/src/shared/config';
import { SettingsSchema, SETTINGS_KEY, type Settings } from './config';

export interface ExtensionSettingsContext {
  getPresetManager?: (api: string) => { readPresetExtensionField?: (option: { path: string }) => unknown };
  extensionSettings?: Record<string, unknown>;
}

export function initializeSettings(context: ExtensionSettingsContext): Settings {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  if (variables[SETTINGS_KEY] !== undefined) return readSettings();
  const preset = context.getPresetManager?.('openai')?.readPresetExtensionField?.({ path: SETTINGS_KEY });
  const global = context.extensionSettings?.[SETTINGS_KEY];
  return saveSettings(
    preset == null && global == null ? undefined : { ...configFromPreset(preset), ...globalConfigFromSettings(global) },
  );
}

export function readSettings(): Settings {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  return SettingsSchema.parse(variables[SETTINGS_KEY]);
}

export function saveSettings(value: unknown): Settings {
  const settings = SettingsSchema.parse(value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  updateVariablesWith(variables => ({ ...variables, [SETTINGS_KEY]: JSON.parse(JSON.stringify(settings)) }), {
    type: 'script',
    script_id: getScriptId(),
  });
  return settings;
}

export const useJimiStore = defineStore('jimi-tools-helper', () => {
  const settings = ref(readSettings());
  const open = ref(false);
  const warning = ref('');
  const error = ref('');

  function save(value: unknown) {
    settings.value = saveSettings(value);
    error.value = '';
  }

  function refresh() {
    settings.value = readSettings();
  }

  return { settings, open, warning, error, save, refresh };
});
