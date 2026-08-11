import type { ToolResultPart } from 'ai';

export type ToolResultOutput = ToolResultPart['output'];

export type RichToolOutput = {
  __dreamCreatorRichToolOutput: true;
  display: unknown;
  modelOutput: ToolResultOutput;
};

export function richToolOutput(modelOutput: ToolResultOutput, display: unknown): RichToolOutput {
  return { __dreamCreatorRichToolOutput: true, display, modelOutput };
}

export function isRichToolOutput(value: unknown): value is RichToolOutput {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<RichToolOutput>).__dreamCreatorRichToolOutput === true,
  );
}
