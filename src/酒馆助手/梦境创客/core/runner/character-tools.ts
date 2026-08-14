import { tool } from 'ai';
import { z } from 'zod';
import type { TavernBridge, TavernCharacterSummary } from '../tavern/bridge';
import type { RunnerTool, ToolConfirmation } from './tools';

export type CharacterRunnerToolOptions = {
  approvalMode: () => 'full' | 'manual' | 'yolo';
  beforeClose?: () => Promise<void>;
  onChanged?: () => Promise<void>;
};

export function createCharacterRunnerTools(
  bridge: TavernBridge,
  options: CharacterRunnerToolOptions,
): RunnerTool[] {
  return [
    {
      confirmation: (input, toolCallId): ToolConfirmation | undefined => {
        if (options.approvalMode() !== 'manual') return undefined;
        const value = input as { action?: string; characterId?: string };
        if (value.action === 'list' || value.action === 'get_active') return undefined;
        return {
          description:
            value.action === 'close'
              ? '将关闭酒馆当前聊天并卸载角色工作区。'
              : `将切换酒馆当前角色并重新挂载角色工作区：${value.characterId ?? ''}`,
          intent: input,
          risk: 'ordinary',
          toolCallId,
          toolName: 'manage_character',
        };
      },
      definition: tool({
        description:
          '全局会话中的角色导航工具。可列出角色、查看当前角色、按稳定avatar id打开角色，或关闭当前聊天。角色工作区和绑定世界书会随之动态挂载或卸载。',
        inputSchema: z.discriminatedUnion('action', [
          z.object({ action: z.literal('list'), query: z.string().optional() }),
          z.object({ action: z.literal('get_active') }),
          z.object({ action: z.literal('open'), characterId: z.string().min(1) }),
          z.object({ action: z.literal('close') }),
        ]),
      }),
      execute: async input => {
        const value = input as {
          action: 'close' | 'get_active' | 'list' | 'open';
          characterId?: string;
          query?: string;
        };
        if (value.action === 'list') {
          const query = value.query?.trim().toLocaleLowerCase();
          return bridge.listCharacters().filter(
            item =>
              !query ||
              item.name.toLocaleLowerCase().includes(query) ||
              item.avatarId.toLocaleLowerCase().includes(query),
          );
        }
        if (value.action === 'get_active') {
          const activeId = bridge.getCurrentCharacterId();
          return (
            bridge.listCharacters().find(item => String(item.index) === activeId || item.avatarId === activeId) ?? null
          );
        }
        if (value.action === 'close') {
          await options.beforeClose?.();
          await bridge.closeCurrentChat();
          await options.onChanged?.();
          return { closed: true };
        }
        const matches: TavernCharacterSummary[] = bridge
          .listCharacters()
          .filter(item => item.avatarId === value.characterId);
        if (matches.length === 0) throw new Error(`角色不存在：${value.characterId}`);
        if (matches.length > 1) throw new Error(`角色ID不唯一：${value.characterId}`);
        await bridge.selectCharacterById(matches[0].index);
        await options.onChanged?.();
        return { opened: matches[0] };
      },
      name: 'manage_character',
      readonly: false,
    },
  ];
}
