export type ComposerCommandId = 'help' | 'compact' | 'model' | 'effort' | 'skill' | 'context' | 'resume' | 'stop';
export type ComposerCommand = {
  id: ComposerCommandId;
  aliases: readonly string[];
  label: string;
  description: string;
  usage: string;
  argument: 'none' | 'text' | 'model' | 'effort' | 'skill';
  icon: string;
};

export const COMPOSER_COMMANDS: readonly ComposerCommand[] = [
  {
    id: 'help',
    aliases: ['帮助'],
    label: '指令帮助',
    description: '查看指令与参数用法',
    usage: '/help',
    argument: 'none',
    icon: 'fa-regular fa-circle-question',
  },
  {
    id: 'compact',
    aliases: ['压缩', 'compress'],
    label: '压缩上下文',
    description: '整理旧对话，可指定要保留的重点',
    usage: '/compact [保留重点]',
    argument: 'text',
    icon: 'fa-solid fa-compress',
  },
  {
    id: 'model',
    aliases: ['模型'],
    label: '切换模型',
    description: '选择当前会话使用的模型',
    usage: '/model <模型>',
    argument: 'model',
    icon: 'fa-solid fa-microchip',
  },
  {
    id: 'effort',
    aliases: ['推理', 'variant'],
    label: '推理强度',
    description: '选择当前模型支持的推理档位',
    usage: '/effort <档位>',
    argument: 'effort',
    icon: 'fa-solid fa-brain',
  },
  {
    id: 'skill',
    aliases: ['技能'],
    label: '调用 Skill',
    description: '选择已挂载的 Skill，再填写任务',
    usage: '/skill <Skill> <任务>',
    argument: 'skill',
    icon: 'fa-solid fa-wand-magic-sparkles',
  },
  {
    id: 'context',
    aliases: ['上下文'],
    label: '查看上下文',
    description: '打开上下文占用与用量面板',
    usage: '/context',
    argument: 'none',
    icon: 'fa-solid fa-gauge-high',
  },
  {
    id: 'resume',
    aliases: ['继续'],
    label: '从中断处继续',
    description: '恢复当前会话的未完成任务',
    usage: '/resume',
    argument: 'none',
    icon: 'fa-solid fa-play',
  },
  {
    id: 'stop',
    aliases: ['停止'],
    label: '停止当前任务',
    description: '停止当前会话正在执行的任务',
    usage: '/stop',
    argument: 'none',
    icon: 'fa-solid fa-stop',
  },
];

export function findComposerCommand(name: string): ComposerCommand | undefined {
  const normalized = name.replace(/^\//u, '').normalize('NFC').toLocaleLowerCase();
  return COMPOSER_COMMANDS.find(command => command.id === normalized || command.aliases.includes(normalized));
}

export function parseComposerCommand(
  text: string,
): { command?: ComposerCommand; name: string; args: string } | undefined {
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match) return undefined;
  return { command: findComposerCommand(match[1]), name: match[1], args: (match[2] ?? '').trim() };
}

export type ComposerCommandContext = {
  status?: string;
  busy?: boolean;
  hasModels: boolean;
  supportsReasoning: boolean;
  skillCount: number;
  compactionEnabled: boolean;
};

export function commandDisabledReason(command: ComposerCommand, context: ComposerCommandContext): string | undefined {
  const running = ['running', 'waiting-approval'].includes(context.status ?? '');
  if (command.id === 'help' || command.id === 'context') return;
  if (command.id === 'stop') return running ? undefined : '当前没有正在运行的任务';
  if (running) return '请先停止当前任务';
  if (context.busy) return '正在处理上一项操作';
  if (command.id === 'resume' && !['abnormal', 'failed', 'stopped', 'context-exhausted'].includes(context.status ?? ''))
    return '当前没有可继续的中断任务';
  if (command.id === 'compact' && !context.compactionEnabled) return '当前助手未启用上下文压缩';
  if (command.id === 'model' && !context.hasModels) return '请先在 API 设置中启用模型';
  if (command.id === 'effort' && !context.supportsReasoning) return '当前模型没有可选的推理档位';
  if (command.id === 'skill' && context.skillCount === 0) return '当前助手没有挂载 Skill';
  return undefined;
}

export function assertCommandArguments(command: ComposerCommand, args: string): void {
  if (command.argument === 'none' && args) throw new Error(`此指令不接受参数，用法：${command.usage}`);
  if (command.id !== 'skill' && args.length > 4000) throw new Error('指令参数过长，请控制在 4000 字符以内。');
}

export function suggestionScore(text: string, query: string): number | undefined {
  const candidate = text.normalize('NFC').toLocaleLowerCase();
  const needle = query.trim().normalize('NFC').toLocaleLowerCase();
  if (!needle) return 0;
  if (candidate.startsWith(needle)) return candidate.length - needle.length;
  const index = candidate.indexOf(needle);
  if (index >= 0) return 100 + index;
  let cursor = 0;
  let score = 200;
  for (const character of needle) {
    const found = candidate.indexOf(character, cursor);
    if (found < 0) return;
    score += found - cursor;
    cursor = found + 1;
  }
  return score;
}
