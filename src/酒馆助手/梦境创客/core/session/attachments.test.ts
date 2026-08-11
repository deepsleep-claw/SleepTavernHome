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

  it('限制单项、总大小与附件数量', () => {
    expect(() => validateAttachmentFiles(Array.from({ length: 11 }, (_, index) => ({ name: `${index}`, size: 1 })))).toThrow(
      '最多添加 10 个附件',
    );
    expect(() => validateAttachmentFiles([{ name: 'huge.bin', size: 21 * 1024 * 1024 }])).toThrow('超过 20MB');
    expect(() =>
      validateAttachmentFiles([
        { name: 'a.bin', size: 20 * 1024 * 1024 },
        { name: 'b.bin', size: 20 * 1024 * 1024 },
        { name: 'c.bin', size: 20 * 1024 * 1024 },
      ]),
    ).toThrow('总大小不能超过 50MB');
  });
});
