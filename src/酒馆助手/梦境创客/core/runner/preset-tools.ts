import { tool } from 'ai';
import { z } from 'zod';
import type { TavernBridge } from '../tavern/bridge';
import { canonicalEqual } from '../transaction/canonical';
import type { LiveWorkspaceRepository } from '../workspace/live-repository';
import type { RunnerTool, ToolConfirmation } from './tools';

export type PresetRunnerToolOptions = {
  approvalMode: () => 'full' | 'manual' | 'yolo';
  mountedPresets: Set<string>;
};

function confirmation(
  options: PresetRunnerToolOptions,
  input: unknown,
  toolCallId: string,
): ToolConfirmation | undefined {
  if (options.approvalMode() !== 'manual') return undefined;
  const action = (input as { action?: string }).action;
  if (action === 'search' || action === 'mount' || action === 'unmount') return undefined;
  return {
    description: `将执行酒馆预设操作：${action ?? '未知操作'}`,
    intent: input,
    risk: 'ordinary',
    toolCallId,
    toolName: 'manage_preset',
  };
}

export function createPresetRunnerTools(
  repository: LiveWorkspaceRepository,
  bridge: TavernBridge,
  options: PresetRunnerToolOptions,
): RunnerTool[] {
  return [{
    confirmation: (input, toolCallId) => confirmation(options, input, toolCallId),
    definition: tool({
      description:
        '搜索、挂载、卸载、切换或保存酒馆预设。编辑当前预设请读写/presets/current；非当前预设挂载到/presets/library且只读。',
      // 部分 OpenAI-compatible Responses 实现拒绝顶层 anyOf/oneOf，要求每个工具的
      // JSON Schema 顶层都明确为 object。这里使用单一对象，并在各 action 分支校验必填项。
      inputSchema: z.object({
        action: z.enum(['search', 'mount', 'unmount', 'switch', 'save', 'save_as']),
        force: z.boolean().optional().describe('switch 时必填；为 true 时允许丢弃当前未保存修改。'),
        name: z.string().min(1).optional().describe('mount、unmount、switch、save_as 时必填的预设名。'),
        overwrite: z.boolean().optional().describe('save_as 时是否允许覆盖同名预设。'),
        query: z.string().optional().describe('search 时可选的名称筛选文本。'),
      }),
    }),
    execute: async input => {
      const value = input as {
        action: 'mount' | 'save' | 'save_as' | 'search' | 'switch' | 'unmount';
        force?: boolean;
        name?: string;
        overwrite?: boolean;
        query?: string;
      };
      const requireName = (): string => {
        if (!value.name?.trim()) throw new Error(`${value.action}操作必须提供非空name。`);
        return value.name;
      };
      if (value.action === 'search') {
        const query = value.query?.trim().toLocaleLowerCase() ?? '';
        return {
          loaded: bridge.getLoadedPresetName(),
          presets: bridge.getPresetNames().filter(name => !query || name.toLocaleLowerCase().includes(query)),
        };
      }
      if (value.action === 'mount') {
        const name = requireName();
        if (!bridge.getPresetNames().includes(name)) throw new Error(`预设不存在：${name}`);
        options.mountedPresets.add(name);
        await repository.reload();
        return { mounted: name, path: `/presets/library/${name}` };
      }
      if (value.action === 'unmount') {
        const name = requireName();
        options.mountedPresets.delete(name);
        await repository.reload();
        return { unmounted: name };
      }
      if (value.action === 'switch') {
        const name = requireName();
        if (value.force === undefined) throw new Error('switch操作必须显式提供force。');
        const loaded = bridge.getLoadedPresetName();
        const dirty = Boolean(loaded && bridge.getPresetNames().includes(loaded)) &&
          !canonicalEqual(bridge.getPreset('in_use'), bridge.getPreset(loaded));
        if (dirty && !value.force) {
          throw new Error('当前预设有未保存修改；请先save/save_as，或显式设置force=true丢弃修改后切换。');
        }
        await bridge.loadPreset(name);
        await repository.reload();
        return { discardedUnsavedChanges: dirty, switched: name };
      }
      if (value.action === 'save') {
        const loaded = bridge.getLoadedPresetName();
        if (!loaded || !bridge.getPresetNames().includes(loaded)) {
          throw new Error('当前in_use没有可写回的已命名预设，请使用save_as。');
        }
        await bridge.replacePreset(loaded, bridge.getPreset('in_use'));
        await repository.reload();
        return { saved: loaded };
      }
      if (value.action !== 'save_as') throw new Error(`无法识别的预设操作：${(value as { action: string }).action}`);
      const name = requireName();
      const exists = bridge.getPresetNames().includes(name);
      if (exists && value.overwrite !== true) {
        throw new Error(`预设已存在：${name}。确实覆盖时请显式设置overwrite=true。`);
      }
      await bridge.createPreset(name, bridge.getPreset('in_use'), value.overwrite === true);
      await bridge.loadPreset(name);
      await repository.reload();
      return { overwritten: exists, savedAs: name, switched: true };
    },
    name: 'manage_preset',
    readonly: false,
  }];
}
