function errorFacts(error: unknown, seen = new Set<unknown>()): { text: string; status?: number } {
  if (!error || seen.has(error)) return { text: '' };
  if (typeof error === 'string') return { text: error };
  if (typeof error !== 'object') return { text: '' };
  seen.add(error);
  const value = error as Record<string, unknown>;
  const nested = [value.cause, value.lastError, value.error, ...(Array.isArray(value.errors) ? value.errors : [])].map(
    item => errorFacts(item, seen),
  );
  return {
    text: [value.message, value.code, value.type, value.responseBody, ...nested.map(item => item.text)]
      .filter(item => typeof item === 'string')
      .join(' '),
    status: typeof value.statusCode === 'number' ? value.statusCode : nested.find(item => item.status)?.status,
  };
}

export function isContextExceeded(error: unknown): boolean {
  const { text } = errorFacts(error);
  return /context[_ -](?:length|window)[_ -]exceeded|(?:input|prompt)[_ -]too[_ -]long|too many (?:input |prompt )?tokens|(?:context|prompt|input|messages).{0,90}(?:exceed|too (?:long|large)|maximum context)|maximum context (?:length|window)|上下文.{0,16}(?:超|不足)/iu.test(
    text,
  );
}

export function isRetryableSummaryError(error: unknown): boolean {
  const { text, status } = errorFacts(error);
  if (/abort|cancel|取消/iu.test(text)) return false;
  return (
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500) ||
    /failed to fetch|networkerror|timed? ?out|temporarily unavailable/iu.test(text)
  );
}
