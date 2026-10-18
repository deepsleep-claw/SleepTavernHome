import { defineStore } from 'pinia';
import { ref } from 'vue';
import { SettingsSchema, SETTINGS_KEY, type Settings } from './config';

export function initializeSettings(): Settings {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  if (variables[SETTINGS_KEY] !== undefined) return readSettings();
  return saveSettings(undefined);
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
  const warning = ref('');
  const error = ref('');

  function save(value: unknown) {
    settings.value = saveSettings(value);
    error.value = '';
  }

  function refresh() {
    settings.value = readSettings();
  }

  return { settings, warning, error, save, refresh };
});
