export const IMAGE_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;
export const IMAGE_COMPRESSION_QUALITY = 0.9;

const COMPRESSIBLE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type ImageCompressionResult = {
  bytes: Uint8Array;
  compressed: boolean;
  mediaType: string;
};

export type RasterImageEncoder = (
  bytes: Uint8Array,
  mediaType: string,
  quality: number,
) => Promise<Uint8Array>;

async function canvasEncoder(bytes: Uint8Array, mediaType: string, quality: number): Promise<Uint8Array> {
  const source = new Blob([Uint8Array.from(bytes).buffer], { type: mediaType });
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建图片压缩画布。');
      context.drawImage(bitmap, 0, 0);
      const output = await canvas.convertToBlob({ quality, type: 'image/webp' });
      return new Uint8Array(await output.arrayBuffer());
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片压缩画布。');
    context.drawImage(bitmap, 0, 0);
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('浏览器无法编码WebP图片。'))), 'image/webp', quality);
    });
    return new Uint8Array(await output.arrayBuffer());
  } finally {
    bitmap.close();
  }
}

export function shouldCompressImage(mediaType: string, size: number, enabled: boolean): boolean {
  return enabled && size > IMAGE_COMPRESSION_THRESHOLD_BYTES && COMPRESSIBLE_MEDIA_TYPES.has(mediaType.toLowerCase());
}

export async function compressImageForModel(
  bytes: Uint8Array,
  mediaType: string,
  enabled: boolean,
  encoder: RasterImageEncoder = canvasEncoder,
): Promise<ImageCompressionResult> {
  if (!shouldCompressImage(mediaType, bytes.byteLength, enabled)) {
    return { bytes: Uint8Array.from(bytes), compressed: false, mediaType };
  }
  try {
    const compressed = await encoder(bytes, mediaType, IMAGE_COMPRESSION_QUALITY);
    if (compressed.byteLength >= bytes.byteLength) {
      return { bytes: Uint8Array.from(bytes), compressed: false, mediaType };
    }
    return { bytes: compressed, compressed: true, mediaType: 'image/webp' };
  } catch {
    return { bytes: Uint8Array.from(bytes), compressed: false, mediaType };
  }
}
