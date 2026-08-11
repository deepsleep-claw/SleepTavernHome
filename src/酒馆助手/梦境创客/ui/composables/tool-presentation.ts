import type { SessionUiItem } from '../../core/session/types';

type JsonRecord = Record<string, unknown>;

export type ToolCardTone = 'accent' | 'danger' | 'info' | 'success' | 'warning';

export type ToolCardMetric = {
  label: string;
  tone?: ToolCardTone;
  value: string;
};

export type ToolCardRow = {
  detail?: string;
  icon?: string;
  label: string;
  meta?: string;
  tone?: ToolCardTone;
};

export type ToolCardPreview = {
  content: string;
  mode: 'code' | 'diff' | 'text';
};

export type ToolPresentation = {
  expandable: boolean;
  icon: string;
  kind: 'context' | 'file' | 'generic' | 'search' | 'tavern' | 'web' | 'worldbook';
  metrics: ToolCardMetric[];
  path?: string;
  preview?: ToolCardPreview;
  rawInput: string;
  rawOutput: string;
  rows: ToolCardRow[];
  summary: string;
  title: string;
  tone: ToolCardTone;
};

type ToolDescriptor = Pick<ToolPresentation, 'icon' | 'kind' | 'title' | 'tone'>;

const TOOL_DESCRIPTORS: Record<string, ToolDescriptor> = {
  apply_patch: { icon: 'fa-solid fa-code-compare', kind: 'file', title: '应用补丁', tone: 'success' },
  clone_worldbook: { icon: 'fa-solid fa-book-open', kind: 'worldbook', title: '克隆世界书', tone: 'warning' },
  compact_context: { icon: 'fa-solid fa-box-archive', kind: 'context', title: '整理上下文', tone: 'accent' },
  create_tavern_chat: { icon: 'fa-solid fa-comment-medical', kind: 'tavern', title: '新建酒馆会话', tone: 'accent' },
  create_worldbook: { icon: 'fa-solid fa-book-medical', kind: 'worldbook', title: '创建世界书', tone: 'warning' },
  delete_path: { icon: 'fa-solid fa-trash-can', kind: 'file', title: '删除路径', tone: 'danger' },
  generate_tavern_reply: {
    icon: 'fa-solid fa-wand-magic-sparkles',
    kind: 'tavern',
    title: '生成酒馆回复',
    tone: 'accent',
  },
  list_directory: { icon: 'fa-solid fa-folder-tree', kind: 'file', title: '浏览目录', tone: 'info' },
  list_tavern_chats: { icon: 'fa-solid fa-comments', kind: 'tavern', title: '列出酒馆会话', tone: 'accent' },
  mount_worldbook_reference: {
    icon: 'fa-solid fa-book-bookmark',
    kind: 'worldbook',
    title: '挂载世界书',
    tone: 'warning',
  },
  move_path: { icon: 'fa-solid fa-arrow-right-arrow-left', kind: 'file', title: '移动路径', tone: 'info' },
  read_file: { icon: 'fa-regular fa-file-lines', kind: 'file', title: '读取文件', tone: 'info' },
  search_files: { icon: 'fa-solid fa-magnifying-glass', kind: 'search', title: '搜索文件', tone: 'info' },
  search_worldbooks: { icon: 'fa-solid fa-book-open-reader', kind: 'worldbook', title: '搜索世界书', tone: 'warning' },
  send_tavern_message: { icon: 'fa-solid fa-paper-plane', kind: 'tavern', title: '发送酒馆消息', tone: 'accent' },
  set_worldbook_binding: { icon: 'fa-solid fa-link', kind: 'worldbook', title: '更新世界书绑定', tone: 'warning' },
  switch_tavern_chat: { icon: 'fa-solid fa-right-left', kind: 'tavern', title: '切换酒馆会话', tone: 'accent' },
  switch_tavern_swipe: { icon: 'fa-solid fa-layer-group', kind: 'tavern', title: '切换酒馆 Swipe', tone: 'accent' },
  truncate_tavern_chat: { icon: 'fa-solid fa-scissors', kind: 'tavern', title: '截断酒馆会话', tone: 'danger' },
  web_search: { icon: 'fa-solid fa-globe', kind: 'web', title: '网页搜索', tone: 'info' },
  write_file: { icon: 'fa-solid fa-file-pen', kind: 'file', title: '写入文件', tone: 'success' },
};

function parsePayload(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter(item => Object.keys(item).length > 0) : [];
}

function text(recordValue: JsonRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = recordValue[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

function number(recordValue: JsonRecord, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = recordValue[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 ** 2) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_024 ** 2).toFixed(1)} MB`;
}

function domain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, '');
  } catch {
    return value;
  }
}

function compactLine(value: string, fallback: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map(line => line.trim())
      .find(Boolean) ?? fallback
  );
}

function descriptorFor(item: SessionUiItem): ToolDescriptor {
  const name = item.toolName ?? 'tool';
  const known = TOOL_DESCRIPTORS[name];
  if (known) return known;
  return {
    icon: item.providerTool ? 'fa-solid fa-cloud' : 'fa-solid fa-puzzle-piece',
    kind: item.providerTool ? 'web' : 'generic',
    title: name,
    tone: item.providerTool ? 'info' : 'accent',
  };
}

export function toolDisplayTitle(item: SessionUiItem): string {
  return descriptorFor(item).title;
}

function filePresentation(
  name: string,
  input: JsonRecord,
  output: JsonRecord,
  outputValue: unknown,
): Partial<Pick<ToolPresentation, 'expandable' | 'metrics' | 'path' | 'preview' | 'rows' | 'summary'>> {
  const path = text(output, 'path') ?? text(input, 'path');
  if (name === 'list_directory') {
    const directEntries = records(outputValue);
    return {
      expandable: directEntries.length > 3,
      path,
      rows: directEntries.map(entry => ({
        icon: entry.kind === 'directory' ? 'fa-regular fa-folder' : 'fa-regular fa-file',
        label: text(entry, 'name', 'path') ?? '未命名项目',
        meta: typeof entry.size === 'number' ? formatBytes(entry.size) : text(entry, 'kind'),
      })),
      summary: directEntries.length > 0 ? `${directEntries.length} 个直接子项` : '目录内容已读取',
    };
  }
  if (name === 'read_file') {
    const view = text(output, 'view');
    const start = number(output, 'startLine');
    const end = number(output, 'endLine');
    const total = number(output, 'totalLines');
    const metrics: ToolCardMetric[] = [];
    if (start !== undefined && end !== undefined) metrics.push({ label: '行', value: `${start}–${end}` });
    if (total !== undefined) metrics.push({ label: '总计', value: `${total} 行` });
    const size = number(output, 'size');
    if (size !== undefined) metrics.push({ label: '大小', value: formatBytes(size) });
    const mediaType = text(output, 'mediaType');
    if (mediaType) metrics.push({ label: '类型', value: mediaType });
    return {
      expandable: Boolean(view && view.split(/\r?\n/u).length > 5),
      metrics,
      path,
      preview: view ? { content: view, mode: 'code' } : undefined,
      summary:
        output.binary === true ? '二进制文件已读取' : output.truncated === true ? '已读取部分内容' : '文件内容已读取',
    };
  }
  if (name === 'apply_patch') {
    const patch = text(input, 'patch');
    const additions =
      patch?.split(/\r?\n/u).filter(line => line.startsWith('+') && !line.startsWith('+++')).length ?? 0;
    const deletions =
      patch?.split(/\r?\n/u).filter(line => line.startsWith('-') && !line.startsWith('---')).length ?? 0;
    return {
      expandable: Boolean(patch && patch.split(/\r?\n/u).length > 5),
      metrics: [
        { label: '新增', tone: 'success', value: `+${additions}` },
        { label: '删除', tone: 'danger', value: `-${deletions}` },
      ],
      path,
      preview: patch ? { content: patch, mode: 'diff' } : undefined,
      summary: output.idempotent === true ? '补丁已经应用过' : '补丁已精确应用',
    };
  }
  if (name === 'write_file') {
    const content = text(input, 'content');
    return {
      expandable: Boolean(content && content.split(/\r?\n/u).length > 5),
      metrics: content ? [{ label: '字符', value: String(content.length) }] : [],
      path,
      preview: content ? { content, mode: 'code' } : undefined,
      summary: output.idempotent === true ? '内容已经写入过' : '文件内容已写入',
    };
  }
  if (name === 'move_path') {
    const from = text(output, 'from') ?? text(input, 'from') ?? '原路径';
    const to = text(output, 'to') ?? text(input, 'to') ?? '目标路径';
    return {
      rows: [
        { icon: 'fa-regular fa-file', label: from, meta: '原位置' },
        { icon: 'fa-solid fa-arrow-right', label: to, meta: '新位置', tone: 'success' },
      ],
      summary: '路径已移动或重命名',
    };
  }
  if (name === 'delete_path') return { path, summary: '路径已删除' };
  return { path, summary: '文件操作已完成' };
}

function fileSearchPresentation(
  input: JsonRecord,
  output: JsonRecord,
): Partial<Pick<ToolPresentation, 'expandable' | 'metrics' | 'path' | 'rows' | 'summary'>> {
  const matches = records(output.matches);
  const returned = number(output, 'returnedMatches') ?? matches.length;
  const matchedFiles = number(output, 'matchedFiles');
  return {
    expandable: matches.length > 3,
    metrics: [
      ...(matchedFiles === undefined ? [] : [{ label: '文件', value: String(matchedFiles) }]),
      { label: '匹配', value: String(returned) },
      ...(output.truncated === true ? [{ label: '结果', tone: 'warning' as const, value: '已截断' }] : []),
    ],
    path: text(input, 'path') ?? '/',
    rows: matches.map(match => ({
      detail: text(match, 'text'),
      icon: 'fa-regular fa-file-lines',
      label: text(match, 'path') ?? '未知文件',
      meta: number(match, 'line') === undefined ? undefined : `第 ${number(match, 'line')} 行`,
    })),
    summary: `搜索“${text(input, 'pattern') ?? '内容'}”`,
  };
}

function worldbookPresentation(
  name: string,
  input: JsonRecord,
  output: JsonRecord,
): Partial<Pick<ToolPresentation, 'expandable' | 'metrics' | 'path' | 'rows' | 'summary'>> {
  const matches = records(output.matches);
  if (name === 'search_worldbooks') {
    return {
      expandable: matches.length > 3,
      metrics: [{ label: '结果', value: String(number(output, 'returned') ?? matches.length) }],
      rows: matches.map(match => ({
        icon: 'fa-solid fa-book',
        label: text(match, 'name', 'title') ?? '未命名世界书',
        meta: match.editable === false ? '只读' : '可编辑',
      })),
      summary: text(output, 'query') ? `搜索“${text(output, 'query')}”` : '已列出可用世界书',
    };
  }
  if (name === 'set_worldbook_binding') {
    const bindings = record(output.bindings);
    const additional = Array.isArray(bindings.additional) ? bindings.additional.map(String) : [];
    return {
      expandable: additional.length > 3,
      metrics: [{ label: '附加世界书', value: String(additional.length) }],
      rows: [
        ...(text(bindings, 'primary')
          ? [{ icon: 'fa-solid fa-star', label: text(bindings, 'primary')!, meta: '主世界书' }]
          : []),
        ...additional.map(label => ({ icon: 'fa-solid fa-book', label, meta: '附加' })),
      ],
      summary: output.updated === true ? '世界书绑定已更新' : '已处理世界书绑定',
    };
  }
  const bookName = text(output, 'name') ?? text(input, 'name') ?? text(input, 'source') ?? '世界书';
  const entries = number(output, 'entries');
  return {
    metrics: entries === undefined ? [] : [{ label: '条目', value: String(entries) }],
    path: text(output, 'path'),
    rows: text(input, 'source')
      ? [{ icon: 'fa-solid fa-code-branch', label: text(input, 'source')!, meta: '来源' }]
      : [],
    summary: `${bookName} · ${
      {
        clone_worldbook: '克隆完成',
        create_worldbook: '创建完成',
        mount_worldbook_reference: '已只读挂载',
      }[name] ?? '操作完成'
    }`,
  };
}

function tavernPresentation(
  name: string,
  input: JsonRecord,
  output: JsonRecord,
): Partial<Pick<ToolPresentation, 'expandable' | 'metrics' | 'preview' | 'rows' | 'summary'>> {
  if (name === 'list_tavern_chats') {
    const chats = records(output.chats);
    return {
      expandable: chats.length > 3,
      metrics: [{ label: '会话', value: String(chats.length) }],
      rows: chats.map(chat => ({
        icon: 'fa-regular fa-comment-dots',
        label: text(chat, 'name', 'title') ?? '未命名会话',
        meta: text(chat, 'id', 'ref'),
        tone: chat.active === true ? 'success' : undefined,
      })),
      summary: '当前角色的酒馆会话',
    };
  }
  const chatId = text(output, 'chatId') ?? text(input, 'chatId');
  const metrics: ToolCardMetric[] = chatId ? [{ label: '会话', value: chatId }] : [];
  const images = number(output, 'images');
  if (images !== undefined) metrics.push({ label: '图片', value: String(images) });
  const message = text(input, 'message');
  const summaries: Record<string, string> = {
    create_tavern_chat: `已创建并切换到 ${text(output, 'name') ?? text(input, 'name') ?? '新会话'}`,
    generate_tavern_reply: '酒馆回复已生成',
    send_tavern_message: '消息已发送并完成生成',
    switch_tavern_chat: `已切换到 ${text(output, 'name') ?? chatId ?? '目标会话'}`,
    switch_tavern_swipe: `已切换到 Swipe ${text(output, 'selected') ?? text(input, 'target') ?? ''}`.trim(),
    truncate_tavern_chat: `已从第 ${text(output, 'fromMessageId') ?? text(input, 'fromMessageId') ?? '?'} 层开始截断`,
  };
  return {
    expandable: Boolean(message && message.split(/\r?\n/u).length > 5),
    metrics,
    preview: message ? { content: message, mode: 'text' } : undefined,
    summary: summaries[name] ?? '酒馆会话操作已完成',
  };
}

function webPresentation(
  input: JsonRecord,
  output: JsonRecord,
): Partial<Pick<ToolPresentation, 'expandable' | 'metrics' | 'rows' | 'summary'>> {
  const action = record(output.action);
  const sources = records(action.sources ?? output.sources ?? output.results);
  const query = text(action, 'query') ?? text(output, 'query') ?? text(input, 'query');
  return {
    expandable: sources.length > 3,
    metrics: sources.length > 0 ? [{ label: '来源', value: String(sources.length) }] : [],
    rows: sources.map(source => {
      const url = text(source, 'url', 'link') ?? '';
      return {
        detail: text(source, 'snippet', 'description'),
        icon: 'fa-solid fa-arrow-up-right-from-square',
        label: text(source, 'title') ?? (domain(url) || '搜索结果'),
        meta: url ? domain(url) : undefined,
      };
    }),
    summary: query ? `搜索“${query}”` : '联网搜索已完成',
  };
}

export function formatToolRaw(value: string | undefined): string {
  if (!value) return '';
  const parsed = parsePayload(value);
  if (typeof parsed === 'string') return parsed;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}

export function buildToolPresentation(item: SessionUiItem): ToolPresentation {
  const descriptor = descriptorFor(item);
  const inputValue = parsePayload(item.toolInput);
  const outputValue = item.status === 'running' ? undefined : parsePayload(item.content);
  const input = record(inputValue);
  const output = record(outputValue);
  let details: Partial<ToolPresentation> = {};
  if (item.status === 'failed') {
    details = {
      expandable: item.content.split(/\r?\n/u).length > 5,
      preview: { content: item.content, mode: 'text' },
      summary: compactLine(item.content, '工具执行失败'),
      tone: 'danger',
    };
  } else if (item.status === 'running') {
    details = { summary: '正在执行工具…' };
  } else if (descriptor.kind === 'file') {
    details = filePresentation(item.toolName ?? '', input, output, outputValue);
  } else if (descriptor.kind === 'search') {
    details = fileSearchPresentation(input, output);
  } else if (descriptor.kind === 'worldbook') {
    details = worldbookPresentation(item.toolName ?? '', input, output);
  } else if (descriptor.kind === 'tavern') {
    details = tavernPresentation(item.toolName ?? '', input, output);
  } else if (descriptor.kind === 'web') {
    details = webPresentation(input, output);
  } else if (descriptor.kind === 'context') {
    const summary = text(output, 'summary') ?? text(input, 'summary');
    details = {
      metrics: summary ? [{ label: '摘要字符', value: String(summary.length) }] : [],
      summary: '旧对话与工具链已压缩整理',
    };
  }
  return {
    ...descriptor,
    expandable: false,
    metrics: [],
    rawInput: formatToolRaw(item.toolInput),
    rawOutput: item.status === 'running' ? '等待工具返回…' : formatToolRaw(item.content),
    rows: [],
    summary: item.status === 'running' ? '正在执行工具…' : '工具执行完成',
    ...details,
  };
}
