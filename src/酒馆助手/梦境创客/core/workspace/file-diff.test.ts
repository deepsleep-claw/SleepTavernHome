import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from './types';
import { diffRequestedWorkspaceFiles } from './file-diff';

function file(path: string, content: string, resourceId: string): WorkspaceFile {
  return { content, mediaType: 'text/markdown', path, readonly: false, resourceId };
}

describe('diffRequestedWorkspaceFiles', () => {
  it('忽略宿主保存时对未触及兄弟文件产生的格式归一化', () => {
    const target = file('/worldbooks/book/entries/target.md', '旧内容', 'entry:target');
    const sibling = file('/worldbooks/book/entries/sibling.md', '旧格式', 'entry:sibling');
    const requested = [
      {
        after: { ...target, content: '新内容' },
        before: target,
        kind: 'modify' as const,
        path: target.path,
      },
    ];
    const changes = diffRequestedWorkspaceFiles(requested, [target, sibling], [
      { ...target, content: '宿主序列化后的新内容' },
      { ...sibling, content: '宿主顺带归一化的格式' },
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'modify', path: target.path });
    expect(changes[0]).toHaveProperty('after.content', '宿主序列化后的新内容');
  });
});
