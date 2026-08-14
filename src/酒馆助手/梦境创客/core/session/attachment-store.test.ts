import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { MemoryTavernFileClient } from '../persistence/file-client';
import { MemoryAgentSettingsStore } from '../persistence/settings';
import { base64ForBytes, DreamCreatorWorkspaceFileStore } from '../persistence/workspace-file-store';
import { ExternalSessionAttachmentStore } from './attachment-store';
import { userContentWithAttachments } from './attachments';

describe('ExternalSessionAttachmentStore', () => {
  it('新附件只在会话保存文件引用，请求前才临时装入Base64', async () => {
    const files = new DreamCreatorWorkspaceFileStore(
      new MemoryTavernFileClient(),
      new MemoryAgentSettingsStore(),
    );
    const store = new ExternalSessionAttachmentStore('role', files, new MemoryAgentSettingsStore());
    const [attachment] = await store.save('session', [
      { data: 'AQID', filename: 'card.png', mediaType: 'image/png', size: 3 },
    ]);
    expect(attachment.data).toBeUndefined();
    expect(attachment.logicalPath).toBe('/character/files/card.png');
    const persisted: ModelMessage[] = [
      { content: userContentWithAttachments('看看', [attachment]), role: 'user' },
    ];
    const prepared = await store.prepareMessages('session', persisted);
    expect(prepared).toMatchObject([
      {
        content: [
          { text: '看看', type: 'text' },
          { data: { data: 'AQID', type: 'data' }, mediaType: 'image/png', type: 'file' },
        ],
        role: 'user',
      },
    ]);
    expect(persisted[0]).toMatchObject({
      content: [
        { type: 'text' },
        { data: { text: expect.stringContaining('dreamcreator-file://'), type: 'text' }, type: 'file' },
      ],
    });
  });

  it('首次向模型发送大图时压成同尺寸WebP语义并缓存到当前会话 Temp', async () => {
    const settings = new MemoryAgentSettingsStore();
    const files = new DreamCreatorWorkspaceFileStore(new MemoryTavernFileClient(), settings);
    const encoder = vi.fn(async (_bytes: Uint8Array, _mediaType: string, quality: number) => {
      expect(quality).toBe(0.9);
      return Uint8Array.of(8, 9);
    });
    const store = new ExternalSessionAttachmentStore('role', files, settings, encoder);
    const bytes = new Uint8Array(1024 * 1024 + 1).fill(7);
    const [attachment] = await store.save('session', [
      { data: base64ForBytes(bytes), filename: 'large.png', mediaType: 'image/png', size: bytes.byteLength },
    ]);
    const messages: ModelMessage[] = [
      { content: userContentWithAttachments('', [attachment]), role: 'user' },
    ];
    const first = await store.prepareMessages('session', messages);
    const second = await store.prepareMessages('session', messages);
    expect(encoder).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject([{ content: [{ data: { data: 'CAk=', type: 'data' }, mediaType: 'image/webp' }] }]);
    expect(second).toEqual(first);
    expect(files.listReferences('role')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: 'character-persistent' }),
        expect.objectContaining({ mediaType: 'image/webp', scope: 'character-temp', sourceFileId: attachment.fileId }),
      ]),
    );
  });
});
