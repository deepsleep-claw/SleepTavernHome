export type WorkspaceEntryKind = 'directory' | 'file';

export type WorkspaceEntry = {
  kind: WorkspaceEntryKind;
  name: string;
  path: string;
  readonly: boolean;
  size?: number;
};

export type WorkspaceFile = {
  content: string;
  external?: {
    fileId: string;
    mediaType: string;
    sha256: string;
    size: number;
    scope: 'persistent' | 'temp';
  };
  mediaType: string;
  path: string;
  readonly: boolean;
  resourceId: string;
  /** Skill二进制资源只投影元信息；内容由全局Skill存储保管。 */
  skillResource?: {
    sha256: string;
    size: number;
  };
};

export type SearchQuery = {
  caseSensitive?: boolean;
  contextAfter?: number;
  contextBefore?: number;
  contextLines?: number;
  excludeGlob?: string | string[];
  /** @deprecated 使用mode: 'literal'或mode: 'regex'。 */
  fixedStrings?: boolean;
  glob?: string | string[];
  maxResults?: number;
  mode?: 'literal' | 'regex';
  path?: string;
  pattern: string;
  wordMatch?: boolean;
};

export type SearchMatch = {
  column: number;
  contextAfter: string[];
  contextBefore: string[];
  line: number;
  path: string;
  text: string;
};

export type SearchResult = {
  matchedFiles: number;
  matches: SearchMatch[];
  returnedMatches: number;
  truncated: boolean;
};

export type WorkspaceWriteOptions = {
  /** 默认false。只有明确允许整体覆盖已有文件时才设为true。 */
  overwrite?: boolean;
};

export type WorkspaceChange =
  | { after: WorkspaceFile; kind: 'create'; path: string }
  | { before: WorkspaceFile; kind: 'delete'; path: string }
  | { after: WorkspaceFile; before: WorkspaceFile; kind: 'modify'; path: string }
  | { after: WorkspaceFile; before: WorkspaceFile; from: string; kind: 'move'; path: string };

export type WorkspaceMutationResult = {
  changes: WorkspaceChange[];
  idempotent?: boolean;
  status: 'partial_success' | 'success' | 'uncertain';
  warning?: string;
};

export interface WorkspaceRepository {
  list(path: string): Promise<WorkspaceEntry[]>;
  read(path: string): Promise<WorkspaceFile>;
  write(path: string, content: string, toolCallId: string, options?: WorkspaceWriteOptions): Promise<void>;
  patch(path: string, patch: string, toolCallId: string): Promise<void>;
  move(from: string, to: string, toolCallId: string): Promise<void>;
  remove(path: string, toolCallId: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult>;
  mutationResult?(toolCallId: string): WorkspaceMutationResult | undefined;
}

export function isBinaryWorkspaceFile(file: WorkspaceFile): boolean {
  return Boolean((file.external || file.skillResource) && !file.mediaType.startsWith('text/'));
}

export class WorkspaceError extends Error {
  constructor(
    public readonly code:
      | 'ALREADY_EXISTS'
      | 'INVALID_GLOB'
      | 'INVALID_PATCH'
      | 'INVALID_PATH'
      | 'INVALID_PATTERN'
      | 'NOT_FOUND'
      | 'READ_ONLY_PATH',
    message: string,
    public readonly path?: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}
