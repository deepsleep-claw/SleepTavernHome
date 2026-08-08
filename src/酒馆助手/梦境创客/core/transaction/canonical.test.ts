import { describe, expect, it } from 'vitest';
import { canonicalEqual, canonicalParse, canonicalStringify, sha256 } from './canonical';

describe('canonical data', () => {
  it('稳定排序对象字段并往返正则', () => {
    const serialized = canonicalStringify({ z: 1, a: /hello/iu, omitted: undefined });
    expect(serialized.indexOf('"a"')).toBeLessThan(serialized.indexOf('"z"'));
    const parsed = canonicalParse<{ a: RegExp; z: number }>(serialized);
    expect(parsed.a).toBeInstanceOf(RegExp);
    expect(parsed.a.source).toBe('hello');
    expect(parsed.a.flags).toBe('iu');
    expect(canonicalEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
  });

  it('计算一致的SHA-256内容哈希', async () => {
    expect(await sha256('dream')).toBe(await sha256(new TextEncoder().encode('dream')));
    expect(await sha256('dream')).toMatch(/^[a-f\d]{64}$/u);
  });
});
