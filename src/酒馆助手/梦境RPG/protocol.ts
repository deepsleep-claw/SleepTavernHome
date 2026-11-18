export type RpgMode = 'open' | 'secret' | 'none';
export type RpgDc = number | 'unset' | 'none';
export type RpgTheme = 'light' | 'dark';
export interface RpgSettings {
  enabled: boolean;
  reuse_rolls: boolean;
  preview_results: boolean;
  allow_secret_reveal: boolean;
  theme: 'auto' | RpgTheme;
}

export interface RpgOption {
  text: string;
  mode: RpgMode;
  dc: number | 'none';
  error?: string;
}

export interface RpgEntry {
  id: string;
  kind: 'inline' | 'group';
  type: 'handle' | 'explore';
  q: string;
  mode: RpgMode;
  options: RpgOption[];
  error?: string;
}

export type ProseItem = { kind: 'text'; text: string } | { kind: 'option'; entry: RpgEntry };
export type RpgPart = { kind: 'prose'; items: ProseItem[] } | { kind: 'group'; entry: RpgEntry };
export interface RpgRegistry {
  version: 1;
  source: string;
  entries: RpgEntry[];
  parts: RpgPart[];
}
export type RollCache = Record<string, number>;
export interface AnswerToken {
  raw: string;
  start: number;
  attributes: Record<string, string>;
  text: string;
}
export interface RpgSnapshot {
  registry: RpgRegistry;
  theme: RpgTheme;
  interactive: boolean;
  selected: Record<string, string>;
  settings: RpgSettings;
}
export interface DreamRpgApi {
  readonly version: number;
  readonly active: boolean;
  snapshot: (messageId: number) => RpgSnapshot;
  choose: (messageId: number, id: string, select?: number, text?: string) => void;
  openSettings: () => void;
  updateSettings: (settings: Partial<RpgSettings>) => void;
}

export const STATE_KEY = 'dream_rpg';
export const GLOBAL_KEY = 'DreamRpg';
const idPattern = /^[a-z][a-z0-9_]*$/i;
const tagAttributes = String.raw`(?:"[^"]*"|'[^']*'|[^'">])*`;

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;').replace(/\r?\n/g, '&#10;');
}

function decode(value: string): string {
  const element = document.createElement('textarea');
  element.innerHTML = value;
  return element.value;
}

export function readAttributes(value: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const match of value.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
  }
  return result;
}

export function answerTokens(message: string): AnswerToken[] {
  const pattern = new RegExp(`<rpg_ans\\b(${tagAttributes})>([\\s\\S]*?)<\\/rpg_ans\\s*>`, 'gi');
  return [...message.matchAll(pattern)].map(match => ({
    raw: match[0],
    start: match.index!,
    attributes: readAttributes(match[1]),
    text: decode(match[2]).trim(),
  }));
}

export function checkTokens(message: string): AnswerToken[] {
  const attributes = String.raw`(?:"[^"]*"|'[^']*'|[^'">/])*`;
  const pattern = new RegExp(`<rpg_check\\b(${attributes})(?:\\/\\s*>|>([\\s\\S]*?)<\\/rpg_check\\s*>)`, 'gi');
  return [...message.matchAll(pattern)].map(match => ({
    raw: match[0],
    start: match.index!,
    attributes: readAttributes(match[1]),
    text: decode(match[2] ?? '').trim(),
  }));
}

function modeOf(value: string | null | undefined, fallback: RpgMode = 'open'): RpgMode {
  return value === 'none' || value === 'secret' || value === 'open' ? value : fallback;
}

function readOption(node: Element, inherited: RpgMode): RpgOption {
  const requested = node.getAttribute('mode');
  const mode = modeOf(node.getAttribute('mode'), inherited);
  const text = (node.textContent ?? '').trim();
  if (requested !== null && !['open', 'secret', 'none'].includes(requested)) {
    return { text, mode, dc: 'none', error: '行动类型需要为 open、secret 或 none' };
  }
  if (mode === 'none') return { text, mode, dc: 'none', ...(!text && { error: '行动内容为空' }) };
  const raw = node.getAttribute('dc') ?? '';
  const dc = Number(raw);
  const valid = /^\d+$/.test(raw) && dc >= 5 && dc <= 95;
  return { text, mode, dc, ...((!valid || !text) && { error: !text ? '行动内容为空' : '成功率需要为 5–95 的整数' }) };
}

export function parseRpgMessage(message: string): RpgRegistry {
  const source = [...message.matchAll(/<dream_rpg\b[^>]*>([\s\S]*?)<\/dream_rpg\s*>/gi)]
    .map(match => match[1])
    .join('\n');
  const root = document.createElement('template');
  root.innerHTML = source;
  const entries: RpgEntry[] = [];
  const parts: RpgPart[] = [];
  let items: ProseItem[] = [];
  const flush = () => {
    if (!items.length) return;
    const text = items.map(item => (item.kind === 'text' ? item.text : item.entry.options[0].text)).join('');
    let offset = 0;
    for (const item of items) {
      const length = item.kind === 'text' ? item.text.length : item.entry.options[0].text.length;
      if (item.kind === 'option') {
        const before = text.slice(0, offset);
        const after = text.slice(offset + length);
        const boundary = /[。！？!?；;\n]/g;
        const start = [...before.matchAll(boundary)].at(-1)?.index;
        const end = after.search(boundary);
        item.entry.q = text
          .slice(start === undefined ? 0 : start + 1, end < 0 ? text.length : offset + length + end + 1)
          .trim();
      }
      offset += length;
    }
    if (text.trim()) parts.push({ kind: 'prose', items });
    items = [];
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      items.push({ kind: 'text', text: node.textContent ?? '' });
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const element = node as Element;
    const tag = element.localName;
    if (['script', 'style', 'iframe', 'template'].includes(tag)) return;
    if (tag === 'group') {
      flush();
      const copy = element.cloneNode(true) as Element;
      copy.querySelectorAll('opt, group').forEach(child => child.remove());
      const mode = modeOf(element.getAttribute('mode'));
      const entry: RpgEntry = {
        id: element.getAttribute('id') ?? '',
        kind: 'group',
        type: element.getAttribute('type') === 'handle' ? 'handle' : 'explore',
        q: (copy.textContent ?? '').trim(),
        mode,
        options: [...element.children].filter(child => child.localName === 'opt').map(child => readOption(child, mode)),
      };
      if (entry.options.length < 2 || entry.options.length > 4) entry.error = '选项组需要包含 2–4 个行动';
      entries.push(entry);
      parts.push({ kind: 'group', entry });
      return;
    }
    if (tag === 'opt') {
      const option = readOption(element, 'open');
      const entry: RpgEntry = {
        id: element.getAttribute('id') ?? '',
        kind: 'inline',
        type: 'explore',
        q: '',
        mode: option.mode,
        options: [option],
      };
      entries.push(entry);
      items.push({ kind: 'option', entry });
      return;
    }
    if (tag === 'br') items.push({ kind: 'text', text: '\n' });
    node.childNodes.forEach(walk);
    if (['p', 'div'].includes(tag)) items.push({ kind: 'text', text: '\n' });
  };
  walk(root.content);
  flush();
  for (const entry of entries) {
    if (!idPattern.test(entry.id)) entry.error = '行动 ID 需要使用英文字母、数字和下划线';
    else if (entries.filter(other => other.id === entry.id).length > 1) entry.error = '行动 ID 重复';
  }
  return { version: 1, source, entries, parts };
}

export function upsertDraft(input: string, id: string, select: number | undefined, text: string): string {
  const draft = `<rpg_ans id="${escapeAttribute(id)}"${select === undefined ? '' : ` select="${select}"`}>\n${escapeText(text)}\n</rpg_ans>`;
  const matches = answerTokens(input).filter(token => token.attributes.id === id);
  if (!matches.length) return input + (input && !input.endsWith('\n') ? '\n' : '') + draft;
  let result = input;
  for (const token of [...matches].reverse()) {
    result =
      result.slice(0, token.start) + (token === matches[0] ? draft : '') + result.slice(token.start + token.raw.length);
  }
  return result;
}

function dcOf(value: string | undefined): RpgDc | undefined {
  if (value === 'none' || value === 'unset') return value;
  const numeric = Number(value);
  return value && /^\d+$/.test(value) && numeric >= 5 && numeric <= 95 ? numeric : undefined;
}

export function rollD100(): number {
  const values = new Uint32Array(1);
  // 丢弃不能均分为 100 份的尾部，保持各点数的概率一致。
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= 4294967200);
  return (values[0] % 100) + 1;
}

function resolveAnswer(token: AnswerToken, registry: RpgRegistry | undefined) {
  const attrs = token.attributes;
  const dc = dcOf(attrs.dc);
  if (attrs.q !== undefined && dc !== undefined)
    return { q: attrs.q, mode: modeOf(attrs.mode, dc === 'none' ? 'none' : 'open'), dc };

  const entry = registry?.entries.find(item => item.id === attrs.id && !item.error);
  if (!entry || !token.text) return;
  const select = attrs.select === undefined ? undefined : /^-?\d+$/.test(attrs.select) ? Number(attrs.select) : NaN;
  if (entry.kind === 'inline' && select !== undefined) return;
  if (entry.kind === 'group' && (select === undefined || !Number.isInteger(select) || select < -1)) return;
  const option = entry.kind === 'inline' ? entry.options[0] : select === -1 ? undefined : entry.options[select!];
  if ((select !== -1 && !option) || option?.error) return;
  if (option && token.text === option.text) return { q: entry.q, mode: option.mode, dc: option.dc };
  const mode = option?.mode ?? entry.mode;
  return { q: entry.q, mode: mode === 'none' ? 'open' : mode, dc: 'unset' as const };
}

function answerRollKey(q: string, mode: RpgMode, dc: RpgDc, text: string): string {
  return JSON.stringify([q, mode, dc, text]);
}

export function settleAnswers(
  message: string,
  registry: RpgRegistry | undefined,
  cache: RollCache,
  reuse: boolean,
  roll = rollD100,
) {
  const rolls = { ...cache };
  const records: Array<{ q: string; text: string; mode: RpgMode; dc: RpgDc; check?: number }> = [];
  let output = '';
  let offset = 0;
  for (const token of answerTokens(message)) {
    const attrs = token.attributes;
    if ('check' in attrs) {
      const q = attrs.q;
      const dc = dcOf(attrs.dc);
      const mode = modeOf(attrs.mode, dc === 'none' ? 'none' : 'open');
      const check = Number(attrs.check);
      if (q !== undefined && dc !== undefined && Number.isInteger(check) && check >= 1 && check <= 100) {
        rolls[answerRollKey(q, mode, dc, token.text)] = check;
        records.push({ q, text: token.text, mode, dc, check });
      }
      continue;
    }
    const resolved = resolveAnswer(token, registry);
    if (!resolved) continue;
    const { q, mode, dc } = resolved;
    const key = answerRollKey(q, mode, dc, token.text);
    const saved = rolls[key];
    const check =
      dc === 'none' ? undefined : reuse && Number.isInteger(saved) && saved >= 1 && saved <= 100 ? saved : roll();
    if (check !== undefined) rolls[key] = check;
    const replacement = `<rpg_ans mode="${dc === 'none' ? 'none' : mode}" q="${escapeAttribute(q)}" dc="${dc}"${check === undefined ? '' : ` check="${check}"`}>${escapeText(token.text)}</rpg_ans>`;
    records.push({ q, text: token.text, mode, dc, ...(check !== undefined && { check }) });
    output += message.slice(offset, token.start) + replacement;
    offset = token.start + token.raw.length;
  }
  return { message: output + message.slice(offset), rolls, records };
}
