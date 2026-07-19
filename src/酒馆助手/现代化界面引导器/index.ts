import type {
  PluginUpdaterConfig,
  PluginUpdaterModule,
  ReleaseDescriptor,
  UpdaterBootstrapData,
} from '../../公共模块/脚本更新器/contracts';
import releaseVersions from '../../../release/versions.json';

const PLUGIN_ID = 'modern-ui';
const releaseConfig = releaseVersions.plugins[PLUGIN_ID];
const PLUGIN_NAME = releaseConfig.name;
const REPOSITORY = 'deepsleep-claw/SleepTavernHome';
const MANIFEST_URL = `https://raw.githubusercontent.com/${REPOSITORY}/main/manifest.json`;
const CDN_BASE_URL = 'https://cdn.jsdelivr.net/gh';
const PLUGIN_TAG_PREFIX = releaseConfig.tagPrefix;
const UPDATER_TAG_PREFIX = releaseVersions.updater.tagPrefix;
const UPDATER_API_MAJOR = releaseVersions.updater.apiMajor;

type UpdaterRelease = {
  version: string;
  tag: string;
  entry: string;
  url: string;
};

type BootstrapOverride = {
  manifestUrl?: string;
  updaterUrl?: string;
  fallbackUrl?: string;
};

const DEFAULT_FALLBACK = createPluginRelease({
  version: releaseConfig.version,
  tag: `${PLUGIN_TAG_PREFIX}${releaseConfig.version}`,
  entry: releaseConfig.entry,
});

const UPDATER_ANCHOR = createUpdaterRelease({
  version: releaseVersions.updater.version,
  tag: `${UPDATER_TAG_PREFIX}${releaseVersions.updater.version}`,
  entry: releaseVersions.updater.entry,
});

function encodeEntry(entry: string): string {
  return entry.split('/').map(encodeURIComponent).join('/');
}

function createCdnUrl(tag: string, entry: string): string {
  return `${CDN_BASE_URL}/${REPOSITORY}@${encodeURIComponent(tag)}/${encodeEntry(entry)}`;
}

function createPluginRelease(release: Omit<ReleaseDescriptor, 'url' | 'updaterApiMajor'>): ReleaseDescriptor {
  return {
    ...release,
    url: createCdnUrl(release.tag, release.entry),
    updaterApiMajor: UPDATER_API_MAJOR,
  };
}

function createUpdaterRelease(release: Omit<UpdaterRelease, 'url'>): UpdaterRelease {
  return { ...release, url: createCdnUrl(release.tag, release.entry) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value);
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

function isSafeEntry(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value) &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    value.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..')
  );
}

function readUpdaterRelease(value: unknown): UpdaterRelease | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { version, tag, entry } = value;
  if (
    !isSafeVersion(version) ||
    tag !== `${UPDATER_TAG_PREFIX}${version}` ||
    typeof tag !== 'string' ||
    !isSafeEntry(entry)
  ) {
    return undefined;
  }
  return createUpdaterRelease({ version, tag, entry });
}

function selectUpdaterRelease(manifest: unknown): UpdaterRelease | undefined {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || manifest.repository !== REPOSITORY) {
    return undefined;
  }
  const updater = manifest.updater;
  if (!isRecord(updater) || !isRecord(updater.apiMajors)) {
    return undefined;
  }
  const api = updater.apiMajors[String(UPDATER_API_MAJOR)];
  return isRecord(api) ? readUpdaterRelease(api.stable) : undefined;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || '未知错误');
}

function readOverride(): BootstrapOverride {
  const overrides = (
    globalThis as typeof globalThis & {
      __TH_PLUGIN_BOOTSTRAP_OVERRIDES__?: Record<string, BootstrapOverride>;
    }
  ).__TH_PLUGIN_BOOTSTRAP_OVERRIDES__;
  return overrides?.[PLUGIN_ID] ?? {};
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

async function importUpdater(release: UpdaterRelease, overrideUrl?: string): Promise<PluginUpdaterModule> {
  const url = overrideUrl ?? release.url;
  const module = (await import(/* webpackIgnore: true */ url)) as PluginUpdaterModule;
  if (module.UPDATER_API_MAJOR !== UPDATER_API_MAJOR) {
    throw new Error(`更新器 API 不兼容：需要 v${UPDATER_API_MAJOR}，实际为 v${module.UPDATER_API_MAJOR ?? '未知'}`);
  }
  if (!overrideUrl && module.UPDATER_VERSION !== release.version) {
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

async function launch(): Promise<void> {
  const override = readOverride();
  const bootstrap: UpdaterBootstrapData = {};
  let latestUpdater: UpdaterRelease | undefined;

  try {
    bootstrap.manifest = await fetchManifest(override.manifestUrl ?? MANIFEST_URL);
    const manifestUpdater = selectUpdaterRelease(bootstrap.manifest);
    if (!manifestUpdater) {
      throw new Error('Manifest 中没有兼容的稳定版更新器');
    }
    latestUpdater =
      compareStableVersions(manifestUpdater.version, UPDATER_ANCHOR.version) >= 0 ? manifestUpdater : UPDATER_ANCHOR;
  } catch (error) {
    bootstrap.manifestError = describeError(error);
    console.warn(`[${PLUGIN_NAME}] 获取 Manifest 失败，将使用锚定更新器。`, error);
  }

  let updater: PluginUpdaterModule;
  let usingUpdaterAnchor = !latestUpdater || latestUpdater.url === UPDATER_ANCHOR.url;
  try {
    updater = await importUpdater(latestUpdater ?? UPDATER_ANCHOR, override.updaterUrl);
  } catch (error) {
    if (!latestUpdater || latestUpdater.url === UPDATER_ANCHOR.url || override.updaterUrl) {
      throw error;
    }
    console.warn(`[${PLUGIN_NAME}] 最新更新器加载失败，将使用锚定版本。`, error);
    updater = await importUpdater(UPDATER_ANCHOR);
    usingUpdaterAnchor = true;
  }

  const fallback = {
    ...DEFAULT_FALLBACK,
    ...(override.fallbackUrl ? { url: override.fallbackUrl } : {}),
  };
  const config: PluginUpdaterConfig = {
    pluginId: PLUGIN_ID,
    pluginName: PLUGIN_NAME,
    repository: REPOSITORY,
    manifestUrl: override.manifestUrl ?? MANIFEST_URL,
    cdnBaseUrl: CDN_BASE_URL,
    channel: 'stable',
    tagPrefix: PLUGIN_TAG_PREFIX,
    updaterApiMajor: UPDATER_API_MAJOR,
    fallback,
  };

  await waitForDocumentReady();
  try {
    await updater.bootPlugin!(config, bootstrap);
  } catch (error) {
    if (usingUpdaterAnchor || override.updaterUrl) {
      throw error;
    }
    console.warn(`[${PLUGIN_NAME}] 最新更新器运行失败，将使用锚定版本重试。`, error);
    const anchoredUpdater = await importUpdater(UPDATER_ANCHOR);
    await anchoredUpdater.bootPlugin!(config, bootstrap);
  }
}

void launch().catch(error => {
  console.error(`[${PLUGIN_NAME}] 引导失败。`, error);
  toastr.error(`启动失败：${describeError(error)}`, PLUGIN_NAME);
});
