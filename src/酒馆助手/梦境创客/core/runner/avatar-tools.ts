import { tool } from 'ai';
import { z } from 'zod';
import { personaWorkspacePath } from '../workspace/persona-path';
import type { TavernBridge } from '../tavern/bridge';
import type { LiveWorkspaceRepository } from '../workspace/live-repository';
import type { RunnerTool } from './tools';

export function createAvatarRunnerTools(
  repository: LiveWorkspaceRepository,
  bridge: TavernBridge,
  approvalMode: () => 'full' | 'manual' | 'yolo',
): RunnerTool[] {
  return [
    {
      confirmation: (input, toolCallId) =>
        approvalMode() === 'manual'
          ? {
              description: `将设置${(input as { target?: string }).target === 'user' ? 'User Persona' : '当前角色'}头像。`,
              intent: input,
              risk: 'ordinary' as const,
              toolCallId,
              toolName: 'set_avatar',
            }
          : undefined,
      definition: tool({
        description:
          '把/files或/character/files中的图片设为当前角色或指定User头像。头像虚拟文件只读，不能用write_file直接覆盖。',
        inputSchema: z.object({
          sourcePath: z.string().min(1),
          target: z.enum(['character', 'user']),
          userName: z.string().min(1).optional().describe('User的avatar_id，或唯一的名称。重名时使用avatar_id。'),
        }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { sourcePath: string; target: 'character' | 'user'; userName?: string };
        if (!/^\/(?:files|character\/files)\//u.test(value.sourcePath)) {
          throw new Error('头像来源必须位于/files或/character/files。');
        }
        let targetPath: string;
        if (value.target === 'character') {
          if (!bridge.getCurrentCharacterId()) throw new Error('当前没有打开角色卡。');
          targetPath = '/character/avatar.png';
        } else {
          if (!value.userName) throw new Error('target=user时必须提供userName。');
          const persona = bridge.getPersona(value.userName);
          targetPath = personaWorkspacePath(persona.name, persona.avatar_id, true);
        }
        await repository.replaceReadonlyBinary(targetPath, value.sourcePath, toolCallId);
        return { sourcePath: value.sourcePath, target: targetPath, updated: true };
      },
      name: 'set_avatar',
      readonly: false,
    },
  ];
}
