import { describe, expect, it, vi } from 'vitest';
import type { RunnerEvent } from '../runner/agent-runner';
import { PageDebugLog } from './debug-log';
import { MemoryTavernFileClient } from './file-client';
import { FileRegistryGarbageCollector } from './garbage-collector';
import { PersistentRunnerJournal } from './journal';
import { MemoryAgentSettingsStore } from './settings';

describe('persistence maintenance', () => {
  it('Runner事件逐条刷新并可从持久化事件恢复', async () => {
    const flush = vi.fn(async (_events: RunnerEvent[]) => undefined);
    const initial: RunnerEvent[] = [{ at: 1, status: 'running', type: 'status' }];
    const journal = new PersistentRunnerJournal(initial, flush);
    await journal.append({ at: 2, status: 'completed', type: 'status' });
    expect(journal.list()).toHaveLength(2);
    expect(flush).toHaveBeenCalledWith(journal.list());
    const copy = journal.list();
    copy.length = 0;
    expect(journal.list()).toHaveLength(2);
  });

  it('仅清理超过七天且未被全局资源引用的登记文件', async () => {
    const client = new MemoryTavernFileClient();
    const settings = new MemoryAgentSettingsStore();
    const skillUrl = await client.upload('skill.md', new TextEncoder().encode('skill'));
    const orphanUrl = await client.upload('orphan.bin', Uint8Array.of(1));
    const current = settings.load();
    current.globalSkills.skill = {
      description: 'skill', id: 'skill', loading: 'full', name: 'skill', revision: 1, updatedAt: 1, url: skillUrl,
    };
    current.files.skill = { bindingId: 'global', createdAt: 1, name: 'skill.md', size: 5, url: skillUrl };
    current.files.orphan = { bindingId: 'role', createdAt: 1, name: 'orphan.bin', size: 1, url: orphanUrl };
    await settings.save(current);
    const collector = new FileRegistryGarbageCollector(client, settings, () => 8 * 24 * 60 * 60 * 1000);
    const download = vi.spyOn(client, 'download');
    expect(await collector.collect()).toEqual([orphanUrl]);
    expect(download).not.toHaveBeenCalled();
    expect(client.urls()).toEqual([skillUrl]);
  });

  it('开发日志限长、可清空，并在诊断包中递归脱敏', () => {
    let now = 0;
    const log = new PageDebugLog(() => ++now, 2);
    log.add('info', 'one', { ok: true });
    log.add('warn', 'two', { headers: { authorization: 'Bearer secret' }, nested: { content: '正文', safe: 1 } });
    log.add('error', 'three', { apiKey: 'secret', stack: 'trace' });
    expect(log.list().map(item => item.message)).toEqual(['two', 'three']);
    expect(log.diagnosticBundle()[0].data).toEqual({ headers: '<redacted>', nested: { content: '<redacted>', safe: 1 } });
    expect(log.diagnosticBundle()[1].data).toEqual({ apiKey: '<redacted>', stack: 'trace' });
    log.clear();
    expect(log.list()).toEqual([]);
  });
});
