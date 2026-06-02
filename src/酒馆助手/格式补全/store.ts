import { registerAsUniqueScript } from '@util/script';
import default_format_append_prompt from './default_append_prompt.md?raw';

export const FORMAT_COMPLETION_NAME = '格式补全';
export const FORMAT_APPEND_VARIABLE = 'sleep_var_format_append';
export const FORMAT_APPEND_INTERCEPT_ENABLED_VARIABLE = 'sleep_var_format_append_intercept_enabled';
export const FORMAT_APPEND_INTERCEPT_TAIL_VARIABLE = 'sleep_var_format_append_intercept_tail';
export const FORMAT_APPEND_STREAM_ENABLED_VARIABLE = 'sleep_var_format_append_stream_enabled';
export const FORMAT_APPEND_INSERT_PREFIX_VARIABLE = 'sleep_var_format_append_insert_prefix';
export const DEFAULT_FORMAT_APPEND_PROMPT = default_format_append_prompt.trim();
export const DEFAULT_FORMAT_APPEND_INTERCEPT_TAIL = '/^<\\/dream_dx_setting>/m';
export const DEFAULT_FORMAT_APPEND_INSERT_PREFIX = '/^<StatusPlaceHolderImpl\\/>/m';

function getScriptVariableScope() {
  return { type: 'script' as const, script_id: getScriptId() };
}

function readFormatAppendPrompt(): string {
  const variables = getVariables(getScriptVariableScope());
  const value = variables[FORMAT_APPEND_VARIABLE];
  if (value == null) {
    writeFormatAppendPrompt(DEFAULT_FORMAT_APPEND_PROMPT);
    return DEFAULT_FORMAT_APPEND_PROMPT;
  }
  return String(value);
}

function readBooleanVariable(name: string, default_value: boolean): boolean {
  const value = getVariables(getScriptVariableScope())[name];
  if (value == null) {
    writeScriptVariable(name, default_value);
    return default_value;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() === 'true';
}

function readStringVariable(name: string, default_value: string): string {
  const value = getVariables(getScriptVariableScope())[name];
  if (value == null) {
    writeScriptVariable(name, default_value);
    return default_value;
  }
  return String(value);
}

function writeScriptVariable(name: string, value: unknown) {
  const variables = klona(getVariables(getScriptVariableScope()));
  variables[name] = value;
  replaceVariables(variables, getScriptVariableScope());
}

function writeFormatAppendPrompt(value: string) {
  writeScriptVariable(FORMAT_APPEND_VARIABLE, value);
}

export const useFormatCompletionStore = defineStore('格式补全', () => {
  const append_prompt = ref(readFormatAppendPrompt());
  const should_intercept_tail_user_prompt = ref(readBooleanVariable(FORMAT_APPEND_INTERCEPT_ENABLED_VARIABLE, false));
  const should_stream_format_completion = ref(readBooleanVariable(FORMAT_APPEND_STREAM_ENABLED_VARIABLE, false));
  const intercept_tail_prompt = ref(
    readStringVariable(FORMAT_APPEND_INTERCEPT_TAIL_VARIABLE, DEFAULT_FORMAT_APPEND_INTERCEPT_TAIL),
  );
  const insert_format_prefix = ref(
    readStringVariable(FORMAT_APPEND_INSERT_PREFIX_VARIABLE, DEFAULT_FORMAT_APPEND_INSERT_PREFIX),
  );
  const should_enable = ref(false);

  const { getPreferredScriptId, listenPreferenceState } = registerAsUniqueScript(FORMAT_COMPLETION_NAME);
  should_enable.value = getPreferredScriptId() === getScriptId();
  listenPreferenceState(preferred_script_id => {
    should_enable.value = preferred_script_id === getScriptId();
  });

  watch(append_prompt, value => writeFormatAppendPrompt(value));
  watch(should_intercept_tail_user_prompt, value =>
    writeScriptVariable(FORMAT_APPEND_INTERCEPT_ENABLED_VARIABLE, value),
  );
  watch(should_stream_format_completion, value => writeScriptVariable(FORMAT_APPEND_STREAM_ENABLED_VARIABLE, value));
  watch(intercept_tail_prompt, value => writeScriptVariable(FORMAT_APPEND_INTERCEPT_TAIL_VARIABLE, value));
  watch(insert_format_prefix, value => writeScriptVariable(FORMAT_APPEND_INSERT_PREFIX_VARIABLE, value));

  function resetAppendPrompt() {
    append_prompt.value = DEFAULT_FORMAT_APPEND_PROMPT;
  }

  return {
    append_prompt,
    insert_format_prefix,
    intercept_tail_prompt,
    should_enable,
    should_intercept_tail_user_prompt,
    should_stream_format_completion,
    resetAppendPrompt,
  };
});
