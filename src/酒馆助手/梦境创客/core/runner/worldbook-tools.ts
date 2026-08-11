import { klona } from 'klona';
import { tool } from 'ai';
import { z } from 'zod';
import { materializeCardWorkspace, projectWorldbookFiles } from '../mapping/card-workspace-mapper';
import { encodeWorkspaceSegment, parseYamlObject, serializeYaml } from '../mapping/serde';
import type { CardWorkspaceState, WorldbookData } from '../mapping/types';
import type { TavernBridge } from '../tavern/bridge';
import { readStandaloneWorldbook } from '../tavern/state-reader';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import type { RunnerTool, ToolConfirmation } from './tools';

export type WorldbookRunnerToolOptions = {
  getBaseState: () => CardWorkspaceState;
  chatBindingConfirmation?: (input: unknown, toolCallId: string) => ToolConfirmation | undefined;
  setChatBinding?: (chatId: string, worldbook: string | null, toolCallId: string) => Promise<void>;
};

function normalizedName(value: string, label = '世界书名称'): string {
  const name = value.trim();
  if (!name) throw new Error(`${label}不能为空。`);
  if (name.includes('/') || name.includes('\\')) throw new Error(`${label}不能包含路径分隔符。`);
  return name;
}

function workingBooks(repository: MemoryWorkspaceRepository, base: CardWorkspaceState): WorldbookData[] {
  return materializeCardWorkspace(base, repository.snapshot()).state.worldbooks;
}

function editableBookPath(name: string): string {
  return `/worldbooks/${encodeWorkspaceSegment(name)}/book.yaml`;
}

async function hasFile(repository: MemoryWorkspaceRepository, path: string): Promise<boolean> {
  try {
    await repository.read(path);
    return true;
  } catch {
    return false;
  }
}

async function loadBook(
  repository: MemoryWorkspaceRepository,
  bridge: TavernBridge,
  base: CardWorkspaceState,
  name: string,
): Promise<WorldbookData> {
  const projected = workingBooks(repository, base).find(book => book.name === name);
  if (projected) return projected;
  if (!bridge.getWorldbookNames().includes(name)) throw new Error(`世界书不存在：${name}`);
  return readStandaloneWorldbook(bridge, name);
}

async function ensureEditableBook(
  repository: MemoryWorkspaceRepository,
  bridge: TavernBridge,
  base: CardWorkspaceState,
  name: string,
): Promise<void> {
  if (await hasFile(repository, editableBookPath(name))) return;
  const book = await loadBook(repository, bridge, base, name);
  if (!book.roundTripSafe) throw new Error(`世界书“${name}”无法无损读取，不能绑定为可编辑资源。`);
  const editable = { ...klona(book), writable: true };
  // 这是酒馆中已经存在、只是本会话刚发现的资源：把它同时加入Base和投影，
  // 否则三方Diff会把“绑定现有世界书”误判成“新建同名世界书”。
  base.worldbooks.push(klona(editable));
  const root = `/worldbooks/${encodeWorkspaceSegment(name)}`;
  repository.replaceProjection(root, projectWorldbookFiles(editable, { readonly: false }));
}

function cloneBook(source: WorldbookData, name: string): WorldbookData {
  return {
    ...klona(source),
    entries: source.entries.map(entry => {
      const identity = crypto.randomUUID();
      return { ...klona(entry), resourceId: `worldbook-entry:${identity}`, uid: `temp:${identity}` };
    }),
    name,
    resourceId: `worldbook:${crypto.randomUUID()}`,
    roundTripSafe: true,
    writable: true,
  };
}

function knownNames(repository: MemoryWorkspaceRepository, bridge: TavernBridge, base: CardWorkspaceState): Set<string> {
  return new Set([...bridge.getWorldbookNames(), ...workingBooks(repository, base).map(book => book.name)]);
}

const bindingSchema = z
  .object({
    addCharacterAdditional: z.array(z.string().min(1)).optional(),
    characterPrimary: z.string().min(1).nullable().optional(),
    chat: z
      .object({ chatId: z.string().min(1), worldbook: z.string().min(1).nullable() })
      .optional(),
    removeCharacterAdditional: z.array(z.string().min(1)).optional(),
  })
  .refine(
    value =>
      Object.prototype.hasOwnProperty.call(value, 'characterPrimary') ||
      Boolean(value.addCharacterAdditional?.length) ||
      Boolean(value.removeCharacterAdditional?.length) ||
      Boolean(value.chat),
    '至少提供一项绑定操作。',
  );

export function createWorldbookRunnerTools(
  repository: MemoryWorkspaceRepository,
  bridge: TavernBridge,
  options: WorldbookRunnerToolOptions,
): RunnerTool[] {
  return [
    {
      definition: tool({
        description: '按名称搜索酒馆中的全部世界书。只返回名称和是否已进入当前可编辑工作区，不读取正文。',
        inputSchema: z.object({
          maxResults: z.number().int().min(1).max(200).optional(),
          query: z.string().optional().describe('名称包含的普通文本；省略或留空时列出全部'),
        }),
      }),
      execute: async input => {
        const value = input as { maxResults?: number; query?: string };
        const query = value.query?.trim().toLocaleLowerCase() ?? '';
        const base = options.getBaseState();
        const editable = new Set(workingBooks(repository, base).filter(book => book.writable).map(book => book.name));
        const matches = bridge
          .getWorldbookNames()
          .filter(name => !query || name.toLocaleLowerCase().includes(query))
          .sort((left, right) => left.localeCompare(right))
          .slice(0, value.maxResults ?? 50)
          .map(name => ({ editable: editable.has(name), name }));
        return { matches, query: value.query ?? '', returned: matches.length };
      },
      name: 'search_worldbooks',
      readonly: true,
    },
    {
      definition: tool({
        description:
          '把指定酒馆世界书挂载到/library/worldbooks下作为当前Agent会话的只读参考。挂载不会绑定角色，也不会进入角色卡Diff。',
        inputSchema: z.object({ name: z.string().min(1) }),
      }),
      execute: async input => {
        const name = normalizedName((input as { name: string }).name);
        if (!bridge.getWorldbookNames().includes(name)) throw new Error(`世界书不存在：${name}`);
        const book = await readStandaloneWorldbook(bridge, name, { writable: false });
        if (!book.roundTripSafe) throw new Error(`世界书“${name}”读取失败，无法挂载。`);
        const root = `/library/worldbooks/${encodeWorkspaceSegment(name)}`;
        repository.replaceProjection(root, projectWorldbookFiles(book, { readonly: true, root: '/library/worldbooks' }));
        return { mounted: true, name, path: root, readonly: true };
      },
      name: 'mount_worldbook_reference',
      readonly: true,
    },
    {
      definition: tool({
        description: '在Working Copy中新建一本空世界书。不会自动绑定；本轮结束后与其他角色卡改动一并审批。',
        inputSchema: z.object({ name: z.string().min(1) }),
      }),
      execute: async (input, toolCallId) => {
        const name = normalizedName((input as { name: string }).name);
        const base = options.getBaseState();
        if (knownNames(repository, bridge, base).has(name)) throw new Error(`世界书名称已存在：${name}`);
        const book: WorldbookData = {
          entries: [],
          name,
          resourceId: `worldbook:${crypto.randomUUID()}`,
          roundTripSafe: true,
          unknownFields: {},
          writable: true,
        };
        await repository.stageFiles(projectWorldbookFiles(book), `${toolCallId}:worldbook`);
        return { created: true, name, path: `/worldbooks/${encodeWorkspaceSegment(name)}` };
      },
      name: 'create_worldbook',
      readonly: false,
    },
    {
      definition: tool({
        description:
          '完整复制一本世界书到Working Copy，保留条目顺序、未知字段与extra，但为副本分配独立资源身份。新名称必须由你明确提供。',
        inputSchema: z.object({ name: z.string().min(1).describe('副本的新名称'), source: z.string().min(1) }),
      }),
      execute: async (input, toolCallId) => {
        const value = input as { name: string; source: string };
        const name = normalizedName(value.name, '新世界书名称');
        const sourceName = normalizedName(value.source, '源世界书名称');
        const base = options.getBaseState();
        if (knownNames(repository, bridge, base).has(name)) throw new Error(`世界书名称已存在：${name}`);
        const source = await loadBook(repository, bridge, base, sourceName);
        if (!source.roundTripSafe) throw new Error(`世界书“${sourceName}”无法无损读取，不能复制。`);
        const cloned = cloneBook(source, name);
        await repository.stageFiles(projectWorldbookFiles(cloned), `${toolCallId}:worldbook`);
        return {
          cloned: true,
          entries: cloned.entries.length,
          name,
          path: `/worldbooks/${encodeWorkspaceSegment(name)}`,
          source: sourceName,
        };
      },
      name: 'clone_worldbook',
      readonly: false,
    },
    {
      confirmation: (input, toolCallId) => options.chatBindingConfirmation?.(input, toolCallId),
      definition: tool({
        description:
          '修改世界书绑定。省略的字段保持不变；characterPrimary或chat.worldbook传null表示清除。绑定一本尚未进入工作区的现有世界书时，会先无损载入可编辑Working Copy。',
        inputSchema: bindingSchema,
      }),
      execute: async (input, toolCallId) => {
        const value = input as z.infer<typeof bindingSchema>;
        if (value.chat && !options.setChatBinding) {
          throw new Error('CHAT_WORKSPACE_UNAVAILABLE：当前环境尚未提供聊天世界书绑定能力。');
        }
        const base = options.getBaseState();
        const names = [
          ...(typeof value.characterPrimary === 'string' ? [value.characterPrimary] : []),
          ...(value.addCharacterAdditional ?? []),
          ...(typeof value.chat?.worldbook === 'string' ? [value.chat.worldbook] : []),
        ].map(name => normalizedName(name));
        for (const name of new Set(names)) {
          if (!knownNames(repository, bridge, base).has(name)) throw new Error(`世界书不存在：${name}`);
          await ensureEditableBook(repository, bridge, base, name);
        }

        const bindingFile = await repository.read('/worldbooks/bindings.yaml');
        const parsed = parseYamlObject(bindingFile.content, bindingFile.path);
        const additional = Array.isArray(parsed.additional)
          ? parsed.additional.filter((name): name is string => typeof name === 'string')
          : [];
        const nextAdditional = new Set(additional);
        for (const name of value.removeCharacterAdditional ?? []) nextAdditional.delete(normalizedName(name));
        for (const name of value.addCharacterAdditional ?? []) nextAdditional.add(normalizedName(name));
        const next = {
          additional: [...nextAdditional],
          chat: parsed.chat ?? null,
          primary: parsed.primary ?? null,
        };
        if (Object.prototype.hasOwnProperty.call(value, 'characterPrimary')) {
          next.primary = value.characterPrimary === null ? null : normalizedName(value.characterPrimary!);
        }
        await repository.write(bindingFile.path, serializeYaml(next), `${toolCallId}:bindings`);
        if (value.chat) {
          await options.setChatBinding!(value.chat.chatId, value.chat.worldbook, `${toolCallId}:chat-binding`);
        }
        return { bindings: next, chat: value.chat, updated: true };
      },
      name: 'set_worldbook_binding',
      readonly: false,
    },
  ];
}
