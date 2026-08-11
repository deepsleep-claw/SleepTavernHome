import { describe, expect, it, vi } from 'vitest';
import {
  compressImageForModel,
  IMAGE_COMPRESSION_QUALITY,
  IMAGE_COMPRESSION_THRESHOLD_BYTES,
  shouldCompressImage,
} from './image-compression';

describe('image compression', () => {
  it('只处理超过1MB的JPEG、PNG和WebP', () => {
    expect(shouldCompressImage('image/png', IMAGE_COMPRESSION_THRESHOLD_BYTES + 1, true)).toBe(true);
    expect(shouldCompressImage('image/gif', IMAGE_COMPRESSION_THRESHOLD_BYTES + 1, true)).toBe(false);
    expect(shouldCompressImage('image/png', IMAGE_COMPRESSION_THRESHOLD_BYTES, true)).toBe(false);
    expect(shouldCompressImage('image/png', IMAGE_COMPRESSION_THRESHOLD_BYTES + 1, false)).toBe(false);
  });

  it('固定使用0.9质量输出WebP，不缩小时和失败时保留原图', async () => {
    const original = new Uint8Array(IMAGE_COMPRESSION_THRESHOLD_BYTES + 1).fill(1);
    const smaller = vi.fn(async (_bytes: Uint8Array, _type: string, quality: number) => {
      expect(quality).toBe(IMAGE_COMPRESSION_QUALITY);
      return Uint8Array.of(2, 3);
    });
    expect(await compressImageForModel(original, 'image/png', true, smaller)).toMatchObject({
      bytes: Uint8Array.of(2, 3),
      compressed: true,
      mediaType: 'image/webp',
    });
    expect(
      await compressImageForModel(original, 'image/png', true, async () => new Uint8Array(original.byteLength + 1)),
    ).toMatchObject({ compressed: false, mediaType: 'image/png' });
    expect(
      await compressImageForModel(original, 'image/png', true, async () => {
        throw new Error('encode failed');
      }),
    ).toMatchObject({ compressed: false, mediaType: 'image/png' });
  });
});
