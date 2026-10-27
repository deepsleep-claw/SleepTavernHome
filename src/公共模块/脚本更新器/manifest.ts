import type { PluginUpdaterConfig, ReleaseDescriptor, UpdateSource } from './contracts';
import { createCdnRuntime } from './sources';
import releaseVersions from '../../../release/versions.json';

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

export type RepositoryManifest = z.infer<typeof RepositoryManifestSchema>;

export function compareStableVersions(lhs: string, rhs: string): number {
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

export function buildReleaseUrl(config: PluginUpdaterConfig, tag: string, entry: string): string {
  if (!isSafeRepository(config.repository) || !isSafeTag(tag) || !isSafeEntry(entry)) {
    throw new Error('更新地址包含不安全的仓库、Tag 或入口路径');
  }

  const base = config.cdnBaseUrl.replace(/\/+$/u, '');
  const encodedEntry = entry.split('/').map(encodeURIComponent).join('/');
  return `${base}/${config.repository}@${encodeURIComponent(tag)}/${encodedEntry}`;
}

export function normalizeRelease(value: unknown, config: PluginUpdaterConfig): ReleaseDescriptor | undefined {
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

export function parseManifest(value: unknown, config: PluginUpdaterConfig): RepositoryManifest {
  const result = RepositoryManifestSchema.safeParse(value);
  if (!result.success) throw new Error(`Manifest 格式无效：${z.prettifyError(result.error)}`);
  if (result.data.repository !== config.repository) throw new Error('Manifest 仓库与引导器配置不一致');
  if (!normalizeRelease(result.data.plugins[config.pluginId]?.channels[config.channel], config)) {
    throw new Error(`${config.pluginName}的稳定版信息无效`);
  }
  return result.data;
}

export function selectUpdaterRelease(value: unknown, config: PluginUpdaterConfig) {
  let manifest: RepositoryManifest;
  try {
    manifest = parseManifest(value, config);
  } catch {
    return undefined;
  }
  const release = manifest.updater.apiMajors[String(config.updaterApiMajor)]?.stable;
  if (
    !release ||
    (release.updaterApiMajor !== undefined && release.updaterApiMajor !== config.updaterApiMajor) ||
    release.tag !== `${releaseVersions.updater.tagPrefix}${release.version}` ||
    !isSafeTag(release.tag) ||
    !isSafeEntry(release.entry)
  )
    return undefined;
  return { ...release, url: buildReleaseUrl(config, release.tag, release.entry) };
}

export async function fetchManifest(config: PluginUpdaterConfig, source: UpdateSource): Promise<RepositoryManifest> {
  const transport = createCdnRuntime(source);
  const mirrorUrl = buildReleaseUrl(config, 'main', 'manifest.json');
  const urls = [...new Set([...transport.urls(mirrorUrl), config.manifestUrl])];
  const results = await Promise.allSettled(
    urls.map(async url => {
      const request = new URL(url);
      request.searchParams.set('_th_cache_bust', Date.now().toString(36));
      const response = await transport.fetchText(request.href, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      return parseManifest(JSON.parse(response.text), config);
    }),
  );
  const manifests = results.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []));
  if (!manifests.length) {
    const errors = results.map(
      (result, index) =>
        `${new URL(urls[index]).hostname}: ${result.status === 'rejected' ? String(result.reason) : ''}`,
    );
    throw new Error(`获取更新清单失败：${errors.join('；')}`);
  }

  // 不同节点可能缓存不同清单，分别保留插件与更新器的最高兼容版本。
  const selected = structuredClone(manifests[0]);
  for (const manifest of manifests.slice(1)) {
    const release = manifest.plugins[config.pluginId].channels[config.channel];
    const current = selected.plugins[config.pluginId].channels[config.channel];
    if (compareStableVersions(release.version, current.version) > 0) {
      selected.plugins[config.pluginId].channels[config.channel] = release;
    }
    const updater = selectUpdaterRelease(manifest, config);
    const currentUpdater = selectUpdaterRelease(selected, config);
    if (updater && (!currentUpdater || compareStableVersions(updater.version, currentUpdater.version) > 0)) {
      selected.updater.apiMajors[String(config.updaterApiMajor)] =
        manifest.updater.apiMajors[String(config.updaterApiMajor)];
    }
  }
  return selected;
}
