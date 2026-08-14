import { applyUnifiedPatch } from '../workspace/unified-patch';
import { parseFrontmatter, serializeFrontmatter, serializeYaml } from '../mapping/serde';
import { sha256 } from '../transaction/canonical';
import { MemoryWorkspaceRepository } from '../workspace/memory-repository';
import type { WorkspaceFile } from '../workspace/types';
import type {
  TavernChatBridge,
  TavernChatData,
  TavernChatImage,
  TavernChatMessageData,
  TavernChatSummary,
} from './chat-bridge';

export type TavernChatMount = {
  alias: string;
  name: string;
  ref: string;
};

export type TavernChatWorkspaceRuntime = {
  activeChat?: string;
  completedToolCallIds?: string[];
  initialChat?: string;
  mounts: TavernChatMount[];
  nextAlias: number;
};

type ParsedMessagePath = { alias: string; messageId: number };

const CHAT_ROOT = '/character/chats';
const MESSAGE_PATH = /^\/character\/chats\/(c\d+)\/messages\/\d{4}-\d{4}\/(\d{6})\.md$/u;

function textFile(
  path: string,
  content: string,
  resourceId: string,
  mediaType: WorkspaceFile['mediaType'] = 'text/markdown',
  readonly = true,
): WorkspaceFile {
  return { content, mediaType, path, readonly, resourceId };
}

function messagePath(alias: string, messageId: number): string {
  const bucketStart = Math.floor(messageId / 100) * 100;
  const bucket = `${String(bucketStart).padStart(4, '0')}-${String(bucketStart + 99).padStart(4, '0')}`;
  return `${CHAT_ROOT}/${alias}/messages/${bucket}/${String(messageId).padStart(6, '0')}.md`;
}

function parseMessagePath(path: string): ParsedMessagePath | undefined {
  const match = MESSAGE_PATH.exec(path);
  if (!match) return undefined;
  const parsed = { alias: match[1], messageId: Number(match[2]) };
  return messagePath(parsed.alias, parsed.messageId) === path ? parsed : undefined;
}

async function messageRevision(ref: string, message: TavernChatMessageData): Promise<string> {
  return sha256(
    JSON.stringify({
      hidden: message.hidden,
      messageId: message.messageId,
      name: message.name,
      ref,
      role: message.role,
      selectedSwipe: message.selectedSwipe,
      swipes: message.swipes,
    }),
  );
}

async function projectChat(mount: TavernChatMount, chat: TavernChatData, writable = false): Promise<WorkspaceFile[]> {
  const revisions = await Promise.all(chat.messages.map(message => messageRevision(chat.ref, message)));
  const files = chat.messages.map((message, index) =>
    textFile(
      messagePath(mount.alias, message.messageId),
      serializeFrontmatter(
        {
          hidden: message.hidden,
          message_id: message.messageId,
          name: message.name,
          revision: revisions[index],
          role: message.role,
          selected_swipe: message.selectedSwipe,
          swipe_count: message.swipes.length,
        },
        message.swipes[message.selectedSwipe] ?? '',
      ),
      `tavern-chat:${chat.ref}:message:${message.messageId}`,
      'text/markdown',
      !writable,
    ),
  );
  files.push(
    textFile(
      `${CHAT_ROOT}/${mount.alias}/info.yaml`,
      serializeYaml({
        chat_worldbook: chat.worldbook,
        id: mount.alias,
        last_message_id: chat.messages.at(-1)?.messageId ?? null,
        message_count: chat.messages.length,
        name: mount.name,
        revision: await sha256(revisions.join(':')),
      }),
      `tavern-chat:${chat.ref}:info`,
      'text/yaml',
    ),
  );
  return files;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串。`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是布尔值。`);
  return value;
}

function requiredRole(value: unknown): TavernChatMessageData['role'] {
  if (value !== 'assistant' && value !== 'system' && value !== 'user') {
    throw new Error('role必须是assistant、system或user。');
  }
  return value;
}

export class TavernChatWorkspace {
  private activeChat?: string;
  private authorized = false;
  private cachedFiles: WorkspaceFile[] = [];
  private readonly completedToolCallIds = new Set<string>();
  private initialChat?: string;
  private readonly mounts = new Map<string, TavernChatMount>();
  private nextAlias: number;

  constructor(
    private readonly bridge: TavernChatBridge,
    runtime?: TavernChatWorkspaceRuntime,
  ) {
    runtime?.mounts.forEach(mount => this.mounts.set(mount.alias, { ...mount }));
    runtime?.completedToolCallIds?.forEach(id => this.completedToolCallIds.add(id));
    this.activeChat = runtime?.activeChat;
    this.initialChat = runtime?.initialChat;
    this.nextAlias = Math.max(runtime?.nextAlias ?? 1, 1);
  }

  async initialize(repository: MemoryWorkspaceRepository): Promise<void> {
    this.syncCurrentChat();
    await this.refresh(repository);
  }

  async resetForCurrentCharacter(repository: MemoryWorkspaceRepository): Promise<void> {
    this.mounts.clear();
    this.activeChat = undefined;
    this.initialChat = undefined;
    this.nextAlias = 1;
    this.cachedFiles = [];
    await this.initialize(repository);
  }

  exportRuntime(): TavernChatWorkspaceRuntime {
    return {
      activeChat: this.activeChat,
      completedToolCallIds: [...this.completedToolCallIds],
      initialChat: this.initialChat,
      mounts: [...this.mounts.values()].map(mount => ({ ...mount })),
      nextAlias: this.nextAlias,
    };
  }

  projectCached(repository: MemoryWorkspaceRepository): void {
    repository.replaceProjection(CHAT_ROOT, this.cachedFiles);
  }

  async refresh(repository?: MemoryWorkspaceRepository): Promise<void> {
    this.syncCurrentChat();
    const projected = await Promise.all(
      [...this.mounts.values()].map(async mount =>
        projectChat(mount, await this.bridge.readChat(mount.ref), mount.alias === this.activeChat),
      ),
    );
    const index = textFile(
      `${CHAT_ROOT}/index.yaml`,
      serializeYaml({
        active_chat: this.activeChat ?? null,
        initial_chat: this.initialChat ?? null,
        mounted: [...this.mounts.values()].map(mount => ({ id: mount.alias, name: mount.name })),
      }),
      'tavern-chat:index',
      'text/yaml',
    );
    const readme = textFile(
      `${CHAT_ROOT}/README.md`,
      [
        '# 酒馆聊天工作区',
        '',
        '每个 cXX 目录对应当前角色的一份酒馆聊天文件；楼层从 0 开始。',
        '只有 active_chat 可写。修改楼层文件会立即写入酒馆，不进入角色卡Diff与快照。',
        '删除楼层必须使用 truncate_tavern_chat；Swipe只允许操作最新的助手楼层。',
      ].join('\n'),
      'tavern-chat:readme',
    );
    this.cachedFiles = [readme, index, ...projected.flat()].sort((left, right) => left.path.localeCompare(right.path));
    if (repository) repository.replaceProjection(CHAT_ROOT, this.cachedFiles);
  }

  async listAvailable(): Promise<Array<TavernChatSummary & { id?: string }>> {
    const byRef = new Map([...this.mounts.values()].map(mount => [mount.ref, mount.alias]));
    return (await this.bridge.listChats()).map(chat => ({ ...chat, id: byRef.get(chat.ref) }));
  }

  async create(name: string, repository: MemoryWorkspaceRepository): Promise<TavernChatMount> {
    const ref = await this.bridge.createChat(name);
    const mount = this.mount(ref, name);
    this.activeChat = mount.alias;
    await this.refresh(repository);
    return mount;
  }

  async switch(alias: string, repository: MemoryWorkspaceRepository): Promise<TavernChatMount> {
    const mount = this.requireMount(alias);
    await this.bridge.switchChat(mount.ref);
    this.activeChat = mount.alias;
    await this.refresh(repository);
    return mount;
  }

  async mountAndSwitch(
    ref: string,
    name: string,
    repository: MemoryWorkspaceRepository,
  ): Promise<TavernChatMount> {
    await this.bridge.switchChat(ref);
    const mount = this.mount(ref, name);
    this.activeChat = mount.alias;
    await this.refresh(repository);
    return mount;
  }

  async setWorldbook(
    alias: string,
    worldbook: string | null,
    repository: MemoryWorkspaceRepository,
  ): Promise<void> {
    await this.ensureActive(alias, repository);
    await this.bridge.setChatWorldbook(worldbook);
    await this.refresh(repository);
  }

  async writeFile(path: string, content: string, repository: MemoryWorkspaceRepository): Promise<void> {
    const target = parseMessagePath(path);
    if (!target) throw new Error('CHAT_PATH_FORBIDDEN：聊天目录只能写入合法的楼层Markdown文件。');
    await this.ensureActive(target.alias, repository, false);
    const mount = this.requireMount(target.alias);
    const chat = await this.bridge.readChat(mount.ref);
    const current = chat.messages[target.messageId];
    const parsed = parseFrontmatter(content, path);
    if (!current) {
      const next = chat.messages.length;
      if (target.messageId !== next) throw new Error(`CHAT_APPEND_ONLY：新楼层必须是${next}，不能插入或跳号。`);
      const role = requiredRole(parsed.metadata.role);
      await this.bridge.appendMessage({
        hidden: parsed.metadata.hidden === undefined ? false : requiredBoolean(parsed.metadata.hidden, 'hidden'),
        message: parsed.body,
        name: typeof parsed.metadata.name === 'string' ? parsed.metadata.name : undefined,
        role,
      });
      await this.refresh(repository);
      return;
    }

    const expectedRevision = await messageRevision(chat.ref, current);
    const immutable = {
      message_id: current.messageId,
      revision: expectedRevision,
      selected_swipe: current.selectedSwipe,
      swipe_count: current.swipes.length,
    };
    for (const [key, value] of Object.entries(immutable)) {
      if (parsed.metadata[key] !== value) {
        throw new Error(`CHAT_METADATA_MISMATCH：整体写入时${key}必须与当前酒馆值一致。`);
      }
    }
    await this.bridge.updateMessage(current.messageId, {
      hidden: requiredBoolean(parsed.metadata.hidden, 'hidden'),
      message: parsed.body,
      name: requiredString(parsed.metadata.name, 'name'),
      role: requiredRole(parsed.metadata.role),
    });
    await this.refresh(repository);
  }

  async patchFile(path: string, patch: string, repository: MemoryWorkspaceRepository): Promise<void> {
    const target = parseMessagePath(path);
    if (!target) throw new Error('CHAT_PATH_FORBIDDEN：只能Patch合法的聊天楼层文件。');
    await this.ensureActive(target.alias, repository, false);
    const mount = this.requireMount(target.alias);
    const chat = await this.bridge.readChat(mount.ref);
    const current = chat.messages[target.messageId];
    if (!current) throw new Error(`聊天楼层不存在：${target.messageId}`);
    const [latest] = await projectChat(mount, { ...chat, messages: [current] }, true);
    const patched = applyUnifiedPatch(latest.content, patch);
    await this.writeFile(path, patched, repository);
  }

  assertNoMoveOrDelete(path: string): void {
    if (path.startsWith(`${CHAT_ROOT}/`)) {
      throw new Error('CHAT_PATH_FORBIDDEN：聊天楼层不能通过move_path或delete_path操作；删除请使用truncate_tavern_chat。');
    }
  }

  async sendAndGenerate(
    alias: string,
    message: string,
    images: TavernChatImage[],
    repository: MemoryWorkspaceRepository,
  ): Promise<void> {
    await this.ensureActive(alias, repository);
    await this.bridge.sendMessageAndGenerate(
      { hidden: false, message, role: 'user' },
      images,
    );
    await this.refresh(repository);
  }

  async prepareGeneration(
    alias: string,
    kind: 'reply' | 'send' | 'swipe',
    repository: MemoryWorkspaceRepository,
  ): Promise<void> {
    await this.ensureActive(alias, repository);
    if (kind === 'send') return;
    const chat = await this.bridge.readChat(this.requireMount(alias).ref);
    const latest = chat.messages.at(-1);
    if (kind === 'reply' && latest?.role !== 'user') {
      throw new Error('CHAT_GENERATE_REQUIRES_USER：只有最新楼层是user时才能生成回复。');
    }
    if (kind === 'swipe' && latest?.role !== 'assistant') {
      throw new Error('CHAT_SWIPE_REQUIRES_ASSISTANT：Swipe只允许操作最新的assistant楼层。');
    }
  }

  async generateReply(alias: string, repository: MemoryWorkspaceRepository): Promise<void> {
    await this.ensureActive(alias, repository);
    const chat = await this.bridge.readChat(this.requireMount(alias).ref);
    if (chat.messages.at(-1)?.role !== 'user') {
      throw new Error('CHAT_GENERATE_REQUIRES_USER：只有最新楼层是user时才能生成回复。');
    }
    await this.bridge.generateReply();
    await this.refresh(repository);
  }

  async switchSwipe(
    alias: string,
    target: number | 'generate',
    repository: MemoryWorkspaceRepository,
  ): Promise<void> {
    await this.ensureActive(alias, repository);
    const chat = await this.bridge.readChat(this.requireMount(alias).ref);
    const latest = chat.messages.at(-1);
    if (!latest || latest.role !== 'assistant') {
      throw new Error('CHAT_SWIPE_REQUIRES_ASSISTANT：Swipe只允许操作最新的assistant楼层。');
    }
    if (target === 'generate') await this.bridge.generateSwipe();
    else {
      if (!Number.isInteger(target) || target < 0 || target >= latest.swipes.length) {
        throw new Error(`Swipe不存在：${target}；当前范围是0-${Math.max(0, latest.swipes.length - 1)}。`);
      }
      await this.bridge.selectSwipe(latest.messageId, target);
    }
    await this.refresh(repository);
  }

  async truncate(alias: string, fromMessageId: number, repository: MemoryWorkspaceRepository): Promise<void> {
    await this.ensureActive(alias, repository);
    const chat = await this.bridge.readChat(this.requireMount(alias).ref);
    if (!Number.isInteger(fromMessageId) || fromMessageId < 0 || fromMessageId >= chat.messages.length) {
      throw new Error(`截断起点不存在：${fromMessageId}`);
    }
    await this.bridge.truncate(fromMessageId);
    await this.refresh(repository);
  }

  needsAuthorization(): boolean {
    return !this.authorized;
  }

  authorizeRun(): void {
    this.authorized = true;
  }

  resetRunAuthorization(): void {
    this.authorized = false;
  }

  stopGeneration(): void {
    this.bridge.stopGeneration();
  }

  async executeOnce<T>(toolCallId: string, action: () => Promise<T>): Promise<{ executed: boolean; value?: T }> {
    if (!toolCallId) throw new Error('聊天工具调用必须包含稳定的toolCallId。');
    if (this.completedToolCallIds.has(toolCallId)) return { executed: false };
    const value = await action();
    this.completedToolCallIds.add(toolCallId);
    return { executed: true, value };
  }

  private syncCurrentChat(): void {
    const ref = this.bridge.getCurrentChatRef();
    if (!ref) return;
    const existing = [...this.mounts.values()].find(mount => mount.ref === ref);
    const mount = existing ?? this.mount(ref, ref);
    this.activeChat = mount.alias;
    this.initialChat ??= mount.alias;
  }

  private mount(ref: string, name: string): TavernChatMount {
    const existing = [...this.mounts.values()].find(mount => mount.ref === ref);
    if (existing) return existing;
    const alias = `c${String(this.nextAlias).padStart(2, '0')}`;
    this.nextAlias += 1;
    const mount = { alias, name, ref };
    this.mounts.set(alias, mount);
    return mount;
  }

  private requireMount(alias: string): TavernChatMount {
    const mount = this.mounts.get(alias);
    if (!mount) throw new Error(`聊天ID不存在：${alias}`);
    return mount;
  }

  private async ensureActive(
    alias: string,
    repository: MemoryWorkspaceRepository,
    allowSwitch = true,
  ): Promise<void> {
    const mount = this.requireMount(alias);
    if (this.activeChat === alias && this.bridge.getCurrentChatRef() === mount.ref) return;
    if (!allowSwitch) throw new Error(`CHAT_NOT_ACTIVE：只有active_chat（${this.activeChat ?? '无'}）可写。`);
    await this.bridge.switchChat(mount.ref);
    this.activeChat = alias;
    await this.refresh(repository);
  }
}
