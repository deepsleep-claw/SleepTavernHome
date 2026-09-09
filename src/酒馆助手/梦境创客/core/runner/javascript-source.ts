import { parse } from 'acorn';

export function prepareJavascriptBody(source: string): string {
  const program = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
  const last = program.body.at(-1);
  if (last?.type !== 'ExpressionStatement') return source;
  return `${source.slice(0, last.start)}return (${source.slice(last.expression.start, last.expression.end)});${source.slice(last.end)}`;
}
