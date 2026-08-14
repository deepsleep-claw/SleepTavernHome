import { parse } from 'yaml';

export type YamlRequestDocument = { text: string };

/** 加密存储的高级请求覆盖。三个编辑框都只接受YAML。 */
export type AdvancedRequestValues = {
  bodyParameters: YamlRequestDocument;
  excludedBodyParameters: YamlRequestDocument;
  requestHeaders: YamlRequestDocument;
};

export const EMPTY_ADVANCED_REQUEST: AdvancedRequestValues = {
  bodyParameters: { text: '' },
  excludedBodyParameters: { text: '' },
  requestHeaders: { text: '' },
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseYaml(text: string, label: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return parse(text);
  } catch (error) {
    throw new Error(`${label}不是有效的YAML。`, { cause: error });
  }
}

export function normalizeYamlRequestDocument(value?: Partial<YamlRequestDocument>): YamlRequestDocument {
  return { text: typeof value?.text === 'string' ? value.text : '' };
}

export function parseBodyParameters(value?: Partial<YamlRequestDocument>): Record<string, unknown> {
  const text = normalizeYamlRequestDocument(value).text;
  const parsed = parseYaml(text, '包含主体参数');
  if (parsed === undefined) return {};
  const object = record(parsed);
  if (!object) throw new Error('包含主体参数的顶层必须是YAML对象。');
  return object;
}

export function parseExcludedBodyParameters(value?: Partial<YamlRequestDocument>): string[] {
  const text = normalizeYamlRequestDocument(value).text;
  const parsed = parseYaml(text, '排除主体参数');
  if (parsed === undefined) return [];
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error('排除主体参数必须是只包含非空字段名的YAML数组。');
  }
  return [...new Set(parsed.map(item => String(item).trim()))];
}

export function parseRequestHeaders(value?: Partial<YamlRequestDocument>): Record<string, string> {
  const text = normalizeYamlRequestDocument(value).text;
  const parsed = parseYaml(text, '包含请求标头');
  if (parsed === undefined) return {};
  const object = record(parsed);
  if (!object) throw new Error('包含请求标头的顶层必须是YAML对象。');
  return normalizeRequestHeaders(object);
}

export function normalizeAdvancedRequestValues(
  value?: {
    bodyParameters?: Partial<YamlRequestDocument>;
    excludedBodyParameters?: Partial<YamlRequestDocument>;
    requestHeaders?: Partial<YamlRequestDocument>;
  },
): AdvancedRequestValues {
  return {
    bodyParameters: normalizeYamlRequestDocument(value?.bodyParameters),
    excludedBodyParameters: normalizeYamlRequestDocument(value?.excludedBodyParameters),
    requestHeaders: normalizeYamlRequestDocument(value?.requestHeaders),
  };
}

export function validateAdvancedRequestValues(value: AdvancedRequestValues): void {
  parseBodyParameters(value.bodyParameters);
  parseExcludedBodyParameters(value.excludedBodyParameters);
  parseRequestHeaders(value.requestHeaders);
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
export function mergeBodyParameterLayers(
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
    result[key] = current && incoming ? mergeBodyParameterLayers(current, incoming) : clone(value);
  }
  return result;
}

export const PROTECTED_REQUEST_FIELDS = new Set([
  'input',
  'messages',
  'model',
  'parallel_tool_calls',
  'stream',
  'stream_options',
  'tool_choice',
  'tools',
]);

export function ignoredBodyParameterFields(value: Record<string, unknown>, excluded: Iterable<string> = []): string[] {
  return [...new Set([
    ...Object.keys(value).filter(key => PROTECTED_REQUEST_FIELDS.has(key)),
    ...[...excluded].filter(key => PROTECTED_REQUEST_FIELDS.has(key)),
  ])];
}

export function applyAdvancedRequestToBody(
  body: Record<string, unknown>,
  bodyParameters: Record<string, unknown>,
  excludedBodyParameters: Iterable<string>,
): Record<string, unknown> {
  const safe = Object.fromEntries(
    Object.entries(bodyParameters).filter(([key]) => !PROTECTED_REQUEST_FIELDS.has(key)),
  );
  const result = mergeBodyParameterLayers(body, safe);
  for (const key of excludedBodyParameters) {
    if (!PROTECTED_REQUEST_FIELDS.has(key)) delete result[key];
  }
  return result;
}

export function createAdvancedRequestFetch(
  bodyParameters: Record<string, unknown>,
  excludedBodyParametersOrFetch: Iterable<string> | typeof fetch = [],
  explicitFetch?: typeof fetch,
): typeof fetch {
  const excludedBodyParameters = typeof excludedBodyParametersOrFetch === 'function'
    ? []
    : excludedBodyParametersOrFetch;
  const fetchImpl = typeof excludedBodyParametersOrFetch === 'function'
    ? excludedBodyParametersOrFetch
    : (explicitFetch ?? globalThis.fetch.bind(globalThis));
  const excluded = [...excludedBodyParameters];
  return async (input, init) => {
    if (typeof init?.body !== 'string' || (Object.keys(bodyParameters).length === 0 && excluded.length === 0)) {
      return fetchImpl(input, init);
    }
    try {
      const body = record(JSON.parse(init.body) as unknown);
      if (!body) return fetchImpl(input, init);
      return fetchImpl(input, {
        ...init,
        body: JSON.stringify(applyAdvancedRequestToBody(body, bodyParameters, excluded)),
      });
    } catch {
      return fetchImpl(input, init);
    }
  };
}
