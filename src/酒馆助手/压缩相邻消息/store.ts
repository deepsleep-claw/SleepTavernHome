import { registerAsUniqueScript } from '@util/script';

export const WorldbookExtractionPositionOrder = [
  'before_character_definition',
  'after_character_definition',
  'before_example_messages',
  'after_example_messages',
  'before_author_note',
  'after_author_note',
  'at_depth',
] as const;

const WorldbookExtractionPosition = z.enum(WorldbookExtractionPositionOrder);
const WorldbookExtractionPositionOrderSetting = z
  .array(WorldbookExtractionPosition)
  .default(() => [...WorldbookExtractionPositionOrder])
  .catch(() => [...WorldbookExtractionPositionOrder])
  .transform(order => [
    ..._.uniq(order.filter(position => WorldbookExtractionPositionOrder.includes(position))),
    ...WorldbookExtractionPositionOrder.filter(position => !order.includes(position)),
  ]);

const OldSettings = z
  .object({
    seperator: z
      .object({
        type: z.enum(['space', 'newline', 'double newline', 'custom']),
        value: z.string(),
      })
      .transform(data => {
        switch (data.type) {
          case 'space':
            data.value = ' ';
            break;
          case 'newline':
            data.value = '\n';
            break;
          case 'double newline':
            data.value = '\n\n';
            break;
          case 'custom':
            break;
        }
        return data;
      }),
    put_system_injection_after_chat_history: z.boolean(),
    on_chat_history: z.object({
      type: z.enum(['mixin', 'seperate', 'squash']),

      squash_role: z.enum(['user', 'assistant', 'system']),
      user_prefix: z.string(),
      user_suffix: z.string(),
      assistant_prefix: z.string(),
      assistant_suffix: z.string(),
      system_prefix: z.string(),
      system_suffix: z.string(),
    }),
    stop_string: z.string(),
  })
  .transform(data => {
    return Settings.decode({
      delimiter: data.seperator,
      stop_string: data.stop_string,
      depth_injection: {
        threshold: 10,
        above: {
          enabled: data.put_system_injection_after_chat_history,
          type: 'exclude',
          placeholder: `{{压缩相邻消息::above_dx}}`,
        },
        below: {
          enabled: data.put_system_injection_after_chat_history,
          type: 'exclude',
          placeholder: `{{压缩相邻消息::below_dx}}`,
        },
      },
      chat_history: {
        ...data.on_chat_history,
        type: data.on_chat_history.type === 'squash' ? 'squash_into_one' : 'squash_nearby',
      },
      entry_processing: {
        mode: 'none',
        worldbook: {
          aggressive_green_cache: {
            enabled: false,
          },
          constant: {
            enabled: true,
            placeholder: '{{压缩相邻消息::lora_constant}}',
          },
          keyed: {
            enabled: true,
            placeholder: '{{压缩相邻消息::lora_key}}',
          },
          position_order: [...WorldbookExtractionPositionOrder],
        },
      },
    } satisfies z.infer<typeof Settings>);
  });

export type Settings = z.infer<typeof Settings>;
export const Settings = z
  .object({
    delimiter: z
      .object({
        type: z.enum(['space', 'newline', 'double newline', 'custom']).default('double newline'),
        value: z.string().default('\n\n'),
      })
      .prefault({})
      .transform(data => {
        switch (data.type) {
          case 'space':
            data.value = ' ';
            break;
          case 'newline':
            data.value = '\n';
            break;
          case 'double newline':
            data.value = '\n\n';
            break;
          case 'custom':
            break;
        }
        return data;
      }),

    stop_string: z
      .string()
      .default('/(?:</observed_pice>|<\\|im_end\\|>)/')
      .catch('/(?:</observed_pice>|<\\|im_end\\|>)/'),

    depth_injection: z
      .object({
        threshold: z.number().int().min(1).default(10).catch(10),
        above: z
          .object({
            enabled: z.boolean().default(false),
            type: z.enum(['exclude', 'placeholder']).default('exclude'),
            placeholder: z.string().default('{{压缩相邻消息::above_dx}}'),
          })
          .prefault({}),
        below: z
          .object({
            enabled: z.boolean().default(false),
            type: z.enum(['exclude', 'placeholder']).default('exclude'),
            placeholder: z.string().default('{{压缩相邻消息::below_dx}}'),
          })
          .prefault({}),
      })
      .prefault({}),

    entry_processing: z
      .object({
        mode: z.enum(['none', 'depth', 'worldbook']).default('none').catch('none'),
        worldbook: z
          .object({
            aggressive_green_cache: z
              .object({
                enabled: z.boolean().default(false).catch(false),
              })
              .prefault({}),
            constant: z
              .object({
                enabled: z.boolean().default(true).catch(true),
                placeholder: z.string().default('{{压缩相邻消息::lora_constant}}'),
              })
              .prefault({}),
            keyed: z
              .object({
                enabled: z.boolean().default(true).catch(true),
                placeholder: z.string().default('{{压缩相邻消息::lora_key}}'),
              })
              .prefault({}),
            position_order: WorldbookExtractionPositionOrderSetting,
          })
          .prefault({}),
      })
      .prefault({}),

    chat_history: z
      .object({
        type: z.enum(['squash_nearby', 'squash_into_one']).default('squash_into_one'),

        squash_role: z.enum(['user', 'assistant', 'system']).default('assistant'),
        user_prefix: z.string().default('<observed_piece class="下段剧情指令">\n'),
        user_suffix: z.string().default('\n</observed_piece>'),
        assistant_prefix: z.string().default('<observed_piece class="剧情">\n'),
        assistant_suffix: z.string().default('\n</observed_piece>'),
        system_prefix: z.string().default('<observed_piece class="设定">\n'),
        system_suffix: z.string().default('\n</observed_piece>'),
      })
      .prefault({}),
  })
  .prefault({});

function parseSettings(variables: Record<string, any>): Settings {
  const result = (_.has(variables, 'seperator') ? OldSettings : Settings).safeParse(variables);
  if (result.success) {
    return result.data;
  }
  console.warn('[压缩相邻消息] 设置读取失败, 已使用默认设置', result.error);
  return Settings.parse({});
}

export const useSettingsStore = defineStore('压缩相邻消息', () => {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const settings = ref(parseSettings(variables));

  const should_enable = ref<boolean>(false);
  registerAsUniqueScript('压缩相邻消息').listenPreferenceState(preferred_script_id => {
    should_enable.value = preferred_script_id === getScriptId();
  });

  watchEffect(() => {
    replaceVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
  });

  const useEscapedNewline = (path: string) => {
    return computed({
      get: () => _.get(settings.value, path).replace(/\n/g, '\\n'),
      set: value => _.set(settings.value, path, value.replace(/\\n/g, '\n')),
    });
  };

  return { settings, should_enable, useEscapedNewline };
});
