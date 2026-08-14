import { describe, expect, it } from 'vitest';
import { normalizeProviderFailure } from './provider-failure';

describe('provider failure', () => {
  it('把鉴权、疑似CORS与普通请求失败分开呈现', () => {
    expect(normalizeProviderFailure(new TypeError('Failed to fetch'))).toMatchObject({ code: 'CORS_SUSPECTED' });
    expect(normalizeProviderFailure(new Error('401 Unauthorized'))).toMatchObject({ code: 'AUTH_REJECTED' });
    expect(normalizeProviderFailure({ lastError: { statusCode: 401 } })).toMatchObject({ code: 'AUTH_REJECTED' });
    expect(normalizeProviderFailure(new Error('500 Server Error'))).toEqual({
      code: 'REQUEST_FAILED',
      message: '500 Server Error',
    });
    expect(normalizeProviderFailure('NetworkError')).toMatchObject({ code: 'CORS_SUSPECTED' });
  });
});
