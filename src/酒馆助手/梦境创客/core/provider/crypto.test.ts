import { describe, expect, it } from 'vitest';
import { decryptLocalPayload, encryptLocalPayload } from './crypto';

describe('provider secrets encryption', () => {
  it('使用随机盐和AES-GCM往返本地凭据', async () => {
    const value = { apiKey: 'secret-key', requestHeaders: { text: 'X-Custom: secret-header' } };
    const first = await encryptLocalPayload(value);
    const second = await encryptLocalPayload(value);
    expect(first).toMatchObject({ algorithm: 'AES-GCM', iterations: 150_000, version: 1 });
    expect(first.ciphertext).not.toContain('secret-key');
    expect(first.salt).not.toBe(second.salt);
    expect(await decryptLocalPayload(first)).toEqual(value);
  });

  it('拒绝未知版本和被篡改密文', async () => {
    const encrypted = await encryptLocalPayload({ key: 'value' });
    await expect(decryptLocalPayload({ ...encrypted, version: 2 as 1 })).rejects.toThrow('不支持');
    await expect(
      decryptLocalPayload({ ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` }),
    ).rejects.toThrow('无法解密');
  });
});
