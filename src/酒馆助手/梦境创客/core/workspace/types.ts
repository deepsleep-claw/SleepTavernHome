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
  mediaType: 'text/markdown' | 'text/plain' | 'text/yaml';
  path: string;
  readonly: boolean;
  resourceId: string;
};

export type SearchQuery = {
  caseSensitive?: boolean;
  contextLines?: number;
  fixedStrings?: boolean;
  glob?: string;
  maxResults?: number;
  path?: string;
  pattern: string;
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

export type WorkspaceChange =
  | { after: WorkspaceFile; kind: 'create'; path: string }
  | { before: WorkspaceFile; kind: 'delete'; path: string }
  | { after: WorkspaceFile; before: WorkspaceFile; kind: 'modify'; path: string }
  | { after: WorkspaceFile; before: WorkspaceFile; from: string; kind: 'move'; path: string };

export interface WorkspaceRepository {
  list(path: string): Promise<WorkspaceEntry[]>;
  read(path: string): Promise<WorkspaceFile>;
  write(path: string, content: string, toolCallId: string): Promise<void>;
  patch(path: string, patch: string, toolCallId: string): Promise<void>;
  move(from: string, to: string, toolCallId: string): Promise<void>;
  remove(path: string, toolCallId: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult>;
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
