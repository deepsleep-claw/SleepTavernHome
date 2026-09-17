import { describe, expect, it } from 'vitest';
import { normalizeWorkspacePath } from './path';

describe('workspace path', () => {
  it.each(['', '  ', '/a/../b', '/bad\nname', 'C:\\bad'])('拒绝非法路径 %j', value => {
    expect(() => normalizeWorkspacePath(value)).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
  });
});
