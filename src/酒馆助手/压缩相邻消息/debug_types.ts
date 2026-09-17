export type DebugContentReference = {
  详细内容: string;
  详细内容缓存键?: string;
  详细内容长度?: number;
  详细内容字数?: number;
  详细内容摘要?: string;
};

export type DebugPromptPart =
  ({ kind: 'text' } & DebugContentReference) | { kind: 'other'; type: string; signature: string };

export type DebugPromptMessage = {
  role: string;
  metadata: string;
  format: 'text' | 'parts' | 'empty';
  parts: DebugPromptPart[];
};

export type DebugPromptSnapshot = {
  version: 1;
  stage: 'after_squash';
  messages: DebugPromptMessage[];
  text_chars: number;
};

export type DebugGeneration = {
  id: string;
  type: string;
  dry_run: boolean;
  started_at: string;
  chat_id: string;
  character_name: string;
  script_id: string;
  skipped_previews: number;
  pass: number;
  event: string;
};

export type SquashDebugRecord = {
  id: string;
  created_at: string;
  title: string;
  generation?: DebugGeneration;
  token_usage?: DebugTokenUsage;
  summary: {
    error_count: number;
    failed: number;
    green_cache_insertions: number;
    loaded_total: number;
    total_rows: number;
    triggered_rows: number;
    wrapper_orphan: number;
    wrapper_paired: number;
    prompt_chars?: number;
    prompt_messages?: number;
  };
  state: Record<string, any>;
};

export type DebugTokenUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  uncached_input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cache_write_tokens?: number;
  total_tokens?: number;
  model?: string;
  response_id?: string;
  complete: boolean;
  received_at: string;
};
