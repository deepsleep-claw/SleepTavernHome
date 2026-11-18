import { z } from 'zod';

export const PromptEditorSchema = z.object({
  type: z.literal('variable_macro'),
  variable: z
    .string()
    .trim()
    .min(1)
    .regex(/^[^:{}\r\n]+$/),
  operation: z.enum(['setvar', 'addvar']),
});
export type PromptEditorConfig = z.infer<typeof PromptEditorSchema>;

function findVariableBody(content: string, variable: string): { start: number; end: number } | undefined {
  const stack: number[] = [];
  const matches: { start: number; end: number }[] = [];
  for (let index = 0; index < content.length - 1; index += 1) {
    const pair = content.slice(index, index + 2);
    if (pair === '{{') {
      stack.push(index);
      index += 1;
    } else if (pair === '}}' && stack.length > 0) {
      const start = stack.pop()!;
      const header = /^\{\{\s*(?:setvar|addvar)\s*::\s*([^:{}]+?)\s*::/.exec(content.slice(start, index));
      if (header?.[1].trim() === variable) matches.push({ start: start + header[0].length, end: index });
      index += 1;
    }
  }
  if (stack.length > 0) throw new Error('内容中的宏括号不完整，请补全后再编辑。');
  if (matches.length > 1) throw new Error('该条目有多段同名变量内容，无法确定要编辑的正文。');
  return matches[0];
}

function validateBody(body: string) {
  if (!body.trim()) throw new Error('请输入文风内容。');
  let depth = 0;
  for (let index = 0; index < body.length - 1; index += 1) {
    const pair = body.slice(index, index + 2);
    if (pair === '{{') {
      depth += 1;
      index += 1;
    } else if (pair === '}}') {
      if (depth === 0) throw new Error('正文中的宏括号不匹配。');
      depth -= 1;
      index += 1;
    }
  }
  if (depth !== 0) throw new Error('正文中的宏括号不匹配。');
}

export function readPromptBody(content: string, editor: PromptEditorConfig): string {
  const range = findVariableBody(content, editor.variable);
  return range ? content.slice(range.start, range.end) : content;
}

export function writePromptBody(content: string | undefined, body: string, editor: PromptEditorConfig): string {
  validateBody(body);
  if (content === undefined) return `{{${editor.operation}::${editor.variable}::\n${body}\n}}`;
  const range = findVariableBody(content, editor.variable);
  // 只替换目标变量的正文，保留外围提示词与宏包装。
  return range ? content.slice(0, range.start) + body + content.slice(range.end) : body;
}
