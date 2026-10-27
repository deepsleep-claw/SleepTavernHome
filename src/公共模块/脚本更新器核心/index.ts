import type { Component } from 'vue';
import releaseVersions from '../../../release/versions.json';
import { compareStableVersions, fetchManifest, normalizeRelease, parseManifest } from '../脚本更新器/manifest';
import { createCdnRuntime, normalizeSource } from '../脚本更新器/sources';
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
  type UpdateSource,
} from '../脚本更新器/contracts';

export const UPDATER_API_MAJOR = releaseVersions.updater.apiMajor;
export const UPDATER_VERSION = releaseVersions.updater.version;

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

function normalizeFallback(config: PluginUpdaterConfig): ReleaseDescriptor {
  if (!normalizeRelease(config.fallback, config)) {
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
    source: normalizeSource(record.source),
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
    (globalThis as typeof globalThis & { __thCdnSource?: UpdateSource }).__thCdnSource = normalizeSource(
      this.state.source,
    );
    writeUpdaterState(this.state);
    this.snapshot = {
      status: 'idle',
      currentVersion: this.state.active.version,
      runningVersion: this.state.pending?.version ?? this.state.active.version,
      latestVersion: this.state.lastCheck?.latestVersion,
      updateAvailable: false,
      checkedAt: this.state.lastCheck?.checkedAt,
      error: bootstrap.manifestError,
      source: normalizeSource(this.state.source),
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
      this.applyManifest(await fetchManifest(this.config, normalizeSource(this.state.source)));
      return this.getSnapshot();
    } catch (error) {
      this.recordCheckError(error);
      throw error;
    }
  }

  setSource(source: UpdateSource): void {
    this.state = { ...this.state, source: normalizeSource(source) };
    writeUpdaterState(this.state);
    (globalThis as typeof globalThis & { __thCdnSource?: UpdateSource }).__thCdnSource = this.state.source;
    this.updateSnapshot({ source: this.state.source });
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

      // 已安装版本无法启动时，允许稳定版修复入口恢复界面；成功激活前保留原版本状态。
      if (this.latest && compareStableVersions(this.latest.version, release.version) > 0) {
        const recovery = copyRelease(this.latest);
        try {
          const runtime = await this.activateRelease(recovery, updaterUi);
          this.state = { ...this.state, active: recovery, pending: undefined };
          writeUpdaterState(this.state);
          this.refreshVersionStatus(recovery.version);
          return runtime;
        } catch (recoveryError) {
          if (hasSameReleaseIdentity(recovery, this.fallback)) throw recoveryError;
          console.error(`[${this.pluginName}] 稳定版恢复失败。`, recoveryError);
        }
      }

      if (!hasSameReleaseIdentity(release, this.fallback)) {
        console.error(`[${this.pluginName}] 当前版本启动失败，尝试保底版本。`, error);
        this.updateSnapshot({
          status: 'error',
          runningVersion: this.fallback.version,
          error: `v${release.version} 启动失败，当前使用保底版本。`,
        });
        const runtime = await this.activateRelease(this.fallback, updaterUi);
        this.state = { ...this.state, active: copyRelease(this.fallback), pending: undefined };
        writeUpdaterState(this.state);
        this.refreshVersionStatus(this.fallback.version);
        return runtime;
      }
      throw error;
    }
  }

  private async activateRelease(release: ReleaseDescriptor, updaterUi?: Component): Promise<PluginRuntime | void> {
    const scope = globalThis as typeof globalThis & { __thManagedPluginLoad?: string };
    scope.__thManagedPluginLoad = this.pluginId;
    try {
      const loaded = await createCdnRuntime(normalizeSource(this.state.source)).importModule(release.url, value => {
        const module = value as LoadablePluginModule;
        if (module.PLUGIN_ID !== this.pluginId) {
          throw new Error(`主脚本标识不匹配：期望 ${this.pluginId}，实际为 ${module.PLUGIN_ID ?? '未声明'}`);
        }
        if (module.PLUGIN_VERSION !== release.version) {
          throw new Error(`主脚本版本不匹配：期望 ${release.version}，实际为 ${module.PLUGIN_VERSION ?? '未声明'}`);
        }
        if (typeof module.activate !== 'function') throw new Error('主脚本没有导出 activate()');
      });
      const module = loaded.module as LoadablePluginModule;
      this.updateSnapshot({ loadedFrom: new URL(loaded.url).hostname });
      return await module.activate!({
        release: { ...release, url: loaded.url },
        updater: this,
        updaterUi,
      });
    } finally {
      delete scope.__thManagedPluginLoad;
    }
  }

  private applyManifest(value: unknown): void {
    const manifest = parseManifest(value, this.config);
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
