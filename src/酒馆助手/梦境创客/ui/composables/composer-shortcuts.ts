import { decodeWorkspaceSegment } from '../../core/mapping/serde';

export type ComposerShortcut = { kind: 'command' | 'file'; query: string; start: number; end: number };

export function composerShortcut(text: string, caret: number): ComposerShortcut | undefined {
  const prefix = text.slice(0, caret);
  if (/^\/[^\s]*$/u.test(prefix)) return { kind: 'command', query: prefix.slice(1), start: 0, end: caret };
  const mention = /(?:^|\s)@([^\s@]*)$/u.exec(prefix);
  if (mention) return { kind: 'file', query: mention[1], start: prefix.lastIndexOf('@'), end: caret };
  return undefined;
}

export function isCompressionCommand(text: string): boolean {
  return /^\/(?:压缩|compact)$/iu.test(text.trim());
}

export function fileMention(path: string): string {
  const name = decodeWorkspaceSegment(path.split('/').at(-1) ?? path).replace(/[\\[\]]/gu, '\\$&');
  const link = encodeURI(path).replace(/[()]/gu, value => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${name}](${link})`;
}
