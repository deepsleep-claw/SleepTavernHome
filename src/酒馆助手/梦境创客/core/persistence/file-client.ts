import type { BinaryBlobStore } from '../history/blob-store';
import type { AgentSettingsStore, StoredFileReference } from './settings';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export interface TavernFileClient {
  delete(url: string): Promise<void>;
  download(url: string): Promise<Uint8Array>;
  upload(name: string, bytes: Uint8Array): Promise<string>;
}

export class GlobalTavernFileClient implements TavernFileClient {
  async delete(url: string): Promise<void> {
    const response = await fetch('/api/files/delete', {
      body: JSON.stringify({ path: url }),
      headers: SillyTavern.getRequestHeaders(),
      method: 'POST',
    });
    if (!response.ok && response.status !== 404) throw new Error(`文件删除失败：${response.status}`);
  }

  async download(url: string): Promise<Uint8Array> {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`文件读取失败：${response.status} ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async upload(name: string, bytes: Uint8Array): Promise<string> {
    const response = await fetch('/api/files/upload', {
      body: JSON.stringify({ data: toBase64(bytes), name }),
      headers: SillyTavern.getRequestHeaders(),
      method: 'POST',
    });
    if (!response.ok) throw new Error(`文件上传失败：${response.status} ${await response.text()}`);
    const result = (await response.json()) as { path?: unknown };
    if (typeof result.path !== 'string') throw new Error('文件上传响应缺少path。');
    return result.path;
  }
}

export class MemoryTavernFileClient implements TavernFileClient {
  private readonly values = new Map<string, Uint8Array>();
  readonly uploadedNames: string[] = [];
  async delete(url: string): Promise<void> {
    this.values.delete(url);
  }
  async download(url: string): Promise<Uint8Array> {
    const value = this.values.get(url);
    if (!value) throw new Error(`missing: ${url}`);
    return Uint8Array.from(value);
  }
  async upload(name: string, bytes: Uint8Array): Promise<string> {
    this.uploadedNames.push(name);
    const url = `/user/files/${name}`;
    this.values.set(url, Uint8Array.from(bytes));
    return url;
  }
  corrupt(url: string): void {
    this.values.delete(url);
  }
  urls(): string[] {
    return [...this.values.keys()].sort();
  }
}

export class FileBackedBlobStore implements BinaryBlobStore {
  constructor(
    private readonly bindingId: string,
    private readonly client: TavernFileClient,
    private readonly settingsStore: AgentSettingsStore,
    private readonly quotaBytes = 500 * 1024 * 1024,
    private readonly now: () => number = Date.now,
  ) {}

  async delete(key: string): Promise<void> {
    const settings = this.settingsStore.load();
    const reference = settings.files[key];
    if (!reference) return;
    await this.client.delete(reference.url);
    delete settings.files[key];
    await this.settingsStore.save(settings);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const reference = this.settingsStore.load().files[key];
    return reference ? this.client.download(reference.url) : undefined;
  }

  async keys(): Promise<string[]> {
    return Object.entries(this.settingsStore.load().files)
      .filter(([key, item]) => item.bindingId === this.bindingId && !key.startsWith('session:') && !key.startsWith('lease:'))
      .map(([key]) => key)
      .sort();
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    const settings = this.settingsStore.load();
    if (settings.files[key]) return;
    const used = Object.values(settings.files)
      .filter(item => item.bindingId === this.bindingId)
      .reduce((total, item) => total + item.size, 0);
    if (used + value.byteLength > this.quotaBytes) throw new Error('该角色的梦境创客存储已超过500MB配额。');
    const safeBindingId = this.bindingId.replace(/[^a-zA-Z\d_-]/gu, '_').slice(0, 80);
    const name = `dream-card-agent--${safeBindingId}--blob--${key}.bin`;
    const url = await this.client.upload(name, value);
    const reference: StoredFileReference = {
      bindingId: this.bindingId,
      createdAt: this.now(),
      name,
      size: value.byteLength,
      url,
    };
    settings.files[key] = reference;
    await this.settingsStore.save(settings);
  }
}
