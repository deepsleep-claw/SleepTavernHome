export type ProviderFailure = {
  code: 'AUTH_REJECTED' | 'CORS_SUSPECTED' | 'REQUEST_FAILED';
  message: string;
};

function providerStatusCode(error: unknown, seen = new Set<unknown>()): number | undefined {
  if (!error || typeof error !== 'object' || seen.has(error)) return undefined;
  seen.add(error);
  const value = error as { cause?: unknown; errors?: unknown[]; lastError?: unknown; statusCode?: unknown };
  if (typeof value.statusCode === 'number') return value.statusCode;
  return (
    providerStatusCode(value.lastError, seen) ??
    value.errors?.map(item => providerStatusCode(item, seen)).find(status => status !== undefined) ??
    providerStatusCode(value.cause, seen)
  );
}

export function normalizeProviderFailure(error: unknown): ProviderFailure {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = providerStatusCode(error);
  if (statusCode === 401 || /\b401\b|invalid (?:api )?(?:key|token)|unauthori[sz]ed/iu.test(message)) {
    return {
      code: 'AUTH_REJECTED',
      message: 'API Key被接口拒绝（HTTP 401）。请在API页保存可用的Key，然后从中断处继续。',
    };
  }
  const cors =
    error instanceof TypeError ||
    /failed to fetch|load failed|networkerror|cors|access-control-allow-origin/iu.test(message);
  return cors
    ? {
        code: 'CORS_SUSPECTED',
        message: '浏览器无法访问该接口。请改用允许浏览器跨域访问的地址，或配置本地反向代理。',
      }
    : { code: 'REQUEST_FAILED', message };
}
