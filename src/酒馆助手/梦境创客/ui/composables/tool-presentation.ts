import type { SessionUiItem } from '../../core/session/types';
import { resolveWebsiteFavicon } from './website-favicon';

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

export type ToolWebSearchResult = {
  domain?: string;
  faviconDarkUrl?: string;
  faviconFallbackUrl?: string;
  faviconLightUrl?: string;
  publishDate?: string;
  snippet?: string;
  title: string;
  url?: string;
};

export type ToolWebTarget = {
  displayUrl: string;
  domain: string;
  faviconDarkUrl: string;
  faviconFallbackUrl?: string;
  faviconLightUrl: string;
  url: string;
};

export type ToolWebActionPresentation = {
  contentPreview?: string;
  matches?: string[];
  pattern?: string;
  queries?: string[];
  resultsReturned?: boolean;
  target?: ToolWebTarget;
  totalMatches?: number;
  type: 'find' | 'open' | 'search';
};

export type ToolWebSearchGroup = {
  query?: string;
  results: ToolWebSearchResult[];
};

export type ToolWebSearchPresentation = {
  groups: ToolWebSearchGroup[];
  totalResults: number;
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
  webAction?: ToolWebActionPresentation;
  webSearch?: ToolWebSearchPresentation;
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
  find_in_page: { icon: 'fa-solid fa-magnifying-glass', kind: 'web', title: '页内查找', tone: 'info' },
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
  open_page: { icon: 'fa-solid fa-arrow-up-right-from-square', kind: 'web', title: '打开网页', tone: 'info' },
  search: { icon: 'fa-solid fa-globe', kind: 'web', title: '网页搜索', tone: 'info' },
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

function safeWebUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    if (/^#?ws_call_id=/u.test(url.hash)) url.hash = '';
    return url;
  } catch {
    return undefined;
  }
}

function webTarget(url: URL): ToolWebTarget {
  const favicon = resolveWebsiteFavicon(url);
  return {
    displayUrl: `${url.hostname}${url.pathname === '/' ? '' : url.pathname}${url.search}`,
    domain: domain(url.href),
    faviconDarkUrl: favicon.darkUrl,
    faviconFallbackUrl: favicon.fallbackUrl,
    faviconLightUrl: favicon.lightUrl,
    url: url.href,
  };
}

function webSearchResult(value: JsonRecord): ToolWebSearchResult | undefined {
  const rawUrl = text(value, 'url', 'link') ?? '';
  const url = safeWebUrl(rawUrl);
  const title = text(value, 'title') ?? (url ? domain(url.href) : undefined);
  if (!title && !url) return undefined;
  return {
    domain: url ? domain(url.href) : undefined,
    faviconDarkUrl: url ? resolveWebsiteFavicon(url).darkUrl : undefined,
    faviconFallbackUrl: url ? resolveWebsiteFavicon(url).fallbackUrl : undefined,
    faviconLightUrl: url ? resolveWebsiteFavicon(url).lightUrl : undefined,
    publishDate: text(value, 'publish_date', 'publishDate', 'published_at', 'date'),
    snippet: text(value, 'snippet', 'description', 'content'),
    title: title ?? '搜索结果',
    url: url?.href,
  };
}

function webSearchResults(value: unknown): ToolWebSearchResult[] {
  return records(value).map(webSearchResult).filter((item): item is ToolWebSearchResult => item !== undefined);
}

function compactLine(value: string, fallback: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map(line => line.trim())
      .find(Boolean) ?? fallback
  );
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r\n|[\n\r]/u).length;
}

/**
 * 工具参数流还是未闭合JSON时，只提取卡片需要的字符串字段。
 * 这不是执行参数解析器；正式执行始终使用AI SDK完成校验后的input。
 */
function decodePartialJsonString(value: string, start: number): { closed: boolean; end: number; value: string } {
  let index = start + 1;
  let result = '';
  while (index < value.length) {
    const character = value[index];
    if (character === '"') return { closed: true, end: index, value: result };
    if (character !== '\\') {
      result += character;
      index += 1;
      continue;
    }
    const escaped = value[index + 1];
    if (escaped === undefined) break;
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escaped === 'u') {
      const code = value.slice(index + 2, index + 6);
      if (!/^[\da-fA-F]{4}$/u.test(code)) break;
      result += String.fromCharCode(Number.parseInt(code, 16));
      index += 6;
      continue;
    }
    result += simpleEscapes[escaped] ?? escaped;
    index += 2;
  }
  return { closed: false, end: value.length, value: result };
}

function partialJsonString(value: string | undefined, key: string): string | undefined {
  if (!value) return undefined;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '{' || character === '[') {
      depth += 1;
      continue;
    }
    if (character === '}' || character === ']') {
      depth -= 1;
      continue;
    }
    if (character !== '"') continue;
    const parsedKey = decodePartialJsonString(value, index);
    if (!parsedKey.closed) return undefined;
    index = parsedKey.end;
    if (depth !== 1) continue;
    let cursor = parsedKey.end + 1;
    while (/\s/u.test(value[cursor] ?? '')) cursor += 1;
    if (value[cursor] !== ':') continue;
    cursor += 1;
    while (/\s/u.test(value[cursor] ?? '')) cursor += 1;
    if (parsedKey.value !== key || value[cursor] !== '"') continue;
    return decodePartialJsonString(value, cursor).value;
  }
  return undefined;
}

function patchMetrics(patch: string): ToolCardMetric[] {
  const lines = patch.split(/\r?\n/u);
  const additions = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
  const deletions = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
  return [
    { label: '补丁', value: `${lineCount(patch)} 行` },
    { label: '新增', tone: 'success', value: `+${additions}` },
    { label: '删除', tone: 'danger', value: `-${deletions}` },
  ];
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
    return {
      expandable: Boolean(patch && patch.split(/\r?\n/u).length > 5),
      metrics: patch ? patchMetrics(patch) : [],
      path,
      preview: patch ? { content: patch, mode: 'diff' } : undefined,
      summary: output.idempotent === true ? '补丁已经应用过' : '补丁已精确应用',
    };
  }
  if (name === 'write_file') {
    const content = text(input, 'content');
    return {
      expandable: Boolean(content && content.split(/\r?\n/u).length > 5),
      metrics: content
        ? [
            { label: '行', value: String(lineCount(content)) },
            { label: '字符', value: String(content.length) },
          ]
        : [],
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

function streamingFilePresentation(
  item: SessionUiItem,
  input: JsonRecord,
): Partial<Pick<ToolPresentation, 'metrics' | 'path' | 'summary'>> {
  const rawInput = item.toolInput;
  const path = text(input, 'path') ?? partialJsonString(rawInput, 'path');
  const waiting = item.toolPhase === 'ready';
  const executing = item.toolPhase === 'executing';
  if (item.toolName === 'write_file') {
    const content = text(input, 'content') ?? partialJsonString(rawInput, 'content');
    return {
      metrics: content === undefined
        ? []
        : [
            { label: '已编写', value: `${lineCount(content)} 行` },
            { label: '字符', value: String(content.length) },
          ],
      path,
      summary: executing ? '正在写入文件…' : waiting ? '写入参数已就绪' : '正在编写文件内容…',
    };
  }
  if (item.toolName === 'apply_patch') {
    const patch = text(input, 'patch') ?? partialJsonString(rawInput, 'patch');
    return {
      metrics: patch === undefined ? [] : patchMetrics(patch),
      path,
      summary: executing ? '正在应用补丁…' : waiting ? '补丁参数已就绪' : '正在生成补丁…',
    };
  }
  return {
    path,
    summary: executing ? '正在执行工具…' : waiting ? '参数已就绪，等待执行…' : '正在生成调用参数…',
  };
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
  name: string,
  input: JsonRecord,
  output: JsonRecord,
  outputValue: unknown,
): Partial<
  Pick<
    ToolPresentation,
    'expandable' | 'icon' | 'metrics' | 'preview' | 'rows' | 'summary' | 'title' | 'tone' | 'webAction' | 'webSearch'
  >
> {
  const action = record(output.action);
  const actionQueries = Array.isArray(action.queries)
    ? action.queries.filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0 && !value.startsWith('ws_call_id='),
      )
    : [];
  const fallbackQuery =
    text(action, 'query') ?? actionQueries[0] ?? text(output, 'query') ?? text(input, 'query');
  const errorCode = text(output, 'error_code', 'errorCode');
  if (errorCode) {
    const message = text(output, 'message') ?? errorCode;
    return {
      expandable: false,
      metrics: [{ label: '状态', tone: 'warning', value: errorCode }],
      preview: { content: message, mode: 'text' },
      rows: [],
      summary: `网页暂不可用 · ${message}`,
      tone: 'warning',
    };
  }

  const pageUrl = text(action, 'url') ?? text(output, 'url') ?? text(input, 'url') ?? '';
  const pageUrlValue = safeWebUrl(pageUrl);
  const pageMatches = records(output.matches);
  if (
    name === 'find_in_page' ||
    action.type === 'findInPage' ||
    action.type === 'find_in_page' ||
    pageMatches.length > 0 ||
    number(output, 'total_matches') !== undefined
  ) {
    const pattern = text(action, 'pattern') ?? text(output, 'pattern') ?? text(input, 'pattern') ?? '页内内容';
    const results = pageMatches.map((match, index): ToolWebSearchResult => ({
      domain: pageUrlValue ? domain(pageUrlValue.href) : undefined,
      faviconDarkUrl: pageUrlValue ? resolveWebsiteFavicon(pageUrlValue).darkUrl : undefined,
      faviconFallbackUrl: pageUrlValue ? resolveWebsiteFavicon(pageUrlValue).fallbackUrl : undefined,
      faviconLightUrl: pageUrlValue ? resolveWebsiteFavicon(pageUrlValue).lightUrl : undefined,
      snippet: text(match, 'context'),
      title: `第 ${index + 1} 处匹配`,
      url: pageUrlValue?.href,
    }));
    const explicitTotal = number(output, 'total_matches');
    const totalResults = explicitTotal ?? results.length;
    return {
      expandable: results.length > 3,
      icon: 'fa-solid fa-magnifying-glass',
      metrics: [],
      rows: [],
      summary: `查找“${pattern}” · ${explicitTotal !== undefined || results.length > 0 ? `${totalResults} 处匹配` : '结果明细未返回'}`,
      title: '页内查找',
      webAction: {
        matches: results.map(result => result.snippet).filter((value): value is string => Boolean(value)),
        pattern,
        target: pageUrlValue ? webTarget(pageUrlValue) : undefined,
        totalMatches: explicitTotal ?? (results.length > 0 ? results.length : undefined),
        type: 'find',
      },
    };
  }

  const pageContent = text(output, 'content');
  if (
    name === 'open_page' ||
    action.type === 'openPage' ||
    action.type === 'open_page' ||
    (pageUrlValue && pageContent)
  ) {
    const title = text(output, 'title') ?? (pageUrlValue ? domain(pageUrlValue.href) : '网页内容');
    return {
      expandable: false,
      icon: 'fa-solid fa-arrow-up-right-from-square',
      metrics: [],
      rows: [],
      summary: `${title} · ${pageContent ? '网页正文已读取' : '网页已打开'}`,
      title: '打开网页',
      webAction: {
        contentPreview: pageContent ? compactLine(pageContent, '网页正文已读取') : undefined,
        target: pageUrlValue ? webTarget(pageUrlValue) : undefined,
        type: 'open',
      },
    };
  }

  const groupedOutput = Array.isArray(outputValue)
    ? records(outputValue)
        .map(group => ({
          query: text(group, 'query'),
          results: webSearchResults(group.results ?? group.sources),
        }))
        .filter(group => group.results.length > 0)
    : [];
  const directResults = webSearchResults(action.sources ?? output.sources ?? output.results);
  const groups =
    groupedOutput.length > 0
      ? groupedOutput
      : directResults.length > 0
        ? [{ query: fallbackQuery, results: directResults }]
        : [];
  const totalResults = groups.reduce((total, group) => total + group.results.length, 0);
  return {
    expandable: groups.some(group => group.results.length > 3),
    metrics: [],
    rows: [],
    summary: fallbackQuery
      ? `搜索“${fallbackQuery}”${totalResults > 0 ? ` · ${totalResults} 条结果` : ''}`
      : totalResults > 0
        ? `找到 ${totalResults} 条结果`
        : '联网搜索已完成',
    webAction: {
      queries: [
        ...new Set([
          ...actionQueries,
          ...groups.map(group => group.query).filter((value): value is string => Boolean(value)),
          ...(fallbackQuery ? [fallbackQuery] : []),
        ]),
      ],
      resultsReturned: totalResults > 0,
      type: 'search',
    },
    webSearch: groups.length > 0 ? { groups, totalResults } : undefined,
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
    details = descriptor.kind === 'file'
      ? streamingFilePresentation(item, input)
      : {
          summary:
            item.toolPhase === 'generating'
              ? '正在生成调用参数…'
              : item.toolPhase === 'ready'
                ? '参数已就绪，等待执行…'
                : '正在执行工具…',
        };
  } else if (descriptor.kind === 'file') {
    details = filePresentation(item.toolName ?? '', input, output, outputValue);
  } else if (descriptor.kind === 'search') {
    details = fileSearchPresentation(input, output);
  } else if (descriptor.kind === 'worldbook') {
    details = worldbookPresentation(item.toolName ?? '', input, output);
  } else if (descriptor.kind === 'tavern') {
    details = tavernPresentation(item.toolName ?? '', input, output);
  } else if (descriptor.kind === 'web') {
    details = webPresentation(item.toolName ?? '', input, output, outputValue);
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
    rawOutput:
      item.status !== 'running'
        ? formatToolRaw(item.content)
        : item.toolPhase === 'generating'
          ? '正在生成调用参数…'
          : item.toolPhase === 'ready'
            ? '参数已就绪，等待执行…'
            : '等待工具返回…',
    rows: [],
    summary: item.status === 'running' ? '正在执行工具…' : '工具执行完成',
    ...details,
  };
}
