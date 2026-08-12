import { describe, expect, it, vi } from 'vitest';
import { canonicalStringify, sha256 } from '../transaction/canonical';
import { CharacterMetadataStore, type CharacterMetadata } from './character-store';
import { MemoryTavernFileClient } from './file-client';
import { MemoryAgentSettingsStore } from './settings';

describe('CharacterMetadataStore', () => {
  it('固定索引文件比设置引用更新时采用有效文件并自动修复引用', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const store = new CharacterMetadataStore(client, settings, () => 100);
    await store.save({
      bindingId: 'role',
      characterName: '测试卡',
      revision: 0,
      schemaVersion: 1,
      sessions: {},
      updatedAt: 1,
    });
    const newer: CharacterMetadata = {
      bindingId: 'role',
      characterName: '测试卡',
      revision: 2,
      schemaVersion: 1,
      sessions: {},
      updatedAt: 200,
    };
    const bytes = new TextEncoder().encode(canonicalStringify(newer));
    await client.upload('DreamCreator--Meta--role.json', bytes);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(store.load('role')).resolves.toMatchObject({ revision: 2 });
    expect(settings.load().characterStores.role).toMatchObject({
      revision: 2,
      sha256: await sha256(bytes),
      size: bytes.byteLength,
    });
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
});
