import type { WorkspaceOperationRecord, WorkspaceOperationState } from '../../core/operations/types';
import type { WorkspaceFile } from '../../core/workspace/types';
import { createUnifiedPatch, parseUnifiedPatch, summarizeUnifiedPatch } from '../../core/workspace/unified-patch';

export type OperationDiffKind = 'create' | 'delete' | 'modify' | 'move';
export type OperationDiffFocus = { filePath?: string; turnId: string };

export type OperationDiffContextRow = {
  content: string;
  kind: 'context';
  newLine?: number;
  oldLine?: number;
};

export type OperationDiffRow =
  | OperationDiffContextRow
  | {
      content: string;
      kind: 'add' | 'delete' | 'meta';
      newLine?: number;
      oldLine?: number;
    }
  | {
      hidden: OperationDiffContextRow[];
      kind: 'fold';
    };

export type OperationDiffFile = {
  actors: Array<WorkspaceOperationRecord['actor']>;
  addedLines: number;
  after?: WorkspaceFile;
  before?: WorkspaceFile;
  binary: boolean;
  id: string;
  kind: OperationDiffKind;
  mediaType: string;
  operationIds: string[];
  originalPath?: string;
  path: string;
  removedLines: number;
  rows: OperationDiffRow[];
  state: WorkspaceOperationState;
  undoable: boolean;
};

type MutableDiffFile = {
  actors: Set<WorkspaceOperationRecord['actor']>;
  after?: WorkspaceFile;
  before?: WorkspaceFile;
  operationIds: string[];
  originalPath: string;
  path: string;
  states: WorkspaceOperationState[];
  undoable: boolean;
};

function contentLines(content: string): string[] {
  if (!content) return [];
  const lines = content.replace(/\r\n?|\n/gu, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function payloadBefore(record: WorkspaceOperationRecord): WorkspaceFile | undefined {
  const payload = record.forward;
  if (payload.kind === 'create') return undefined;
  if (payload.kind === 'delete') return payload.file;
  return payload.before;
}

function payloadAfter(record: WorkspaceOperationRecord): WorkspaceFile | undefined {
  const payload = record.forward;
  if (payload.kind === 'delete') return undefined;
  if (payload.kind === 'create') return payload.file;
  return payload.after;
}

function payloadOriginalPath(record: WorkspaceOperationRecord): string {
  return record.forward.kind === 'move' ? record.forward.from : record.forward.path;
}

function aggregateState(states: WorkspaceOperationState[]): WorkspaceOperationState {
  if (states.includes('uncertain')) return 'uncertain';
  if (states.every(state => state === 'undone')) return 'undone';
  return 'applied';
}

function isBinary(before?: WorkspaceFile, after?: WorkspaceFile): boolean {
  const file = after ?? before;
  if (!file) return false;
  return Boolean((file.external || file.skillResource) && !file.mediaType.startsWith('text/'));
}

function contextRow(content: string, oldLine?: number, newLine?: number): OperationDiffContextRow {
  return { content, kind: 'context', newLine, oldLine };
}

function foldedContext(
  beforeLines: string[],
  afterLines: string[],
  oldStart: number,
  newStart: number,
  oldCount: number,
  newCount: number,
): OperationDiffRow | undefined {
  const count = Math.max(oldCount, newCount);
  if (count <= 0) return undefined;
  const hidden = Array.from({ length: count }, (_, index) =>
    contextRow(
      afterLines[newStart - 1 + index] ?? beforeLines[oldStart - 1 + index] ?? '',
      index < oldCount ? oldStart + index : undefined,
      index < newCount ? newStart + index : undefined,
    ),
  );
  return { hidden, kind: 'fold' };
}

export function buildUnifiedDiffRows(beforeContent: string, afterContent: string, path: string): OperationDiffRow[] {
  if (beforeContent === afterContent) return [];
  const beforeLines = contentLines(beforeContent);
  const afterLines = contentLines(afterContent);
  if (!beforeContent) {
    return afterLines.map((content, index) => ({ content, kind: 'add', newLine: index + 1 }));
  }
  if (!afterContent) {
    return beforeLines.map((content, index) => ({ content, kind: 'delete', oldLine: index + 1 }));
  }

  const patch = parseUnifiedPatch(createUnifiedPatch(path, beforeContent, afterContent), path);
  const rows: OperationDiffRow[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  for (const hunk of patch.hunks) {
    const folded = foldedContext(
      beforeLines,
      afterLines,
      oldCursor,
      newCursor,
      hunk.oldStart - oldCursor,
      hunk.newStart - newCursor,
    );
    if (folded) rows.push(folded);

    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const line of hunk.lines) {
      const prefix = line[0];
      const content = line.slice(1);
      if (prefix === '+') {
        rows.push({ content, kind: 'add', newLine });
        newLine += 1;
      } else if (prefix === '-') {
        rows.push({ content, kind: 'delete', oldLine });
        oldLine += 1;
      } else if (prefix === ' ') {
        rows.push(contextRow(content, oldLine, newLine));
        oldLine += 1;
        newLine += 1;
      } else {
        rows.push({ content: line, kind: 'meta' });
      }
    }
    oldCursor = hunk.oldStart + hunk.oldLines;
    newCursor = hunk.newStart + hunk.newLines;
  }
  const tail = foldedContext(
    beforeLines,
    afterLines,
    oldCursor,
    newCursor,
    beforeLines.length - oldCursor + 1,
    afterLines.length - newCursor + 1,
  );
  if (tail) rows.push(tail);
  return rows;
}

export function buildOperationDiffFiles(records: WorkspaceOperationRecord[]): OperationDiffFile[] {
  const files: MutableDiffFile[] = [];
  const byPath = new Map<string, MutableDiffFile>();
  for (const record of records) {
    const originalPath = payloadOriginalPath(record);
    const path = record.forward.path;
    let file = byPath.get(originalPath) ?? byPath.get(path);
    if (!file) {
      file = {
        actors: new Set(),
        after: payloadAfter(record),
        before: payloadBefore(record),
        operationIds: [],
        originalPath,
        path,
        states: [],
        undoable: true,
      };
      files.push(file);
    }
    byPath.delete(file.path);
    byPath.delete(originalPath);
    file.after = payloadAfter(record);
    file.path = path;
    file.actors.add(record.actor);
    file.operationIds.push(record.operationId);
    file.states.push(record.state);
    file.undoable &&= record.undoable;
    byPath.set(path, file);
  }

  return files.flatMap<OperationDiffFile>(file => {
    if (!file.before && !file.after) return [];
    const kind: OperationDiffKind = !file.before
      ? 'create'
      : !file.after
        ? 'delete'
        : file.originalPath !== file.path
          ? 'move'
          : 'modify';
    const beforeContent = file.before?.content ?? '';
    const afterContent = file.after?.content ?? '';
    const binary = isBinary(file.before, file.after);
    let addedLines = 0;
    let removedLines = 0;
    if (!binary) {
      if (kind === 'create') addedLines = contentLines(afterContent).length;
      else if (kind === 'delete') removedLines = contentLines(beforeContent).length;
      else if (beforeContent !== afterContent) {
        const summary = summarizeUnifiedPatch(createUnifiedPatch(file.path, beforeContent, afterContent), file.path);
        addedLines = summary.addedLines;
        removedLines = summary.removedLines;
      }
    }
    return [
      {
        actors: [...file.actors],
        addedLines,
        after: file.after,
        before: file.before,
        binary,
        id: file.operationIds.join(':'),
        kind,
        mediaType: (file.after ?? file.before)?.mediaType ?? 'text/plain',
        operationIds: file.operationIds,
        originalPath: kind === 'move' ? file.originalPath : undefined,
        path: file.path,
        removedLines,
        rows: binary ? [] : buildUnifiedDiffRows(beforeContent, afterContent, file.path),
        state: aggregateState(file.states),
        undoable: file.undoable,
      },
    ];
  });
}

export function summarizeOperationDiffFiles(files: OperationDiffFile[]) {
  return files.reduce(
    (summary, file) => ({
      addedLines: summary.addedLines + file.addedLines,
      files: summary.files + 1,
      removedLines: summary.removedLines + file.removedLines,
    }),
    { addedLines: 0, files: 0, removedLines: 0 },
  );
}
