export type ProviderFailure = {
  code: 'AUTH_REJECTED' | 'CORS_SUSPECTED' | 'NETWORK_ERROR' | 'REQUEST_ABORTED' | 'REQUEST_TIMEOUT' | 'REQUEST_FAILED';
  message: string;
};

function providerStatusCode(error: unknown, seen = new Set<unknown>()): number | undefined {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);
  const value = error as { cause?: unknown; errors?: unknown[]; lastError?: unknown; statusCode?: unknown };
  if (typeof value.statusCode === 'number') return value.statusCode;
  return (
    providerStatusCode(value.lastError, seen) ??
    (Array.isArray(value.errors) ? value.errors.map(item => providerStatusCode(item, seen)).find(status => status !== undefined) : undefined) ??
    providerStatusCode(value.cause, seen)
  );
}

export function normalizeProviderFailure(error: unknown): ProviderFailure {
  const causes: Array<{ message: string; name?: string }> = [];
  const seen = new Set<unknown>();
  function collect(value: unknown) {
    if (!value || seen.has(value) || seen.size >= 32) return;
    seen.add(value);
    if (typeof value === 'string') causes.push({ message: value });
    else if (typeof value === 'object') {
      const item = value as { message?: string; name?: string; cause?: unknown; lastError?: unknown; errors?: unknown[] };
      if (typeof item.message === 'string') causes.push({ message: item.message, name: item.name });
      collect(item.lastError);
      if (Array.isArray(item.errors)) item.errors.forEach(collect);
      collect(item.cause);
    }
  }
  collect(error);
  const message = causes.find(item => item.message)?.message ?? '接口请求失败，未返回错误详情。';
  const details = causes.map(item => item.message).join('\n');
  const statusCode = providerStatusCode(error);
  if (statusCode === 401 || /\b401\b|invalid (?:api )?(?:key|token)|unauthori[sz]ed/iu.test(details)) {
    return {
      code: 'AUTH_REJECTED',
      message: 'API Key被接口拒绝（HTTP 401）。请在API页保存可用的Key，然后从中断处继续。',
    };
  }
  if (statusCode) return { code: 'REQUEST_FAILED', message: `${message}（HTTP ${statusCode}）` };
  if (causes.some(item => item.name === 'TimeoutError') || /timed?\s*out|timeout/iu.test(details))
    return { code: 'REQUEST_TIMEOUT', message: '接口请求超时，请检查连接或稍后重试。' };
  if (causes.some(item => item.name === 'AbortError'))
    return { code: 'REQUEST_ABORTED', message: '接口请求已取消。' };
  if (/cors|access-control-allow-origin|cross-origin/iu.test(details))
    return {
      code: 'CORS_SUSPECTED',
      message: '接口报告了跨域访问限制，请检查接口的跨域配置或本地反向代理。',
    };
  if (/failed to fetch|fetch failed|load failed|networkerror|network request failed|network error/iu.test(details))
    return {
      code: 'NETWORK_ERROR',
      message: '接口连接失败，浏览器未提供具体原因。请检查网络、接口地址、证书及跨域配置；仅凭此错误无法确认是跨域问题。',
    };
  // 数据解析、参数处理等 TypeError 保留原始信息，不能据异常类型判断跨域。
  return { code: 'REQUEST_FAILED', message };
}
