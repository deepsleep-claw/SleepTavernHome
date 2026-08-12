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

  it('稳定识别父窗口realm中的正则、URL和日期', () => {
    const foreignRegex = {
      [Symbol.toStringTag]: 'RegExp',
      flags: 'iu',
      source: '跨窗口',
    } as unknown as RegExp;
    const foreignUrl = {
      [Symbol.toStringTag]: 'URL',
      href: 'https://example.com/path',
      toString: () => 'https://example.com/path',
    } as unknown as URL;

    expect(canonicalEqual({ nested: foreignRegex }, { nested: /跨窗口/iu })).toBe(true);
    expect(canonicalEqual(foreignUrl, new URL('https://example.com/path'))).toBe(true);
    const parsed = canonicalParse<{ date: Date }>(canonicalStringify({ date: new Date('2026-08-12T00:00:00Z') }));
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed.date.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('计算一致的SHA-256内容哈希', async () => {
    expect(await sha256('dream')).toBe(await sha256(new TextEncoder().encode('dream')));
    expect(await sha256('dream')).toMatch(/^[a-f\d]{64}$/u);
  });
});
