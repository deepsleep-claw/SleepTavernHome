import { klona } from 'klona';

export type TavernChatMessageData = {
  hidden: boolean;
  messageId: number;
  name: string;
  role: 'assistant' | 'system' | 'user';
  selectedSwipe: number;
  swipes: string[];
};

export type TavernChatData = {
  messages: TavernChatMessageData[];
  ref: string;
  worldbook: string | null;
};

export type TavernChatSummary = {
  messageCount?: number;
  name: string;
  ref: string;
};

export type TavernChatMessageWrite = {
  hidden: boolean;
  message: string;
  name?: string;
  role: TavernChatMessageData['role'];
};

export type TavernChatImage = { title: string; url: string };

export interface TavernChatBridge {
  appendMessage(message: TavernChatMessageWrite): Promise<void>;
  createChat(name: string): Promise<string>;
  generateReply(): Promise<void>;
  generateSwipe(): Promise<void>;
  getCurrentChatRef(): string | null;
  listChats(): Promise<TavernChatSummary[]>;
  readChat(ref: string): Promise<TavernChatData>;
  selectSwipe(messageId: number, swipe: number): Promise<void>;
  sendMessageAndGenerate(message: TavernChatMessageWrite, images: TavernChatImage[]): Promise<void>;
  setChatWorldbook(name: string | null): Promise<void>;
  switchChat(ref: string): Promise<void>;
  truncate(fromMessageId: number): Promise<void>;
  updateMessage(messageId: number, message: TavernChatMessageWrite): Promise<void>;
}

type HostMainModule = {
  doNewChat: (options?: { deleteCurrentChat?: boolean }) => Promise<void>;
  getPastCharacterChats: () => Promise<Array<Record<string, unknown>>>;
};

let hostMainModulePromise: Promise<HostMainModule> | undefined;

function normalizeChatRef(value: string): string {
  return value.replace(/\.jsonl$/iu, '');
}

async function hostMainModule(): Promise<HostMainModule> {
  if (hostMainModulePromise) return hostMainModulePromise;
  // 酒馆助手脚本运行在同源iframe中。必须让动态import发生在父页面Realm，
  // 否则会在脚本iframe里重新实例化整份SillyTavern主模块及其DOM副作用。
  const hostWindow = (window.parent === window ? window : window.parent) as Window & {
    Function: FunctionConstructor;
  };
  const moduleUrl = new URL('script.js', hostWindow.document.baseURI).href;
  const importer = hostWindow.Function('moduleUrl', 'return import(moduleUrl);') as (
    moduleUrl: string,
  ) => Promise<unknown>;
  hostMainModulePromise = importer(moduleUrl).then(module => module as HostMainModule);
  return hostMainModulePromise;
}

function roleOf(raw: Record<string, unknown>): TavernChatMessageData['role'] {
  const extra = typeof raw.extra === 'object' && raw.extra !== null ? (raw.extra as Record<string, unknown>) : {};
  if (raw.is_system === true || extra.type === 'narrator') return 'system';
  return raw.is_user === true ? 'user' : 'assistant';
}

function normalizeRawMessages(rawMessages: Record<string, unknown>[]): TavernChatMessageData[] {
  return rawMessages.map((raw, messageId) => {
    const rawSwipes = Array.isArray(raw.swipes) ? raw.swipes.filter((value): value is string => typeof value === 'string') : [];
    const message = typeof raw.mes === 'string' ? raw.mes : '';
    const swipes = rawSwipes.length > 0 ? rawSwipes : [message];
    const selected = typeof raw.swipe_id === 'number' ? Math.max(0, Math.min(raw.swipe_id, swipes.length - 1)) : 0;
    return {
      hidden: raw.is_hidden === true,
      messageId,
      name: typeof raw.name === 'string' ? raw.name : '',
      role: roleOf(raw),
      selectedSwipe: selected,
      swipes,
    };
  });
}

function normalizeHelperMessages(messages: ChatMessageSwiped[]): TavernChatMessageData[] {
  return messages.map(message => ({
    hidden: message.is_hidden,
    messageId: message.message_id,
    name: message.name,
    role: message.role,
    selectedSwipe: message.swipe_id,
    swipes: [...message.swipes],
  }));
}

function assertChatName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error('聊天名称不能为空。');
  if (/[<>:"/\\|?*]/u.test(normalized) || /[. ]$/u.test(normalized)) {
    throw new Error('聊天名称包含文件系统不允许的字符。');
  }
  return normalized;
}

function rawMessage(input: TavernChatMessageWrite, images: TavernChatImage[] = []): ChatMessageCreating {
  const extra: Record<string, unknown> = {};
  if (images.length > 0) {
    extra.media = images.map(image => ({ source: 'upload', title: image.title, type: 'image', url: image.url }));
    extra.media_index = images.length - 1;
    extra.inline_image = true;
  }
  const result: ChatMessageCreating = {
    extra,
    is_hidden: input.hidden,
    message: input.message,
    role: input.role,
  };
  if (input.name !== undefined && input.name !== '') result.name = input.name;
  return result;
}

export function createGlobalTavernChatBridge(): TavernChatBridge {
  return {
    appendMessage: async message => createChatMessages([rawMessage(message)]),
    createChat: async inputName => {
      const name = assertChatName(inputName);
      const module = await hostMainModule();
      const existing = await module.getPastCharacterChats();
      if (
        existing.some(item =>
          typeof item.file_name === 'string'
            ? normalizeChatRef(item.file_name).localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
            : false,
        )
      ) {
        throw new Error(`聊天名称已存在：${name}`);
      }
      await module.doNewChat({ deleteCurrentChat: false });
      const created = SillyTavern.getCurrentChatId();
      if (!created) throw new Error('酒馆没有返回新建聊天的文件名。');
      await SillyTavern.renameChat(created, name);
      const current = SillyTavern.getCurrentChatId();
      if (current !== name) throw new Error(`聊天重命名失败：期望“${name}”，实际“${current}”。`);
      return current;
    },
    generateReply: async () => {
      await SillyTavern.generate('normal');
    },
    generateSwipe: async () => {
      await SillyTavern.generate('swipe');
    },
    getCurrentChatRef: () => SillyTavern.getCurrentChatId?.() || SillyTavern.chatId || null,
    listChats: async () => {
      const module = await hostMainModule();
      const chats = await module.getPastCharacterChats();
      return chats.flatMap(item => {
        if (typeof item.file_name !== 'string') return [];
        const ref = normalizeChatRef(item.file_name);
        const count = typeof item.message_count === 'number' ? item.message_count : undefined;
        return [{ messageCount: count, name: ref, ref }];
      });
    },
    readChat: async ref => {
      const normalized = normalizeChatRef(ref);
      if (normalizeChatRef(SillyTavern.getCurrentChatId?.() ?? '') === normalized) {
        return {
          messages: normalizeHelperMessages(getChatMessages('0-{{lastMessageId}}', { include_swipes: true })),
          ref: normalized,
          worldbook: getChatWorldbookName('current'),
        };
      }
      const character = SillyTavern.characters[Number(SillyTavern.characterId)];
      if (!character?.avatar) throw new Error('读取聊天前无法确定当前角色卡。');
      const response = await fetch('/api/chats/get', {
        body: JSON.stringify({ avatar_url: character.avatar, ch_name: character.name, file_name: normalized }),
        cache: 'no-cache',
        headers: SillyTavern.getRequestHeaders(),
        method: 'POST',
      });
      if (!response.ok) throw new Error(`聊天读取失败：${normalized}（${response.status}）`);
      const raw = (await response.json()) as unknown;
      if (!Array.isArray(raw)) throw new Error(`聊天文件格式无效：${normalized}`);
      const records = raw.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
      const metadata = records[0] ?? {};
      const chatMetadata =
        typeof metadata.chat_metadata === 'object' && metadata.chat_metadata !== null
          ? (metadata.chat_metadata as Record<string, unknown>)
          : {};
      return {
        messages: normalizeRawMessages(records.slice(1)),
        ref: normalized,
        worldbook: typeof chatMetadata.world_info === 'string' ? chatMetadata.world_info : null,
      };
    },
    selectSwipe: async (messageId, swipe) => {
      await setChatMessages([{ message_id: messageId, swipe_id: swipe }]);
    },
    sendMessageAndGenerate: async (message, images) => {
      await createChatMessages([rawMessage(message, images)]);
      await SillyTavern.generate('normal');
    },
    setChatWorldbook: async name => setChatLorebook(name),
    switchChat: async ref => SillyTavern.openCharacterChat(normalizeChatRef(ref)),
    truncate: async fromMessageId => {
      const messages = getChatMessages('0-{{lastMessageId}}');
      await deleteChatMessages(messages.filter(message => message.message_id >= fromMessageId).map(message => message.message_id));
    },
    updateMessage: async (messageId, message) => {
      await setChatMessages([
        {
          is_hidden: message.hidden,
          message: message.message,
          message_id: messageId,
          name: message.name,
          role: message.role,
        },
      ]);
    },
  };
}

export class FakeTavernChatBridge implements TavernChatBridge {
  activeRef = '初始聊天';
  readonly calls: string[] = [];
  readonly chats = new Map<string, TavernChatData>();

  constructor() {
    this.chats.set(this.activeRef, {
      messages: [
        {
          hidden: false,
          messageId: 0,
          name: '角色',
          role: 'assistant',
          selectedSwipe: 0,
          swipes: ['你好。', '欢迎。'],
        },
      ],
      ref: this.activeRef,
      worldbook: null,
    });
  }

  async appendMessage(message: TavernChatMessageWrite): Promise<void> {
    this.calls.push('append-message');
    const chat = this.requireActive();
    chat.messages.push({
      hidden: message.hidden,
      messageId: chat.messages.length,
      name: message.name ?? (message.role === 'user' ? '用户' : message.role === 'assistant' ? '角色' : 'system'),
      role: message.role,
      selectedSwipe: 0,
      swipes: [message.message],
    });
  }

  async createChat(name: string): Promise<string> {
    this.calls.push(`create-chat:${name}`);
    if (this.chats.has(name)) throw new Error(`聊天名称已存在：${name}`);
    this.chats.set(name, { messages: [], ref: name, worldbook: null });
    this.activeRef = name;
    return name;
  }

  async generateReply(): Promise<void> {
    this.calls.push('generate-reply');
    await this.appendMessage({ hidden: false, message: '生成回复', name: '角色', role: 'assistant' });
  }

  async generateSwipe(): Promise<void> {
    this.calls.push('generate-swipe');
    const latest = this.requireActive().messages.at(-1);
    if (!latest) throw new Error('没有可生成Swipe的楼层。');
    latest.swipes.push(`新Swipe ${latest.swipes.length}`);
    latest.selectedSwipe = latest.swipes.length - 1;
  }

  getCurrentChatRef(): string | null {
    return this.activeRef;
  }

  async listChats(): Promise<TavernChatSummary[]> {
    return [...this.chats.values()].map(chat => ({ messageCount: chat.messages.length, name: chat.ref, ref: chat.ref }));
  }

  async readChat(ref: string): Promise<TavernChatData> {
    const chat = this.chats.get(ref);
    if (!chat) throw new Error(`聊天不存在：${ref}`);
    return klona(chat);
  }

  async selectSwipe(messageId: number, swipe: number): Promise<void> {
    this.calls.push(`select-swipe:${messageId}:${swipe}`);
    const message = this.requireActive().messages[messageId];
    if (!message?.swipes[swipe]) throw new Error('Swipe不存在。');
    message.selectedSwipe = swipe;
  }

  async sendMessageAndGenerate(message: TavernChatMessageWrite, _images: TavernChatImage[]): Promise<void> {
    this.calls.push('send-and-generate');
    await this.appendMessage(message);
    await this.generateReply();
  }

  async setChatWorldbook(name: string | null): Promise<void> {
    this.calls.push(`bind-chat:${name ?? 'null'}`);
    this.requireActive().worldbook = name;
  }

  async switchChat(ref: string): Promise<void> {
    this.calls.push(`switch-chat:${ref}`);
    if (!this.chats.has(ref)) throw new Error(`聊天不存在：${ref}`);
    this.activeRef = ref;
  }

  async truncate(fromMessageId: number): Promise<void> {
    this.calls.push(`truncate:${fromMessageId}`);
    this.requireActive().messages.splice(fromMessageId);
  }

  async updateMessage(messageId: number, message: TavernChatMessageWrite): Promise<void> {
    this.calls.push(`update-message:${messageId}`);
    const current = this.requireActive().messages[messageId];
    if (!current) throw new Error('楼层不存在。');
    current.hidden = message.hidden;
    current.name = message.name ?? current.name;
    current.role = message.role;
    current.swipes[current.selectedSwipe] = message.message;
  }

  private requireActive(): TavernChatData {
    const chat = this.chats.get(this.activeRef);
    if (!chat) throw new Error(`聊天不存在：${this.activeRef}`);
    return chat;
  }
}
