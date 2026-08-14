import { tool } from 'ai';
import { z } from 'zod';
import { TavernChatWorkspace } from '../tavern/chat-workspace';
import { isBinaryWorkspaceFile } from '../workspace/types';
import type { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import type { RunnerTool, ToolConfirmation } from './tools';

export type TavernChatRunnerToolOptions = {
  approvalMode?: () => 'full' | 'manual' | 'yolo';
  beforeGeneration?: () => Promise<boolean>;
  isYolo?: () => boolean;
  resolveFileUrl?: (fileId: string) => string | undefined;
};

function confirmation(
  options: TavernChatRunnerToolOptions,
  input: unknown,
  toolCallId: string,
  toolName: string,
  highRisk = false,
): ToolConfirmation | undefined {
  const mode = options.approvalMode?.() ?? (options.isYolo?.() ? 'yolo' : 'manual');
  if (mode === 'full' || (mode === 'yolo' && !highRisk)) return undefined;
  return {
    description: '将直接操作当前角色的酒馆聊天记录；聊天改动不能用梦境创客Undo。',
    intent: input,
    risk: highRisk ? 'high' : 'ordinary',
    toolCallId,
    toolName,
  };
}

async function authorizeAndRun<T>(
  workspace: TavernChatWorkspace,
  toolCallId: string,
  action: () => Promise<T>,
): Promise<T | { idempotent: true }> {
  workspace.authorizeRun();
  const result = await workspace.executeOnce(toolCallId, action);
  return result.executed ? result.value! : { idempotent: true };
}

async function beforeGeneration(options: TavernChatRunnerToolOptions): Promise<void> {
  if (options.beforeGeneration && !(await options.beforeGeneration())) {
    throw new Error('GENERATION_PREPARATION_REJECTED：生成前准备未通过，本次酒馆生成未执行。');
  }
}

async function runGeneration<T>(
  workspace: TavernChatWorkspace,
  signal: AbortSignal,
  action: () => Promise<T>,
): Promise<T> {
  const interrupted = new Error('用户打断了酒馆生成。') as Error & { code: string };
  interrupted.code = 'USER_INTERRUPTED';
  const stop = () => workspace.stopGeneration();
  if (signal.aborted) {
    stop();
    throw interrupted;
  }
  signal.addEventListener('abort', stop, { once: true });
  try {
    const result = await action();
    if (signal.aborted) throw interrupted;
    return result;
  } catch (error) {
    if (signal.aborted) throw interrupted;
    throw error;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

export function createTavernChatRunnerTools(
  repository: MemoryWorkspaceRepository,
  workspace: TavernChatWorkspace,
  options: TavernChatRunnerToolOptions = {},
): RunnerTool[] {
  const mutationConfirmation = (toolName: string, highRisk?: (input: unknown) => boolean) =>
    (input: unknown, toolCallId: string) =>
      confirmation(options, input, toolCallId, toolName, highRisk?.(input) ?? false);
  const tools: RunnerTool[] = [
    {
      definition: tool({
        description:
          '列出当前角色卡的全部酒馆聊天文件。id存在表示已挂载到/character/chats；未挂载的聊天需先用switch动作按ref切换。',
        inputSchema: z.object({}),
      }),
      execute: async () => ({ chats: await workspace.listAvailable() }),
      name: 'list_tavern_chats',
      readonly: true,
    },
    {
      confirmation: mutationConfirmation('create_tavern_chat'),
      definition: tool({
        description: '用明确且完整的名称新建酒馆聊天并切换过去。名称重名会失败，不会自动添加前缀或版本号。',
        inputSchema: z.object({ name: z.string().min(1) }),
      }),
      execute: async (input, toolCallId) =>
        authorizeAndRun(workspace, toolCallId, async () => {
          const mount = await workspace.create((input as { name: string }).name, repository);
          return { active: true, chatId: mount.alias, name: mount.name };
        }),
      name: 'create_tavern_chat',
      readonly: false,
    },
    {
      confirmation: mutationConfirmation('switch_tavern_chat'),
      definition: tool({
        description:
          '切换到已挂载聊天的短ID，或按酒馆聊天ref切换并挂载。若list_tavern_chats结果尚无id，请把ref传入chatId。',
        inputSchema: z.object({ chatId: z.string().min(1) }),
      }),
      execute: async (input, toolCallId) =>
        authorizeAndRun(workspace, toolCallId, async () => {
          const value = (input as { chatId: string }).chatId;
          let chatId = value;
          if (!/^c\d+$/u.test(value)) {
            const available = await workspace.listAvailable();
            const target = available.find(chat => chat.ref === value);
            if (!target) throw new Error(`聊天不存在：${value}`);
            if (target.id) chatId = target.id;
            else {
              const createdMount = await workspace.mountAndSwitch(target.ref, target.name, repository);
              return { active: true, chatId: createdMount.alias, name: createdMount.name };
            }
          }
          const mount = await workspace.switch(chatId, repository);
          return { active: true, chatId: mount.alias, name: mount.name };
        }),
      name: 'switch_tavern_chat',
      readonly: false,
    },
    {
      confirmation: mutationConfirmation('send_tavern_message'),
      definition: tool({
        description:
          '在指定聊天追加用户消息，调用酒馆原生生成并等待完成。images只接受工作区内已上传的图片路径，不接受普通文件。',
        inputSchema: z.object({
          chatId: z.string().min(1),
          images: z.array(z.string().min(1)).optional(),
          message: z.string().min(1),
        }),
      }),
      execute: async (input, toolCallId, context) =>
        authorizeAndRun(workspace, toolCallId, async () => {
          const value = input as { chatId: string; images?: string[]; message: string };
          await workspace.prepareGeneration(value.chatId, 'send', repository);
          await beforeGeneration(options);
          const images = await Promise.all(
            (value.images ?? []).map(async path => {
              const file = await repository.read(path);
              if (!isBinaryWorkspaceFile(file) || !file.mediaType.startsWith('image/')) {
                throw new Error(`不是可发送的工作区图片：${path}`);
              }
              const url = options.resolveFileUrl?.(file.external!.fileId);
              if (!url) throw new Error(`图片的酒馆文件引用已经丢失：${path}`);
              return { title: path.split('/').at(-1) ?? 'image', url };
            }),
          );
          await runGeneration(workspace, context?.abortSignal ?? new AbortController().signal, () =>
            workspace.sendAndGenerate(value.chatId, value.message, images, repository),
          );
          return { chatId: value.chatId, completed: true, images: images.length };
        }),
      name: 'send_tavern_message',
      readonly: false,
    },
    {
      confirmation: mutationConfirmation('generate_tavern_reply'),
      definition: tool({
        description: '不追加用户消息，直接为最新user楼层调用酒馆原生生成并等待完成。',
        inputSchema: z.object({ chatId: z.string().min(1) }),
      }),
      execute: async (input, toolCallId, context) =>
        authorizeAndRun(workspace, toolCallId, async () => {
          const chatId = (input as { chatId: string }).chatId;
          await workspace.prepareGeneration(chatId, 'reply', repository);
          await beforeGeneration(options);
          await runGeneration(workspace, context?.abortSignal ?? new AbortController().signal, () =>
            workspace.generateReply(chatId, repository),
          );
          return { chatId, completed: true };
        }),
      name: 'generate_tavern_reply',
      readonly: false,
    },
    {
      confirmation: mutationConfirmation(
        'switch_tavern_swipe',
        input => (input as { target?: unknown } | undefined)?.target === 'generate',
      ),
      definition: tool({
        description:
          '操作最新assistant楼层的Swipe。target为0基编号时直接选择现有Swipe；传generate时调用酒馆原生机制生成新Swipe并等待完成。',
        inputSchema: z.object({
          chatId: z.string().min(1),
          target: z.union([z.number().int().min(0), z.literal('generate')]),
        }),
      }),
      execute: async (input, toolCallId, context) =>
        authorizeAndRun(workspace, toolCallId, async () => {
          const value = input as { chatId: string; target: number | 'generate' };
          if (value.target === 'generate') {
            await workspace.prepareGeneration(value.chatId, 'swipe', repository);
            await beforeGeneration(options);
          }
          if (value.target === 'generate') {
            await runGeneration(workspace, context?.abortSignal ?? new AbortController().signal, () =>
              workspace.switchSwipe(value.chatId, value.target, repository),
            );
          } else {
            await workspace.switchSwipe(value.chatId, value.target, repository);
          }
          return { chatId: value.chatId, selected: value.target };
        }),
      name: 'switch_tavern_swipe',
      readonly: false,
    },
    {
      confirmation: mutationConfirmation('truncate_tavern_chat', () => true),
      definition: tool({
        description:
          '按酒馆语义从指定0基楼层开始截断：该楼层及其后的所有消息都会立即删除。不能只抽掉中间一层，也没有梦境创客Undo。',
        inputSchema: z.object({ chatId: z.string().min(1), fromMessageId: z.number().int().min(0) }),
      }),
      execute: async (input, toolCallId) =>
        authorizeAndRun(workspace, toolCallId, async () => {
          const value = input as { chatId: string; fromMessageId: number };
          await workspace.truncate(value.chatId, value.fromMessageId, repository);
          return { chatId: value.chatId, fromMessageId: value.fromMessageId, truncated: true };
        }),
      name: 'truncate_tavern_chat',
      readonly: false,
    },
  ];
  const byName = new Map(tools.map(item => [item.name, item]));
  const manageTargets = {
    create: 'create_tavern_chat',
    list: 'list_tavern_chats',
    switch: 'switch_tavern_chat',
    truncate: 'truncate_tavern_chat',
  } as const;
  const manage: RunnerTool = {
    confirmation: async (input, toolCallId) => {
      const { action, ...payload } = input as Record<string, unknown> & { action: keyof typeof manageTargets };
      const result = await byName.get(manageTargets[action])?.confirmation?.(payload, toolCallId);
      return result ? { ...result, toolName: 'manage_tavern_chat' } : undefined;
    },
    definition: tool({
      description:
        '管理酒馆聊天。list列出；create新建并切换；switch切换；truncate按酒馆语义从指定0基楼层起删除该楼层及之后全部消息。',
      inputSchema: z
        .object({
          action: z.enum(['list', 'create', 'switch', 'truncate']),
          chatId: z.string().min(1).optional().describe('switch、truncate时必填'),
          fromMessageId: z.number().int().min(0).optional().describe('truncate时必填的0基楼层'),
          name: z.string().min(1).optional().describe('create时必填且不可重名的聊天名称'),
        })
        .superRefine((value, context) => {
          if (value.action === 'create' && !value.name) {
            context.addIssue({ code: 'custom', message: 'create需要name。', path: ['name'] });
          }
          if ((value.action === 'switch' || value.action === 'truncate') && !value.chatId) {
            context.addIssue({ code: 'custom', message: `${value.action}需要chatId。`, path: ['chatId'] });
          }
          if (value.action === 'truncate' && value.fromMessageId === undefined) {
            context.addIssue({ code: 'custom', message: 'truncate需要fromMessageId。', path: ['fromMessageId'] });
          }
        }),
    }),
    execute: async (input, toolCallId, context) => {
      const { action, ...payload } = input as Record<string, unknown> & { action: keyof typeof manageTargets };
      const target = byName.get(manageTargets[action]);
      if (!target) throw new Error(`不支持的酒馆聊天动作：${String(action)}`);
      return target.execute(payload, toolCallId, context);
    },
    name: 'manage_tavern_chat',
    readonly: false,
  };
  const generateTarget = byName.get('generate_tavern_reply')!;
  const swipeTarget = byName.get('switch_tavern_swipe')!;
  const generate: RunnerTool = {
    confirmation: async (input, toolCallId) => {
      const value = input as { chatId: string; mode: 'generate' | 'swipe'; target?: number | 'generate' };
      const target = value.mode === 'swipe' ? swipeTarget : generateTarget;
      const payload = value.mode === 'swipe' ? { chatId: value.chatId, target: value.target } : { chatId: value.chatId };
      const result = await target.confirmation?.(payload, toolCallId);
      return result ? { ...result, toolName: 'generate_tavern_reply' } : undefined;
    },
    definition: tool({
      description:
        '操作酒馆生成。mode=generate时为最新user楼层生成回复；mode=swipe时选择现有0基Swipe，或用target=generate生成新Swipe。',
      inputSchema: z
        .object({
          chatId: z.string().min(1),
          mode: z.enum(['generate', 'swipe']),
          target: z.union([z.number().int().min(0), z.literal('generate')]).optional().describe('mode=swipe时必填'),
        })
        .superRefine((value, context) => {
          if (value.mode === 'swipe' && value.target === undefined) {
            context.addIssue({ code: 'custom', message: 'swipe需要target。', path: ['target'] });
          }
        }),
    }),
    execute: async (input, toolCallId, context) => {
      const value = input as { chatId: string; mode: 'generate' | 'swipe'; target?: number | 'generate' };
      return value.mode === 'swipe'
        ? swipeTarget.execute({ chatId: value.chatId, target: value.target }, toolCallId, context)
        : generateTarget.execute({ chatId: value.chatId }, toolCallId, context);
    },
    name: 'generate_tavern_reply',
    readonly: false,
  };
  return [manage, byName.get('send_tavern_message')!, generate];
}
