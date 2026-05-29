import { FORMAT_APPEND_VARIABLE, FORMAT_COMPLETION_NAME, useFormatCompletionStore } from './store';

const DREAM_APPEND_FORMAT_REGEX = /<dream_append_format>([\s\S]*?)<\/dream_append_format>/;
const PROMPT_EXTRACTION_TIMEOUT_MS = 30_000;
const DRY_RUN_PROCESSING_START_EVENT = 'tavern_resource:format_completion:dry_run_processing:start';
const DRY_RUN_PROCESSING_END_EVENT = 'tavern_resource:format_completion:dry_run_processing:end';

let is_completing = false;

function getFormatAppendPrompt(): string {
  return useFormatCompletionStore().append_prompt;
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

function extractPromptOnce(): Promise<RolePrompt[]> {
  eventEmit(DRY_RUN_PROCESSING_START_EVENT);

  return new Promise((resolve, reject) => {
    let completed = false;
    let stop_listening = () => {};
    const timeout_ref: { value?: ReturnType<typeof setTimeout> } = {};

    const finish = (callback: () => void) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeout_ref.value) {
        clearTimeout(timeout_ref.value);
      }
      stop_listening();
      eventEmit(DRY_RUN_PROCESSING_END_EVENT);
      callback();
    };

    const event = eventOn(
      tavern_events.GENERATE_AFTER_DATA,
      (generate_data: { prompt: SillyTavern.SendingMessage[] | string }, dry_run: boolean) => {
        if (!dry_run) {
          return;
        }
        finish(() => resolve(toRolePrompts(generate_data.prompt)));
      },
    );
    stop_listening = () => event.stop();

    timeout_ref.value = setTimeout(() => {
      finish(() => reject(new Error('提取提示词超时。')));
    }, PROMPT_EXTRACTION_TIMEOUT_MS);

    try {
      Promise.resolve(SillyTavern.generate('normal', {}, true))
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
    toastr.error(`全局变量 ${FORMAT_APPEND_VARIABLE} 为空。`, FORMAT_COMPLETION_NAME);
    return;
  }

  is_completing = true;
  try {
    const extracted_prompts = await extractPromptOnce();
    const result = await generateRaw({
      ordered_prompts: [...extracted_prompts, { role: 'user', content: append_prompt }],
    });
    const generated_content = typeof result === 'string' ? result : result.content;
    if (!generated_content.trim()) {
      toastr.warning('格式补全没有生成内容。', FORMAT_COMPLETION_NAME);
      return;
    }
    const append_content = extractDreamAppendFormat(generated_content);
    if (!append_content) {
      toastr.error('格式补全失败，未能提取到格式内容。', FORMAT_COMPLETION_NAME);
      return;
    }

    const current_message = getChatMessages(latest_message.message_id)[0];
    if (!current_message) {
      toastr.error('原角色输出楼层不存在，无法追加格式补全内容。', FORMAT_COMPLETION_NAME);
      return;
    }

    await setChatMessages(
      [
        {
          message_id: latest_message.message_id,
          message: `${current_message.message}\n${append_content}`,
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
