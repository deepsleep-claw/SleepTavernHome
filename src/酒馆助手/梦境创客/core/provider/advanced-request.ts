import { parse, stringify } from 'yaml';

export type AdvancedRequestFormat = 'json' | 'yaml';

export type AdvancedRequestDocument = {
  format: AdvancedRequestFormat;
  text: string;
};

export type AdvancedRequestValues = {
  extraParameters: AdvancedRequestDocument;
  headers: Record<string, string>;
};

export const EMPTY_ADVANCED_REQUEST: AdvancedRequestValues = {
  extraParameters: { format: 'yaml', text: '' },
  headers: {},
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function normalizeAdvancedRequestDocument(value?: Partial<AdvancedRequestDocument>): AdvancedRequestDocument {
  return {
    format: value?.format === 'json' ? 'json' : 'yaml',
    text: typeof value?.text === 'string' ? value.text : '',
  };
}

export function parseAdvancedRequestDocument(value?: Partial<AdvancedRequestDocument>): Record<string, unknown> {
  const document = normalizeAdvancedRequestDocument(value);
  if (!document.text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = document.format === 'json' ? JSON.parse(document.text) : parse(document.text);
  } catch (error) {
    throw new Error(`自定义附加参数不是有效的${document.format.toUpperCase()}。`, { cause: error });
  }
  const object = record(parsed);
  if (!object) throw new Error('自定义附加参数的顶层必须是对象。');
  return object;
}

export function convertAdvancedRequestDocument(
  value: Partial<AdvancedRequestDocument>,
  format: AdvancedRequestFormat,
): AdvancedRequestDocument {
  const parsed = parseAdvancedRequestDocument(value);
  return {
    format,
    text: Object.keys(parsed).length === 0
      ? ''
      : format === 'json'
        ? JSON.stringify(parsed, null, 2)
        : stringify(parsed).trimEnd(),
  };
}

export function normalizeRequestHeaders(value?: Record<string, unknown>): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => {
      const normalizedName = name.trim();
      if (!normalizedName) throw new Error('自定义请求标头名称不能为空。');
      if (typeof item !== 'string') throw new Error(`自定义请求标头“${normalizedName}”必须是字符串。`);
      return [normalizedName, item];
    }),
  );
}

/** 标头名称大小写不敏感；后面的层覆盖前面的层。 */
export function mergeRequestHeaders(...layers: Array<Record<string, string> | undefined>): Record<string, string> {
  const values = new Map<string, { name: string; value: string }>();
  layers.forEach(layer => {
    Object.entries(layer ?? {}).forEach(([name, value]) => values.set(name.toLocaleLowerCase(), { name, value }));
  });
  return Object.fromEntries([...values.values()].map(item => [item.name, item.value]));
}

function clone(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}

/** Model层的null删除Provider层同名字段；对象递归合并，数组与标量整体覆盖。 */
export function mergeExtraParameterLayers(
  provider: Record<string, unknown>,
  model: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(provider);
  for (const [key, value] of Object.entries(model)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    const current = record(result[key]);
    const incoming = record(value);
    result[key] = current && incoming ? mergeExtraParameterLayers(current, incoming) : clone(value);
  }
  return result;
}

const PROTECTED_REQUEST_FIELDS = new Set([
  'input',
  'messages',
  'model',
  'parallel_tool_calls',
  'stream',
  'stream_options',
  'tool_choice',
  'tools',
]);

export function ignoredExtraParameterFields(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter(key => PROTECTED_REQUEST_FIELDS.has(key));
}

export function applyExtraParametersToBody(
  body: Record<string, unknown>,
  extraParameters: Record<string, unknown>,
): Record<string, unknown> {
  const safe = Object.fromEntries(
    Object.entries(extraParameters).filter(([key]) => !PROTECTED_REQUEST_FIELDS.has(key)),
  );
  return mergeExtraParameterLayers(body, safe);
}

export function createAdvancedRequestFetch(
  extraParameters: Record<string, unknown>,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return async (input, init) => {
    if (typeof init?.body !== 'string' || Object.keys(extraParameters).length === 0) return fetchImpl(input, init);
    try {
      const body = record(JSON.parse(init.body) as unknown);
      if (!body) return fetchImpl(input, init);
      return fetchImpl(input, { ...init, body: JSON.stringify(applyExtraParametersToBody(body, extraParameters)) });
    } catch {
      return fetchImpl(input, init);
    }
  };
}
