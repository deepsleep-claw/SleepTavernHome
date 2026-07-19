import type { Component } from 'vue';
import releaseVersions from '../../../release/versions.json';
import {
  UPDATER_STATE_KEY,
  UPDATER_STATE_SCHEMA_VERSION,
  type LoadablePluginModule,
  type PluginRuntime,
  type PluginUpdaterConfig,
  type PluginUpdaterController,
  type ReleaseDescriptor,
  type StoredUpdaterState,
  type UpdaterBootstrapData,
  type UpdaterListener,
  type UpdaterSnapshot,
  type UpdaterStatus,
} from '../脚本更新器/contracts';

export const UPDATER_API_MAJOR = releaseVersions.updater.apiMajor;
export const UPDATER_VERSION = releaseVersions.updater.version;

const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

const ManifestReleaseSchema = z.object({
  version: z.string().regex(STABLE_VERSION_PATTERN, '稳定版版本号必须使用 x.y.z 格式'),
  tag: z.string().min(1),
  entry: z.string().min(1),
  updaterApiMajor: z.number().int().positive().optional(),
});

const RepositoryManifestSchema = z.object({
  schemaVersion: z.literal(1),
  repository: z.string().min(3),
  updater: z.object({
    apiMajors: z.record(
      z.string(),
      z.object({
        stable: ManifestReleaseSchema,
      }),
    ),
  }),
  plugins: z.record(
    z.string(),
    z.object({
      name: z.string().min(1),
      channels: z.object({
        stable: ManifestReleaseSchema,
      }),
    }),
  ),
});

type RepositoryManifest = z.infer<typeof RepositoryManifestSchema>;

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || '未知错误');
}

function copyRelease(release: ReleaseDescriptor): ReleaseDescriptor {
  return { ...release };
}

function hasSameReleaseIdentity(lhs: ReleaseDescriptor, rhs: ReleaseDescriptor): boolean {
  return lhs.version === rhs.version && lhs.tag === rhs.tag && lhs.entry === rhs.entry;
}

function compareStableVersions(lhs: string, rhs: string): number {
  const left = lhs.split('.');
  const right = rhs.split('.');
  for (let index = 0; index < 3; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart.length !== rightPart.length) {
      return leftPart.length > rightPart.length ? 1 : -1;
    }
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

function isSafeRepository(repository: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/u.test(repository);
}

function isSafeTag(tag: string): boolean {
  return /^[\w.-]+$/u.test(tag);
}

function isSafeEntry(entry: string): boolean {
  if (!entry || entry.startsWith('/') || entry.includes('\\')) {
    return false;
  }
  return entry.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..');
}

function buildReleaseUrl(config: PluginUpdaterConfig, tag: string, entry: string): string {
  if (!isSafeRepository(config.repository) || !isSafeTag(tag) || !isSafeEntry(entry)) {
    throw new Error('更新地址包含不安全的仓库、Tag 或入口路径');
  }

  const base = config.cdnBaseUrl.replace(/\/+$/u, '');
  const encodedEntry = entry.split('/').map(encodeURIComponent).join('/');
  return `${base}/${config.repository}@${encodeURIComponent(tag)}/${encodedEntry}`;
}

function normalizeRelease(value: unknown, config: PluginUpdaterConfig): ReleaseDescriptor | undefined {
  const result = ManifestReleaseSchema.safeParse(value);
  if (!result.success) {
    return undefined;
  }

  const release = result.data;
  if (
    release.tag !== `${config.tagPrefix}${release.version}` ||
    !isSafeTag(release.tag) ||
    !isSafeEntry(release.entry) ||
    release.updaterApiMajor !== config.updaterApiMajor
  ) {
    return undefined;
  }

  return {
    version: release.version,
    tag: release.tag,
    entry: release.entry,
    url: buildReleaseUrl(config, release.tag, release.entry),
    updaterApiMajor: release.updaterApiMajor,
  };
}

function normalizeFallback(config: PluginUpdaterConfig): ReleaseDescriptor {
  const result = ManifestReleaseSchema.safeParse(config.fallback);
  if (
    !result.success ||
    result.data.tag !== `${config.tagPrefix}${result.data.version}` ||
    result.data.updaterApiMajor !== config.updaterApiMajor ||
    !isSafeTag(result.data.tag) ||
    !isSafeEntry(result.data.entry)
  ) {
    throw new Error(`${config.pluginName}的 fallback 配置无效`);
  }
  try {
    new URL(config.fallback.url);
  } catch {
    throw new Error(`${config.pluginName}的 fallback 地址无效`);
  }
  return copyRelease(config.fallback);
}

function readUpdaterState(config: PluginUpdaterConfig, fallback: ReleaseDescriptor): StoredUpdaterState {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const raw = variables[UPDATER_STATE_KEY];
  if (!raw || typeof raw !== 'object') {
    return {
      schemaVersion: UPDATER_STATE_SCHEMA_VERSION,
      pluginId: config.pluginId,
      channel: config.channel,
      active: copyRelease(fallback),
    };
  }

  const record = raw as Record<string, unknown>;
  const normalizedActive = normalizeRelease(record.active, config);
  const active =
    normalizedActive && hasSameReleaseIdentity(normalizedActive, fallback)
      ? copyRelease(fallback)
      : (normalizedActive ?? copyRelease(fallback));
  const pending = normalizeRelease(record.pending, config);
  const rawLastCheck = record.lastCheck;
  const lastCheck =
    rawLastCheck && typeof rawLastCheck === 'object'
      ? {
          checkedAt:
            typeof (rawLastCheck as Record<string, unknown>).checkedAt === 'string'
              ? String((rawLastCheck as Record<string, unknown>).checkedAt)
              : new Date(0).toISOString(),
          latestVersion:
            typeof (rawLastCheck as Record<string, unknown>).latestVersion === 'string'
              ? String((rawLastCheck as Record<string, unknown>).latestVersion)
              : undefined,
          error:
            typeof (rawLastCheck as Record<string, unknown>).error === 'string'
              ? String((rawLastCheck as Record<string, unknown>).error)
              : undefined,
        }
      : undefined;

  return {
    schemaVersion: UPDATER_STATE_SCHEMA_VERSION,
    pluginId: config.pluginId,
    channel: config.channel,
    active,
    ...(pending && compareStableVersions(pending.version, active.version) > 0 ? { pending } : {}),
    ...(lastCheck ? { lastCheck } : {}),
  };
}

function writeUpdaterState(state: StoredUpdaterState): void {
  const value: StoredUpdaterState = {
    ...state,
    active: copyRelease(state.active),
    ...(state.pending ? { pending: copyRelease(state.pending) } : {}),
    ...(state.lastCheck ? { lastCheck: { ...state.lastCheck } } : {}),
  };
  updateVariablesWith(
    variables => ({
      ...variables,
      [UPDATER_STATE_KEY]: value,
    }),
    { type: 'script', script_id: getScriptId() },
  );
}

async function fetchManifest(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const requestUrl = new URL(url, window.location.href);
    requestUrl.searchParams.set('_th_cache_bust', Date.now().toString(36));
    const response = await fetch(requestUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Manifest 请求失败（HTTP ${response.status}）`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

class PluginUpdater implements PluginUpdaterController {
  readonly pluginId: string;
  readonly pluginName: string;

  private readonly config: PluginUpdaterConfig;
  private readonly fallback: ReleaseDescriptor;
  private readonly listeners = new Set<UpdaterListener>();
  private state: StoredUpdaterState;
  private latest?: ReleaseDescriptor;
  private snapshot: UpdaterSnapshot;

  constructor(config: PluginUpdaterConfig, bootstrap: UpdaterBootstrapData = {}) {
    if (config.updaterApiMajor !== UPDATER_API_MAJOR) {
      throw new Error(`更新器 API 不兼容：需要 v${config.updaterApiMajor}，当前为 v${UPDATER_API_MAJOR}`);
    }

    this.config = config;
    this.pluginId = config.pluginId;
    this.pluginName = config.pluginName;
    this.fallback = normalizeFallback(config);
    this.state = readUpdaterState(config, this.fallback);
    writeUpdaterState(this.state);
    this.snapshot = {
      status: 'idle',
      currentVersion: this.state.active.version,
      runningVersion: this.state.pending?.version ?? this.state.active.version,
      latestVersion: this.state.lastCheck?.latestVersion,
      updateAvailable: false,
      checkedAt: this.state.lastCheck?.checkedAt,
      error: bootstrap.manifestError,
    };

    if (bootstrap.manifest !== undefined) {
      try {
        this.applyManifest(bootstrap.manifest);
      } catch (error) {
        this.recordCheckError(error);
      }
    } else if (bootstrap.manifestError) {
      this.updateSnapshot({ status: 'error', error: bootstrap.manifestError });
    }
  }

  getSnapshot(): UpdaterSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: UpdaterListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  async check(): Promise<UpdaterSnapshot> {
    this.updateSnapshot({ status: 'checking', error: undefined });
    try {
      this.applyManifest(await fetchManifest(this.config.manifestUrl));
      return this.getSnapshot();
    } catch (error) {
      this.recordCheckError(error);
      throw error;
    }
  }

  async install(): Promise<void> {
    if (!this.latest) {
      await this.check();
    }
    if (!this.latest || compareStableVersions(this.latest.version, this.state.active.version) <= 0) {
      return;
    }

    this.state = { ...this.state, pending: copyRelease(this.latest) };
    writeUpdaterState(this.state);
    this.updateSnapshot({ status: 'installing', error: undefined });
    await Promise.resolve();
    window.location.reload();
  }

  async boot(updaterUi?: Component): Promise<PluginRuntime | void> {
    const pending = this.state.pending;
    const release = pending ?? this.state.active;
    this.updateSnapshot({ runningVersion: release.version });

    try {
      const runtime = await this.activateRelease(release, updaterUi);
      if (pending) {
        this.state = {
          ...this.state,
          active: copyRelease(pending),
          pending: undefined,
        };
        writeUpdaterState(this.state);
        this.refreshVersionStatus(pending.version);
      }
      return runtime;
    } catch (error) {
      if (pending) {
        console.error(`[${this.pluginName}] 新版本启动失败，已保留当前版本。`, error);
        this.state = { ...this.state, pending: undefined };
        writeUpdaterState(this.state);
        toastr.error(`新版本启动失败，已保留 v${this.state.active.version}。`, this.pluginName);
        window.location.reload();
        return;
      }

      if (release.url !== this.fallback.url) {
        console.error(`[${this.pluginName}] 当前版本启动失败，尝试保底版本。`, error);
        this.updateSnapshot({
          status: 'error',
          runningVersion: this.fallback.version,
          error: `v${release.version} 启动失败，当前使用保底版本。`,
        });
        return await this.activateRelease(this.fallback, updaterUi);
      }
      throw error;
    }
  }

  private async activateRelease(release: ReleaseDescriptor, updaterUi?: Component): Promise<PluginRuntime | void> {
    const module = (await import(/* webpackIgnore: true */ release.url)) as LoadablePluginModule;
    if (module.PLUGIN_ID !== this.pluginId) {
      throw new Error(`主脚本标识不匹配：期望 ${this.pluginId}，实际为 ${module.PLUGIN_ID ?? '未声明'}`);
    }
    if (module.PLUGIN_VERSION !== release.version) {
      throw new Error(`主脚本版本不匹配：期望 ${release.version}，实际为 ${module.PLUGIN_VERSION ?? '未声明'}`);
    }
    if (typeof module.activate !== 'function') {
      throw new Error('主脚本没有导出 activate()');
    }
    return await module.activate({
      release: copyRelease(release),
      updater: this,
      updaterUi,
    });
  }

  private parseManifest(value: unknown): RepositoryManifest {
    const result = RepositoryManifestSchema.safeParse(value);
    if (!result.success) {
      throw new Error(`Manifest 格式无效：${z.prettifyError(result.error)}`);
    }
    if (result.data.repository !== this.config.repository) {
      throw new Error('Manifest 仓库与引导器配置不一致');
    }
    return result.data;
  }

  private applyManifest(value: unknown): void {
    const manifest = this.parseManifest(value);
    const plugin = manifest.plugins[this.pluginId];
    if (!plugin) {
      throw new Error(`Manifest 中没有插件 ${this.pluginId}`);
    }

    const release = normalizeRelease(plugin.channels[this.config.channel], this.config);
    if (!release) {
      throw new Error(`${this.pluginName}的稳定版信息无效`);
    }

    const checkedAt = new Date().toISOString();
    this.latest = release;
    this.state = {
      ...this.state,
      lastCheck: {
        checkedAt,
        latestVersion: release.version,
      },
    };
    writeUpdaterState(this.state);
    this.refreshVersionStatus(this.snapshot.runningVersion, checkedAt);
  }

  private recordCheckError(error: unknown): void {
    const message = describeError(error);
    const checkedAt = new Date().toISOString();
    this.state = {
      ...this.state,
      lastCheck: {
        checkedAt,
        latestVersion: this.latest?.version,
        error: message,
      },
    };
    writeUpdaterState(this.state);
    this.updateSnapshot({ status: 'error', checkedAt, error: message });
  }

  private refreshVersionStatus(runningVersion: string, checkedAt = this.state.lastCheck?.checkedAt): void {
    const updateAvailable = Boolean(
      this.latest && compareStableVersions(this.latest.version, this.state.active.version) > 0,
    );
    const status: UpdaterStatus = this.latest ? (updateAvailable ? 'update-available' : 'up-to-date') : 'idle';
    this.updateSnapshot({
      status,
      currentVersion: this.state.active.version,
      runningVersion,
      latestVersion: this.latest?.version,
      updateAvailable,
      checkedAt,
      error: undefined,
    });
  }

  private updateSnapshot(patch: Partial<UpdaterSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const value = this.getSnapshot();
    this.listeners.forEach(listener => listener(value));
  }
}

export function createPluginUpdater(
  config: PluginUpdaterConfig,
  bootstrap: UpdaterBootstrapData = {},
): PluginUpdaterController {
  return new PluginUpdater(config, bootstrap);
}

export async function bootPluginHeadless(
  config: PluginUpdaterConfig,
  bootstrap: UpdaterBootstrapData = {},
): Promise<PluginRuntime | void> {
  return await new PluginUpdater(config, bootstrap).boot();
}

export async function bootPluginWithUi(
  config: PluginUpdaterConfig,
  updaterUi: Component,
  bootstrap: UpdaterBootstrapData = {},
): Promise<PluginRuntime | void> {
  return await new PluginUpdater(config, bootstrap).boot(updaterUi);
}
