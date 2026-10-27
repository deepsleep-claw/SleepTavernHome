import type { ModelMessage, ToolModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { compatibleToolMessages } from './compatible-tool-messages';

describe('兼容接口工具附件', () => {
  it.each([false, true])('并行工具结果先完整配对，再发送附件（拆分消息：%s）', split => {
    const content: ToolModelMessage['content'] = [
      {
        type: 'tool-result',
        toolCallId: 'image',
        toolName: 'read_file',
        providerOptions: { openai: { marker: 'kept' } },
        output: {
          type: 'content',
          value: [
            { type: 'text', text: '图片内容' },
            { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'aW1hZ2U=' } },
          ],
        },
      },
      {
        type: 'tool-result',
        toolCallId: 'text',
        toolName: 'read_file',
        output: { type: 'json', value: { content: '普通结果' } },
      },
    ];
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: ['image', 'text'].map(toolCallId => ({
          type: 'tool-call',
          toolName: 'read_file',
          toolCallId,
          input: {},
        })),
      },
      ...(split
        ? content.map(part => ({ role: 'tool' as const, content: [part] }))
        : [{ role: 'tool' as const, content }]),
      { role: 'assistant', content: '已完成' },
    ];
    const original = structuredClone(messages);
    const converted = compatibleToolMessages(messages);
    expect(converted.map(message => message.role)).toEqual(
      split ? ['assistant', 'tool', 'tool', 'user', 'assistant'] : ['assistant', 'tool', 'user', 'assistant'],
    );
    const results = converted.filter(message => message.role === 'tool').flatMap(message => message.content);
    expect(results).toEqual([{ ...content[0], output: { type: 'text', value: '图片内容' } }, content[1]]);
    const media = converted.find(message => message.role === 'user')!.content;
    expect(media).toContainEqual({ type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'aW1hZ2U=' } });
    expect(messages).toEqual(original);
  });

  it('JSON 正文不会被识别为附件，纯文本文件完整转为正文', () => {
    const json: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolName: 'read_file',
          toolCallId: 'json',
          output: { type: 'json', value: { type: 'file', mediaType: 'image/png', data: '原始业务数据' } },
        },
      ],
    };
    expect(compatibleToolMessages([json])).toEqual([json]);
    const converted = compatibleToolMessages([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolName: 'read_file',
            toolCallId: 'text',
            output: {
              type: 'content',
              value: [{ type: 'file', mediaType: 'text/plain', data: { type: 'text', text: '完整正文' } }],
            },
          },
        ],
      },
    ]);
    expect(converted.at(-1)?.content).toContainEqual({ type: 'text', text: '完整正文', providerOptions: undefined });
  });
});
