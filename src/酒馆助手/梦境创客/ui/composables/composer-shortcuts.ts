import { findComposerCommand, parseComposerCommand, type ComposerCommand } from '../../core/session/composer-commands';
export { fileReference as fileMention } from '../../core/session/composer-references';

export type ComposerShortcut = {
  kind: 'command' | 'reference' | 'argument';
  command?: ComposerCommand;
  query: string;
  start: number;
  end: number;
};

export function composerShortcut(text: string, caret: number): ComposerShortcut | undefined {
  const prefix = text.slice(0, caret);
  const lineStart = prefix.lastIndexOf('\n') + 1;
  const line = prefix.slice(lineStart);
  if ((prefix.match(/^\s*(?:```|~~~)/gmu)?.length ?? 0) % 2 || (line.match(/`/gu)?.length ?? 0) % 2) return;
  const end = caret + (/^[^\s@]*/u.exec(text.slice(caret))?.[0].length ?? 0);
  const indent = /^[ \t]*/u.exec(line)![0].length;
  const commandLine = line.slice(indent);
  const commandStart = lineStart + indent;
  const commandAllowed = !prefix.slice(0, commandStart).trim();
  if (commandAllowed && /^\/[^\s/]*$/u.test(commandLine))
    return { kind: 'command', query: commandLine.slice(1), start: commandStart, end };
  const argument = commandAllowed && /^\/([^\s/]+)[ \t]+([^\s]*)$/u.exec(commandLine);
  const command = argument && findComposerCommand(argument[1]);
  if (argument && command && ['model', 'effort', 'skill'].includes(command.argument))
    return { kind: 'argument', command, query: argument[2], start: caret - argument[2].length, end };
  const mention = /(?:^|\s)@([^\s@]*)$/u.exec(prefix);
  if (mention) return { kind: 'reference', query: mention[1], start: prefix.lastIndexOf('@'), end };
  return undefined;
}

export function isCompressionCommand(text: string): boolean {
  return parseComposerCommand(text)?.command?.id === 'compact';
}
