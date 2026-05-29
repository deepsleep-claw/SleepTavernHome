import { registerAsUniqueScript } from '@util/script';

export const FORMAT_COMPLETION_NAME = '格式补全';
export const FORMAT_APPEND_VARIABLE = 'sleep_var_format_append';

function readFormatAppendPrompt(): string {
  const value = getVariables({ type: 'global' })[FORMAT_APPEND_VARIABLE];
  return value == null ? '' : String(value);
}

function writeFormatAppendPrompt(value: string) {
  const variables = klona(getVariables({ type: 'global' }));
  variables[FORMAT_APPEND_VARIABLE] = value;
  replaceVariables(variables, { type: 'global' });
}

export const useFormatCompletionStore = defineStore('格式补全', () => {
  const append_prompt = ref(readFormatAppendPrompt());
  const should_enable = ref(false);

  const { getPreferredScriptId, listenPreferenceState } = registerAsUniqueScript(FORMAT_COMPLETION_NAME);
  should_enable.value = getPreferredScriptId() === getScriptId();
  listenPreferenceState(preferred_script_id => {
    should_enable.value = preferred_script_id === getScriptId();
  });

  watch(append_prompt, value => writeFormatAppendPrompt(value));

  return { append_prompt, should_enable };
});
