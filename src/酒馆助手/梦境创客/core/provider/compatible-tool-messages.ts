import type { FilePart, ModelMessage, TextPart, ToolResultPart, UserContent } from 'ai';

type OutputPart = Extract<ToolResultPart['output'], { type: 'content' }>['value'][number];

function attachment(part: OutputPart): FilePart | TextPart | undefined {
  const providerOptions = part.providerOptions;
  switch (part.type) {
    case 'file':
      return part.data.type === 'text' ? { type: 'text', text: part.data.text, providerOptions } : part;
    case 'file-data':
    case 'image-data':
      return {
        type: 'file',
        mediaType: part.mediaType,
        data: { type: 'data', data: part.data },
        filename: part.type === 'file-data' ? part.filename : undefined,
        providerOptions,
      };
    case 'file-url':
    case 'image-url':
      return {
        type: 'file',
        mediaType: part.type === 'image-url' ? 'image' : (part.mediaType ?? 'application/octet-stream'),
        data: { type: 'url', url: part.url },
        providerOptions,
      };
    case 'file-id':
    case 'image-file-id':
      return {
        type: 'file',
        mediaType: part.type === 'image-file-id' ? 'image' : 'application/octet-stream',
        data: { type: 'reference', reference: typeof part.fileId === 'string' ? { openai: part.fileId } : part.fileId },
        providerOptions,
      };
    case 'file-reference':
    case 'image-file-reference':
      return {
        type: 'file',
        mediaType: part.type === 'image-file-reference' ? 'image' : 'application/octet-stream',
        data: { type: 'reference', reference: part.providerReference },
        providerOptions,
      };
    default:
      return undefined;
  }
}

/** Chat 兼容协议的 tool 消息只承载文本，媒体在完整工具批次之后作为附件发送。 */
export function compatibleToolMessages(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  let attachments: Exclude<UserContent, string> = [];
  const flush = () => {
    if (attachments.length) result.push({ role: 'user', content: attachments });
    attachments = [];
  };
  for (const message of messages) {
    if (message.role !== 'tool') {
      flush();
      result.push(message);
      continue;
    }
    const content = message.content.map(part => {
      if (part.type !== 'tool-result' || part.output.type !== 'content') return part;
      const media: Array<FilePart | TextPart> = [];
      const remaining: OutputPart[] = [];
      for (const value of part.output.value) {
        const converted = attachment(value);
        if (converted) media.push(converted);
        else remaining.push(value);
      }
      if (!media.length) return part;
      attachments.push({ type: 'text', text: `工具 ${part.toolName}（${part.toolCallId}）返回的附件：` }, ...media);
      return {
        ...part,
        output: remaining.every(value => value.type === 'text')
          ? { type: 'text' as const, value: remaining.map(value => value.text).join('\n') || '附件见后续媒体消息。' }
          : { ...part.output, value: remaining },
      };
    });
    result.push({ ...message, content });
  }
  flush();
  return result;
}
