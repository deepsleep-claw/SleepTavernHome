import UpdaterPanel from './UpdaterPanel.vue';
import releaseVersions from '../../../release/versions.json';
import { bootPluginWithUi, UPDATER_API_MAJOR, UPDATER_VERSION } from '../脚本更新器核心';
import type {
  PluginRuntime,
  PluginUpdaterConfig,
  PluginUpdaterModule,
  UpdaterBootstrapData,
} from './contracts';

const UPDATER_TAG_PREFIX = releaseVersions.updater.tagPrefix;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

type UpdaterRelease = {
  version: string;
  tag: string;
  entry: string;
  url: string;
};

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || '未知错误');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeVersion(value: unknown): value is string {
  return typeof value === 'string' && STABLE_VERSION_PATTERN.test(value);
}

function isSafeRepository(repository: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/u.test(repository);
}

function isSafeTag(tag: unknown): tag is string {
  return typeof tag === 'string' && /^[\w.-]+$/u.test(tag);
}

function isSafeEntry(entry: unknown): entry is string {
  return (
    typeof entry === 'string' &&
    Boolean(entry) &&
    !entry.startsWith('/') &&
    !entry.includes('\\') &&
    entry.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..')
  );
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

function buildUpdaterUrl(config: PluginUpdaterConfig, tag: string, entry: string): string {
  if (!isSafeRepository(config.repository) || !isSafeTag(tag) || !isSafeEntry(entry)) {
    throw new Error('更新器地址包含不安全的仓库、Tag 或入口路径');
  }
  const base = config.cdnBaseUrl.replace(/\/+$/u, '');
  const encodedEntry = entry.split('/').map(encodeURIComponent).join('/');
  return `${base}/${config.repository}@${encodeURIComponent(tag)}/${encodedEntry}`;
}

function selectUpdaterRelease(value: unknown, config: PluginUpdaterConfig): UpdaterRelease | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.repository !== config.repository) {
    return undefined;
  }
  const updater = value.updater;
  if (!isRecord(updater) || !isRecord(updater.apiMajors)) {
    return undefined;
  }
  const api = updater.apiMajors[String(UPDATER_API_MAJOR)];
  if (!isRecord(api) || !isRecord(api.stable)) {
    return undefined;
  }
  const { version, tag, entry } = api.stable;
  if (
    !isSafeVersion(version) ||
    !isSafeTag(tag) ||
    tag !== `${UPDATER_TAG_PREFIX}${version}` ||
    !isSafeEntry(entry)
  ) {
    return undefined;
  }
  return {
    version,
    tag,
    entry,
    url: buildUpdaterUrl(config, tag, entry),
  };
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

async function resolveBootstrap(
  config: PluginUpdaterConfig,
  bootstrap: UpdaterBootstrapData,
): Promise<UpdaterBootstrapData> {
  if (bootstrap.manifest !== undefined || bootstrap.manifestError !== undefined) {
    return { ...bootstrap };
  }
  try {
    return { ...bootstrap, manifest: await fetchManifest(config.manifestUrl) };
  } catch (error) {
    console.warn(`[${config.pluginName}] 获取 Manifest 失败，将使用锚定更新器和保底脚本。`, error);
    return { ...bootstrap, manifestError: describeError(error) };
  }
}

async function importUpdater(release: UpdaterRelease): Promise<PluginUpdaterModule> {
  const module = (await import(/* webpackIgnore: true */ release.url)) as PluginUpdaterModule;
  if (module.UPDATER_API_MAJOR !== UPDATER_API_MAJOR) {
    throw new Error(`更新器 API 不兼容：需要 v${UPDATER_API_MAJOR}，实际为 v${module.UPDATER_API_MAJOR ?? '未知'}`);
  }
  if (module.UPDATER_VERSION !== release.version) {
    throw new Error(`更新器版本不匹配：需要 ${release.version}，实际为 ${module.UPDATER_VERSION ?? '未知'}`);
  }
  if (typeof module.bootPlugin !== 'function') {
    throw new Error('更新器没有导出 bootPlugin()');
  }
  return module;
}

async function waitForDocumentReady(): Promise<void> {
  await new Promise<void>(resolve => $(resolve));
}

export { bootPluginHeadless, createPluginUpdater, UPDATER_API_MAJOR, UPDATER_VERSION } from '../脚本更新器核心';
export { default as UpdaterPanel } from './UpdaterPanel.vue';
export type * from './contracts';

export async function bootPlugin(
  config: PluginUpdaterConfig,
  bootstrap: UpdaterBootstrapData = {},
): Promise<PluginRuntime | void> {
  const resolvedBootstrap = await resolveBootstrap(config, bootstrap);
  const latestUpdater = selectUpdaterRelease(resolvedBootstrap.manifest, config);

  if (latestUpdater && compareStableVersions(latestUpdater.version, UPDATER_VERSION) > 0) {
    let updater: PluginUpdaterModule | undefined;
    try {
      updater = await importUpdater(latestUpdater);
    } catch (error) {
      console.warn(
        `[${config.pluginName}] 最新更新器 v${latestUpdater.version} 加载失败，将使用锚定版本 v${UPDATER_VERSION}。`,
        error,
      );
    }
    if (updater?.bootPlugin) {
      await waitForDocumentReady();
      return await updater.bootPlugin(config, resolvedBootstrap);
    }
  }

  await waitForDocumentReady();
  return await bootPluginWithUi(config, UpdaterPanel, resolvedBootstrap);
}
