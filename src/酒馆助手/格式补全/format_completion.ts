import { FORMAT_APPEND_VARIABLE, FORMAT_COMPLETION_NAME, useFormatCompletionStore } from './store';

const DREAM_APPEND_FORMAT_REGEX = /<dream_append_format>([\s\S]*?)<\/dream_append_format>/;
const PROMPT_EXTRACTION_TIMEOUT_MS = 30_000;
const STREAM_PREVIEW_UPDATE_INTERVAL_MS = 150;

let is_completing = false;

type FormatMessageInserter = (base_message: string, append_content: string) => string;

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException && error.name === 'AbortError') || _.get(error, 'name') === 'AbortError';
}

function stopGenerationForPromptExtraction() {
  try {
    SillyTavern.stopGeneration();
  } catch (error) {
    if (!isAbortError(error)) {
      console.warn(`[${FORMAT_COMPLETION_NAME}] 停止提示词提取生成时出错:`, error);
    }
  }
}

function getFormatAppendPrompt(): string {
  return useFormatCompletionStore().append_prompt;
}

function parseRegexPattern(pattern: string, label: string): RegExp | undefined {
  try {
    const matched = pattern.match(/^\/([\s\S]*)\/([a-z]*)$/i);
    if (!matched) {
      return new RegExp(_.escapeRegExp(pattern), 'i');
    }

    const flags = [...new Set(matched[2])].join('');
    return new RegExp(matched[1], flags);
  } catch (error) {
    console.warn(`[${FORMAT_COMPLETION_NAME}] ${label}不是有效正则:`, error);
    return undefined;
  }
}

function parseInterceptTailRegex(pattern: string): RegExp | undefined {
  return parseRegexPattern(pattern, '拦截提示词尾');
}

function parseInsertPrefixRegex(pattern: string): RegExp | undefined {
  return parseRegexPattern(pattern, '插入格式前缀匹配');
}

function findLastRegexMatch(content: string, regex: RegExp): RegExpExecArray | undefined {
  const flags = [...new Set(`${regex.flags.replace(/[gy]/g, '')}g`)].join('');
  const global_regex = new RegExp(regex.source, flags);
  let last_match: RegExpExecArray | undefined;
  let matched: RegExpExecArray | null;

  while ((matched = global_regex.exec(content)) !== null) {
    last_match = matched;
    if (matched[0].length === 0) {
      global_regex.lastIndex += 1;
    }
  }
  return last_match;
}

function appendPromptAfterTail(content: string, tail_end_index: number, append_prompt: string): string {
  const content_until_tail = content.slice(0, tail_end_index);
  const separator = content_until_tail.endsWith('\n') ? '' : '\n';
  return `${content_until_tail}${separator}${append_prompt}`;
}

function appendToMessage(base_message: string, append_content: string): string {
  if (!base_message) {
    return append_content;
  }
  const separator = base_message.endsWith('\n') ? '' : '\n';
  return `${base_message}${separator}${append_content}`;
}

function insertBeforePrefix(base_message: string, append_content: string, prefix_regex: RegExp): string | undefined {
  const matched = findLastRegexMatch(base_message, prefix_regex);
  if (!matched) {
    return undefined;
  }

  const content_before_prefix = base_message.slice(0, matched.index);
  const content_after_prefix = base_message.slice(matched.index);
  const separator_before = content_before_prefix && !content_before_prefix.endsWith('\n') ? '\n' : '';
  const separator_after = append_content.endsWith('\n') ? '' : '\n';
  return `${content_before_prefix}${separator_before}${append_content}${separator_after}${content_after_prefix}`;
}

function createFormatMessageInserter(): FormatMessageInserter {
  const store = useFormatCompletionStore();
  const regex = parseInsertPrefixRegex(store.insert_format_prefix);
  if (!regex) {
    toastr.warning('插入格式前缀匹配不是有效正则，已改为追加到正文末尾。', FORMAT_COMPLETION_NAME);
    return appendToMessage;
  }
  return (base_message, append_content) =>
    insertBeforePrefix(base_message, append_content, regex) ?? appendToMessage(base_message, append_content);
}

function buildOrderedPrompts(extracted_prompts: RolePrompt[], append_prompt: string): RolePrompt[] {
  const store = useFormatCompletionStore();
  const should_intercept = store.should_intercept_tail_user_prompt;
  if (!should_intercept) {
    return [...extracted_prompts, { role: 'user', content: append_prompt }];
  }

  const last_prompt = extracted_prompts.at(-1);
  if (!last_prompt || last_prompt.role !== 'user') {
    return [...extracted_prompts, { role: 'user', content: append_prompt }];
  }

  const regex = parseInterceptTailRegex(store.intercept_tail_prompt);
  if (!regex) {
    toastr.warning('拦截提示词尾不是有效正则，已改为追加新 user 提示词。', FORMAT_COMPLETION_NAME);
    return [...extracted_prompts, { role: 'user', content: append_prompt }];
  }

  const matched = findLastRegexMatch(last_prompt.content, regex);
  if (!matched) {
    return [...extracted_prompts, { role: 'user', content: append_prompt }];
  }

  const prompts = [...extracted_prompts];
  prompts[prompts.length - 1] = {
    ...last_prompt,
    content: appendPromptAfterTail(last_prompt.content, matched.index + matched[0].length, append_prompt),
  };
  return prompts;
}

function extractDreamAppendFormat(content: string): string | undefined {
  const matched = content.match(DREAM_APPEND_FORMAT_REGEX);
  if (!matched) {
    return undefined;
  }

  const extracted_content = matched[1].trim();
  return extracted_content ? extracted_content : undefined;
}

function getPromptContent(content: SillyTavern.SendingMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('\n');
}

function toRolePrompts(prompt: SillyTavern.SendingMessage[] | string): RolePrompt[] {
  if (typeof prompt === 'string') {
    return [{ role: 'system', content: prompt }];
  }
  return prompt
    .map(({ role, content }) => ({
      role,
      content: getPromptContent(content),
    }))
    .filter(({ content }) => content.trim());
}

async function restoreMessage(message_id: number, base_message: string): Promise<void> {
  await setChatMessages([{ message_id, message: base_message }], { refresh: 'affected' });
}

function updateMessagePreview(message_id: number, message: string): boolean {
  const chat_message = SillyTavern.chat[message_id];
  if (!chat_message) {
    return false;
  }

  chat_message.mes = message;
  if (chat_message.swipes) {
    _.set(chat_message, ['swipes', chat_message.swipe_id ?? 0], message);
  }
  SillyTavern.updateMessageBlock(message_id, chat_message);
  return true;
}

function logCompletedStreamContent(content: string) {
  console.info(`[${FORMAT_COMPLETION_NAME}] 流式生成完整正文:\n${content}`);
}

function createStreamPreviewController(
  message_id: number,
  base_message: string,
  generation_id: string,
  format_inserter: FormatMessageInserter,
) {
  let is_stopped = false;
  let update_timer: ReturnType<typeof setTimeout> | undefined;
  let latest_stream_content = '';
  let has_warned_preview_failure = false;

  const renderPreview = (stream_content: string) => {
    if (is_stopped) {
      return;
    }
    const did_update = updateMessagePreview(message_id, format_inserter(base_message, stream_content));
    if (!did_update && !has_warned_preview_failure) {
      has_warned_preview_failure = true;
      console.warn(`[${FORMAT_COMPLETION_NAME}] 流式预览更新失败，目标楼层不存在。`);
    }
  };

  const scheduleRender = () => {
    if (update_timer) {
      return;
    }
    update_timer = setTimeout(() => {
      update_timer = undefined;
      renderPreview(latest_stream_content);
    }, STREAM_PREVIEW_UPDATE_INTERVAL_MS);
  };

  const handleStreamText = (full_text: string, event_generation_id: string) => {
    if (is_stopped || event_generation_id !== generation_id || !full_text) {
      return;
    }
    latest_stream_content = full_text;
    scheduleRender();
  };

  const event = eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, handleStreamText);

  return {
    stop() {
      is_stopped = true;
      if (update_timer) {
        clearTimeout(update_timer);
        update_timer = undefined;
      }
      event.stop();
      eventRemoveListener(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, handleStreamText);
    },
    waitForPendingUpdates() {
      return Promise.resolve();
    },
  };
}

type FormatGenerationResult = { content: string; aborted: false } | { aborted: true };

function extractPromptOnce(): Promise<RolePrompt[]> {
  if (SillyTavern.mainApi !== 'openai') {
    return Promise.reject(new Error('当前 API 不是聊天补全，无法使用提示词查看器方式提取提示词。'));
  }
  if (SillyTavern.onlineStatus === 'no_connection') {
    return Promise.reject(new Error('未连接到 API，无法提取提示词。'));
  }

  return new Promise((resolve, reject) => {
    let completed = false;
    let listening_event: EventOnReturn | undefined;
    let completion_listener: ((completion: { messages: SillyTavern.SendingMessage[] }) => void) | undefined;
    const timeout_ref: { value?: ReturnType<typeof setTimeout> } = {};

    const stopListening = () => {
      listening_event?.stop();
      if (completion_listener) {
        eventRemoveListener(tavern_events.CHAT_COMPLETION_SETTINGS_READY, completion_listener);
        completion_listener = undefined;
      }
      listening_event = undefined;
    };

    const finish = (callback: () => void): boolean => {
      if (completed) {
        return false;
      }
      completed = true;
      if (timeout_ref.value) {
        clearTimeout(timeout_ref.value);
      }
      stopListening();
      callback();
      return true;
    };

    completion_listener = (completion: { messages: SillyTavern.SendingMessage[] }) => {
      finish(() => {
        stopGenerationForPromptExtraction();
        setTimeout(() => resolve(toRolePrompts(completion.messages)));
      });
    };
    listening_event = eventMakeLast(tavern_events.CHAT_COMPLETION_SETTINGS_READY, completion_listener);

    timeout_ref.value = setTimeout(() => {
      finish(() => {
        stopGenerationForPromptExtraction();
        reject(new Error('提取提示词超时。请确认当前 API 为聊天补全，并等待已有生成请求结束。'));
      });
    }, PROMPT_EXTRACTION_TIMEOUT_MS);

    try {
      Promise.resolve(SillyTavern.generate('normal'))
        .then(() => {
          finish(() => reject(new Error('未能提取提示词。')));
        })
        .catch(error => {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))));
        });
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))));
    }
  });
}

function getGeneratedContent(result: string | GenerateToolCallResult): string {
  return typeof result === 'string' ? result : result.content;
}

async function generateFormatContent(
  ordered_prompts: RolePrompt[],
  target_message_id: number,
  base_message: string,
  should_stream: boolean,
  format_inserter: FormatMessageInserter,
): Promise<FormatGenerationResult> {
  if (!should_stream) {
    const result = await generateRaw({ ordered_prompts });
    return { content: getGeneratedContent(result), aborted: false };
  }

  const generation_id = `format_completion_${SillyTavern.uuidv4()}`;
  const preview = createStreamPreviewController(target_message_id, base_message, generation_id, format_inserter);
  let was_stopped = false;
  const handleStopped = () => {
    was_stopped = true;
  };
  const stopped_event = eventOn(tavern_events.GENERATION_STOPPED, handleStopped);

  const stopPreview = async () => {
    preview.stop();
    stopped_event.stop();
    eventRemoveListener(tavern_events.GENERATION_STOPPED, handleStopped);
    await preview.waitForPendingUpdates();
  };

  try {
    const result = await generateRaw({
      ordered_prompts,
      should_stream: true,
      generation_id,
    });
    await stopPreview();

    if (was_stopped) {
      await restoreMessage(target_message_id, base_message);
      return { aborted: true };
    }
    return { content: getGeneratedContent(result), aborted: false };
  } catch (error) {
    await stopPreview();
    await restoreMessage(target_message_id, base_message);
    if (was_stopped || isAbortError(error)) {
      return { aborted: true };
    }
    throw error;
  }
}

async function completeFormat(): Promise<void> {
  const store = useFormatCompletionStore();
  if (!store.should_enable) {
    return;
  }

  if (is_completing) {
    toastr.warning('格式补全正在生成中。', FORMAT_COMPLETION_NAME);
    return;
  }

  const confirmed = await SillyTavern.callGenericPopup('是否进行格式补全？', SillyTavern.POPUP_TYPE.CONFIRM);
  if (confirmed !== true && confirmed !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    return;
  }

  const latest_message = getChatMessages(-1)[0];
  if (!latest_message || latest_message.role !== 'assistant') {
    toastr.error('必须为角色输出。', FORMAT_COMPLETION_NAME);
    return;
  }

  const append_prompt = getFormatAppendPrompt();
  if (!append_prompt.trim()) {
    toastr.error(`脚本变量 ${FORMAT_APPEND_VARIABLE} 为空。`, FORMAT_COMPLETION_NAME);
    return;
  }

  is_completing = true;
  try {
    const extracted_prompts = await extractPromptOnce();
    const current_message = getChatMessages(latest_message.message_id)[0];
    if (!current_message) {
      toastr.error('原角色输出楼层不存在，无法追加格式补全内容。', FORMAT_COMPLETION_NAME);
      return;
    }

    const base_message = current_message.message;
    const format_inserter = createFormatMessageInserter();
    const ordered_prompts = buildOrderedPrompts(extracted_prompts, append_prompt);
    const generation_result = await generateFormatContent(
      ordered_prompts,
      latest_message.message_id,
      base_message,
      store.should_stream_format_completion,
      format_inserter,
    );
    if (generation_result.aborted) {
      toastr.info('已停止格式补全，正文已还原。', FORMAT_COMPLETION_NAME);
      return;
    }

    const generated_content = generation_result.content;
    if (store.should_stream_format_completion) {
      logCompletedStreamContent(generated_content);
    }
    if (!generated_content.trim()) {
      if (store.should_stream_format_completion) {
        await restoreMessage(latest_message.message_id, base_message);
      }
      toastr.warning('格式补全没有生成内容。', FORMAT_COMPLETION_NAME);
      return;
    }
    const append_content = extractDreamAppendFormat(generated_content);
    if (!append_content) {
      if (store.should_stream_format_completion) {
        await restoreMessage(latest_message.message_id, base_message);
      }
      toastr.error('格式补全失败，未能提取到格式内容。', FORMAT_COMPLETION_NAME);
      return;
    }

    await setChatMessages(
      [
        {
          message_id: latest_message.message_id,
          message: format_inserter(base_message, append_content),
        },
      ],
      { refresh: 'affected' },
    );
    toastr.info('格式补充完毕。', FORMAT_COMPLETION_NAME);
  } finally {
    is_completing = false;
  }
}

export function initFormatCompletion(): { destroy: () => void } {
  const listener = errorCatched(completeFormat);
  const event = eventOn(getButtonEvent(FORMAT_COMPLETION_NAME), listener);

  return {
    destroy: () => event.stop(),
  };
}
