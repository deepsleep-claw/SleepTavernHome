import { describe, expect, it } from 'vitest';
import { normalizeProviderFailure } from './provider-failure';

describe('provider failure', () => {
  it('把鉴权、疑似CORS与普通请求失败分开呈现', () => {
    expect(normalizeProviderFailure(new TypeError('Failed to fetch'))).toMatchObject({ code: 'NETWORK_ERROR' });
    expect(normalizeProviderFailure(new Error('401 Unauthorized'))).toMatchObject({ code: 'AUTH_REJECTED' });
    expect(normalizeProviderFailure({ lastError: { statusCode: 401 } })).toMatchObject({ code: 'AUTH_REJECTED' });
    expect(normalizeProviderFailure(new Error('500 Server Error'))).toEqual({
      code: 'REQUEST_FAILED',
      message: '500 Server Error',
    });
    expect(normalizeProviderFailure('NetworkError')).toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('保留内部 TypeError，递归区分 SDK 包装的网络、取消与超时错误', () => {
    const message = "Cannot read properties of undefined (reading 'cacheReadTokens')";
    expect(normalizeProviderFailure(new TypeError(message))).toEqual({ code: 'REQUEST_FAILED', message });
    expect(normalizeProviderFailure({ message: '重试失败', lastError: new TypeError('Failed to fetch') }).code).toBe('NETWORK_ERROR');
    expect(normalizeProviderFailure(new DOMException('操作中止', 'AbortError')).code).toBe('REQUEST_ABORTED');
    expect(normalizeProviderFailure({ cause: new DOMException('操作中止', 'TimeoutError') }).code).toBe('REQUEST_TIMEOUT');
    expect(normalizeProviderFailure(new Error('Access-Control-Allow-Origin missing')).code).toBe('CORS_SUSPECTED');
    expect(normalizeProviderFailure({ message: '服务器拒绝请求', statusCode: 403, cause: new TypeError('Failed to fetch') })).toMatchObject({ code: 'REQUEST_FAILED' });
  });
});
