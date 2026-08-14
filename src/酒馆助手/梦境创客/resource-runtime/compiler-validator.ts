import { RegExpParser } from '@eslint-community/regexpp';
import { parseFragment, type ParserError } from 'parse5';
import postcss from 'postcss';

export type RuntimeDiagnostic = { column?: number; line?: number; message: string; severity: 'error' | 'warning' };

export function validateHtml(source: string): RuntimeDiagnostic[] {
  const errors: ParserError[] = [];
  parseFragment(source, { onParseError: error => errors.push(error), scriptingEnabled: true });
  return errors.map(error => ({
    column: error.startCol,
    line: error.startLine,
    message: error.code,
    severity: error.code === 'non-conforming-doctype' ? 'warning' : 'error',
  }));
}

export function validateCss(source: string): RuntimeDiagnostic[] {
  try {
    postcss.parse(source);
    return [];
  } catch (error) {
    const value = error as { column?: number; line?: number; reason?: string };
    return [{ column: value.column, line: value.line, message: value.reason ?? String(error), severity: 'error' }];
  }
}

export function validateRegex(source: string): RuntimeDiagnostic[] {
  try {
    new RegExpParser({ ecmaVersion: 2025 }).parseLiteral(source);
    return [];
  } catch (error) {
    return [{ message: error instanceof Error ? error.message : String(error), severity: 'error' }];
  }
}
