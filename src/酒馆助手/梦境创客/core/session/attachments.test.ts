import { describe, expect, it, vi } from 'vitest';
import {
  attachmentSummary,
  fileToSessionAttachment,
  storeSessionAttachments,
  userContentWithAttachments,
  validateAttachmentFiles,
} from './attachments';

describe('session attachments', () => {
  it('把浏览器文件转换为可持久化的Base64附件', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'card.png', { type: 'image/png' });
    const attachment = await fileToSessionAttachment(file);
    expect(attachment).toEqual({ data: 'AQID', filename: 'card.png', mediaType: 'image/png', size: 3 });
  });

  it('为模型生成文本与FilePart组合，但界面摘要不暴露正文', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const [stored] = storeSessionAttachments([
      { data: 'AQID', filename: 'card.png', mediaType: 'image/png', size: 3 },
    ]);
    expect(attachmentSummary(stored)).toEqual({
      filename: 'card.png',
      id: '00000000-0000-4000-8000-000000000001',
      mediaType: 'image/png',
      size: 3,
    });
    expect(userContentWithAttachments('检查图片', [stored])).toEqual([
      { text: '检查图片', type: 'text' },
      {
        data: { data: 'AQID', type: 'data' },
        filename: 'card.png',
        mediaType: 'image/png',
        type: 'file',
      },
    ]);
  });

  it('仅限制单文件大小，不限制数量与合计大小', () => {
    expect(() =>
      validateAttachmentFiles(Array.from({ length: 100 }, (_, index) => ({ name: `${index}`, size: 1024 * 1024 }))),
    ).not.toThrow();
    expect(() => validateAttachmentFiles([{ name: 'huge.bin', size: 21 * 1024 * 1024 }])).toThrow('超过 20MB');
    expect(() =>
      validateAttachmentFiles([
        { name: 'a.bin', size: 20 * 1024 * 1024 },
        { name: 'b.bin', size: 20 * 1024 * 1024 },
        { name: 'c.bin', size: 20 * 1024 * 1024 },
      ]),
    ).not.toThrow();
  });

  it('外部附件引用可安全结构化复制，并在请求前被替换', async () => {
    const content = userContentWithAttachments('检查', [
      { fileId: 'file-1', filename: 'a.png', id: 'a', mediaType: 'image/png', size: 3 },
    ]);
    expect(() => structuredClone(content)).not.toThrow();
    expect(content).toEqual([
      { text: '检查', type: 'text' },
      {
        data: { text: 'dreamcreator-file://file-1', type: 'text' },
        filename: 'a.png',
        mediaType: 'image/png',
        type: 'file',
      },
    ]);
  });
});
