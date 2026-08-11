import type { FilePart, UserContent } from 'ai';

export const MAX_ATTACHMENT_COUNT = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 50 * 1024 * 1024;

export type SessionAttachmentInput = {
  data: string;
  filename: string;
  mediaType: string;
  size: number;
};

export type StoredSessionAttachment = SessionAttachmentInput & {
  id: string;
};

export type SessionAttachmentSummary = Omit<StoredSessionAttachment, 'data'>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function validateAttachmentFiles(files: Pick<File, 'name' | 'size'>[]): void {
  if (files.length > MAX_ATTACHMENT_COUNT) throw new Error(`每条消息最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`);
  const oversized = files.find(file => file.size > MAX_ATTACHMENT_BYTES);
  if (oversized) throw new Error(`附件“${oversized.name}”超过 20MB 上限。`);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw new Error('单条消息的附件总大小不能超过 50MB。');
  }
}

export async function fileToSessionAttachment(file: File): Promise<SessionAttachmentInput> {
  validateAttachmentFiles([file]);
  return {
    data: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    filename: file.name.trim() || '未命名附件',
    mediaType: file.type || 'application/octet-stream',
    size: file.size,
  };
}

export function storeSessionAttachments(inputs: SessionAttachmentInput[]): StoredSessionAttachment[] {
  validateAttachmentFiles(inputs.map(input => ({ name: input.filename, size: input.size })));
  return inputs.map(input => ({
    ...structuredClone(input),
    filename: input.filename.trim() || '未命名附件',
    id: crypto.randomUUID(),
    mediaType: input.mediaType || 'application/octet-stream',
  }));
}

export function attachmentSummary(attachment: StoredSessionAttachment): SessionAttachmentSummary {
  const { data: _data, ...summary } = attachment;
  return summary;
}

export function userContentWithAttachments(
  text: string,
  attachments: StoredSessionAttachment[],
): UserContent {
  if (attachments.length === 0) return text;
  const content: UserContent = [];
  if (text) content.push({ text, type: 'text' });
  content.push(
    ...attachments.map<FilePart>(attachment => ({
      data: { data: attachment.data, type: 'data' },
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      type: 'file',
    })),
  );
  return content;
}

export function isImageAttachment(attachment: Pick<SessionAttachmentInput, 'mediaType'>): boolean {
  return attachment.mediaType.toLocaleLowerCase().startsWith('image/');
}
