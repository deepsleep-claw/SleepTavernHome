import type { ModelMessage } from 'ai';
import {
  base64ForBytes,
  DreamCreatorWorkspaceFileStore,
} from '../persistence/workspace-file-store';
import type { AgentSettingsStore } from '../persistence/settings';
import {
  resolveModelMessageFiles,
  type ResolvedModelFile,
  type SessionAttachmentInput,
  type StoredSessionAttachment,
} from './attachments';
import { compressImageForModel, type RasterImageEncoder } from './image-compression';

export interface SessionAttachmentStore {
  loadInput(attachment: StoredSessionAttachment): Promise<SessionAttachmentInput>;
  prepareMessages(sessionId: string, messages: ModelMessage[], options?: { sendImages?: boolean }): Promise<ModelMessage[]>;
  save(sessionId: string, inputs: SessionAttachmentInput[]): Promise<StoredSessionAttachment[]>;
}

export class ExternalSessionAttachmentStore implements SessionAttachmentStore {
  constructor(
    private readonly bindingId: string,
    private readonly files: DreamCreatorWorkspaceFileStore,
    private readonly settingsStore: AgentSettingsStore,
    private readonly encoder?: RasterImageEncoder,
    private readonly scope: 'character' | 'global' = 'character',
  ) {}

  async save(sessionId: string, inputs: SessionAttachmentInput[]): Promise<StoredSessionAttachment[]> {
    const result: StoredSessionAttachment[] = [];
    for (const input of inputs) {
      const file = await this.files.putPersistent({
        bindingId: this.bindingId,
        data: input.data,
        logicalPath: input.filename,
        mediaType: input.mediaType,
        referencedSessionId: sessionId,
        global: this.scope === 'global',
      });
      result.push({
        fileId: file.fileId,
        filename: input.filename,
        id: crypto.randomUUID(),
        logicalPath: `${this.scope === 'global' ? '/files' : '/character/files'}/${file.logicalPath}`,
        mediaType: input.mediaType,
        size: input.size,
      });
    }
    return result;
  }

  async loadInput(attachment: StoredSessionAttachment): Promise<SessionAttachmentInput> {
    if (attachment.data) {
      return {
        data: attachment.data,
        filename: attachment.filename,
        mediaType: attachment.mediaType,
        size: attachment.size,
      };
    }
    if (!attachment.fileId) throw new Error(`附件内容已经丢失：${attachment.filename}`);
    const bytes = await this.files.read(attachment.fileId).catch(error => {
      throw new Error(`附件“${attachment.filename}”已被清理，当前会话无法继续生成。`, { cause: error });
    });
    return {
      data: base64ForBytes(bytes),
      filename: attachment.filename,
      mediaType: attachment.mediaType,
      size: bytes.byteLength,
    };
  }

  async prepareMessages(
    sessionId: string,
    messages: ModelMessage[],
    options: { sendImages?: boolean } = {},
  ): Promise<ModelMessage[]> {
    return resolveModelMessageFiles(messages, fileId => this.resolveForModel(sessionId, fileId), {
      describeFile: fileId => {
        const source = this.files.getReference(fileId);
        if (!source) return undefined;
        const root = source.scope.startsWith('global-') ? '/files' : '/character/files';
        return { mediaType: source.mediaType, path: `${root}/${source.logicalPath}` };
      },
      sendImages: options.sendImages,
    });
  }

  private async resolveForModel(sessionId: string, fileId: string): Promise<ResolvedModelFile> {
    const source = this.files.getReference(fileId);
    if (!source) throw new Error(`附件或工作区文件已被清理：${fileId}`);
    const settings = this.settingsStore.load();
    if (
      settings.compressImages &&
      ['image/jpeg', 'image/png', 'image/webp'].includes(source.mediaType.toLowerCase()) &&
      source.size > 1024 * 1024
    ) {
      const cached = this.files
        .listReferences(this.bindingId)
        .find(
          file =>
            !file.orphanedAt &&
            file.scope === (this.scope === 'global' ? 'global-temp' : 'character-temp') &&
            file.sessionId === sessionId &&
            file.sourceFileId === fileId,
        );
      if (cached) {
        return { data: base64ForBytes(await this.files.read(cached.fileId)), mediaType: cached.mediaType };
      }
      const original = await this.files.read(fileId);
      const compressed = await compressImageForModel(original, source.mediaType, true, this.encoder);
      if (compressed.compressed) {
        const stored = await this.files.putTemp({
          bindingId: this.bindingId,
          bytes: compressed.bytes,
          logicalPath: `_attachments/${fileId}.webp`,
          mediaType: compressed.mediaType,
          sessionId,
          sourceFileId: fileId,
          global: this.scope === 'global',
        });
        return { data: base64ForBytes(compressed.bytes), mediaType: stored.mediaType };
      }
      return { data: base64ForBytes(original), mediaType: source.mediaType };
    }
    return { data: base64ForBytes(await this.files.read(fileId)), mediaType: source.mediaType };
  }
}
