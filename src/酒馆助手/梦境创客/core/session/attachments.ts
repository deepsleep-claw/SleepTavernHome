import type { FilePart, ModelMessage, UserContent } from 'ai';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type SessionAttachmentInput = {
  data: string;
  filename: string;
  mediaType: string;
  size: number;
};

export type StoredSessionAttachment = {
  /** 旧会话可能仍携带内嵌正文；新附件只保存fileId。 */
  data?: string;
  fileId?: string;
  filename: string;
  id: string;
  logicalPath?: string;
  mediaType: string;
  size: number;
};

export type SessionAttachmentSummary = Omit<StoredSessionAttachment, 'data'> & { missing?: boolean };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function validateAttachmentFiles(files: Pick<File, 'name' | 'size'>[]): void {
  const oversized = files.find(file => file.size > MAX_ATTACHMENT_BYTES);
  if (oversized) throw new Error(`附件“${oversized.name}”超过 20MB 上限。`);
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
      data: attachment.data
        ? { data: attachment.data, type: 'data' }
        : dreamCreatorFileReference(attachment.fileId ?? attachment.id),
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      type: 'file',
    })),
  );
  return content;
}

export type ResolvedModelFile = { data: string; mediaType: string };

export type ModelFileResolveOptions = {
  /** 非视觉模型仍保存图片引用，但请求时用可读路径说明替代二进制内容。 */
  sendImages?: boolean;
  describeFile?: (fileId: string) => { mediaType?: string; path?: string } | undefined;
};

export function dreamCreatorFileReference(fileId: string): { text: string; type: 'text' } {
  // 这里故意使用AI SDK支持的tagged text形态保存内部引用，而不是URL对象。
  // URL无法被所有浏览器/Node的structuredClone稳定复制；真正发请求前会转换成data形态。
  return { text: `dreamcreator-file://${encodeURIComponent(fileId)}`, type: 'text' };
}

export function dreamCreatorFileId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const tagged = value as { text?: unknown; type?: unknown; url?: unknown };
  let raw: string | undefined;
  if (tagged.type === 'text' && typeof tagged.text === 'string') raw = tagged.text;
  if (tagged.type === 'url') {
    if (tagged.url instanceof URL) raw = tagged.url.href;
    else if (typeof tagged.url === 'string') raw = tagged.url;
  }
  if (!raw?.startsWith('dreamcreator-file://')) return undefined;
  return decodeURIComponent(raw.slice('dreamcreator-file://'.length).replace(/^\//u, ''));
}

async function resolveValue(
  value: unknown,
  resolver: (fileId: string) => Promise<ResolvedModelFile>,
  options: ModelFileResolveOptions,
): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => resolveValue(item, resolver, options)));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.type === 'file') {
    const fileId = dreamCreatorFileId(record.data);
    if (fileId) {
      const description = options.describeFile?.(fileId);
      const mediaType = description?.mediaType ?? (typeof record.mediaType === 'string' ? record.mediaType : '');
      if (options.sendImages === false && mediaType.toLocaleLowerCase().startsWith('image/')) {
        const path = description?.path ?? (typeof record.filename === 'string' ? record.filename : fileId);
        return {
          text: `<workspace_file path="${path}" media_type="${mediaType}" model_content="not_sent">图片已保存在工作区；当前模型不支持视觉，本次请求未发送图片内容。</workspace_file>`,
          type: 'text',
        };
      }
      const resolved = await resolver(fileId);
      return {
        ...record,
        data: { data: resolved.data, type: 'data' },
        mediaType: resolved.mediaType,
      };
    }
  }
  return Object.fromEntries(
    await Promise.all(Object.entries(record).map(async ([key, item]) => [key, await resolveValue(item, resolver, options)])),
  );
}

export async function resolveModelMessageFiles(
  messages: ModelMessage[],
  resolver: (fileId: string) => Promise<ResolvedModelFile>,
  options: ModelFileResolveOptions = {},
): Promise<ModelMessage[]> {
  return (await resolveValue(messages, resolver, options)) as ModelMessage[];
}

export function isImageAttachment(attachment: Pick<SessionAttachmentInput, 'mediaType'>): boolean {
  return attachment.mediaType.toLocaleLowerCase().startsWith('image/');
}
