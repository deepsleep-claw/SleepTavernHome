/* eslint-disable import-x/no-nodejs-modules */
import { compareVersions, validate } from 'compare-versions';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { generateTaggedScript } from './build_tagged_script.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = readJson('manifest.json');
const versions = readJson('release/versions.json');
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const releaseAssetPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u;

function fail(message) {
  throw new Error(`[update-manifest] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`无法读取 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertSafeEntry(entry, label) {
  assert(typeof entry === 'string' && entry.length > 0, `${label}.entry 不能为空`);
  assert(!path.isAbsolute(entry) && !entry.includes('\\'), `${label}.entry 必须是仓库内的正斜杠相对路径`);
  assert(
    entry.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..'),
    `${label}.entry 不能包含空路径、. 或 ..`,
  );
  assert(fs.existsSync(path.join(repositoryRoot, entry)), `${label}.entry 对应的产物不存在: ${entry}`);
}

function assertRelease(release, expected, label, updaterApiMajor) {
  assert(release && typeof release === 'object', `${label} 不存在`);
  assert(validate(release.version), `${label}.version 不是有效 SemVer`);
  assert(stableVersionPattern.test(release.version), `${label}.version 必须是稳定的 x.y.z 版本`);
  assert(validate(expected.version), `${label} 对应的待发布版本不是有效 SemVer`);
  assert(stableVersionPattern.test(expected.version), `${label} 对应的待发布版本必须使用 x.y.z 格式`);
  assert(
    compareVersions(release.version, expected.version) <= 0,
    `${label}.version 不能领先于 release/versions.json 中的待发布版本`,
  );
  assert(release.tag === `${expected.tagPrefix}${release.version}`, `${label}.tag 与版本号不一致`);
  assert(release.entry === expected.entry, `${label}.entry 与 release/versions.json 不一致`);
  if (updaterApiMajor !== undefined) {
    assert(release.updaterApiMajor === updaterApiMajor, `${label}.updaterApiMajor 不一致`);
  }
  assertSafeEntry(release.entry, label);
}

assert(manifest.schemaVersion === 1, 'manifest.schemaVersion 必须为 1');
assert(versions.schemaVersion === 1, 'release/versions.json schemaVersion 必须为 1');
assert(typeof manifest.repository === 'string' && /^[\w.-]+\/[\w.-]+$/u.test(manifest.repository), '仓库名无效');

const updaterApiMajor = versions.updater.apiMajor;
assert(Number.isInteger(updaterApiMajor) && updaterApiMajor > 0, '更新器 API 主版本无效');
const updaterStable = manifest.updater?.apiMajors?.[String(updaterApiMajor)]?.stable;
assertRelease(updaterStable, versions.updater, `updater.apiMajors.${updaterApiMajor}.stable`);
assertSafeEntry(versions.updater.coreEntry, 'updater.core');
const updaterTag = `${versions.updater.tagPrefix}${versions.updater.version}`;
assert(!generateTaggedScript(updaterTag, { repositoryRoot }).matched, `${updaterTag} 不应匹配任何插件发布前缀`);

const installerIds = new Set();
const installerOutputs = new Set();

for (const [pluginId, pluginConfig] of Object.entries(versions.plugins)) {
  const plugin = manifest.plugins?.[pluginId];
  assert(plugin, `manifest.plugins.${pluginId} 不存在`);
  assert(plugin.name === pluginConfig.name, `manifest.plugins.${pluginId}.name 不一致`);
  assert(
    Object.keys(plugin.channels ?? {}).length === 1 && plugin.channels?.stable,
    `manifest.plugins.${pluginId} 第一版只能包含 stable 通道`,
  );
  assertRelease(plugin.channels.stable, pluginConfig, `plugins.${pluginId}.channels.stable`, updaterApiMajor);

  assert(pluginConfig.installer && typeof pluginConfig.installer === 'object', `${pluginId}.installer 配置缺失`);
  assertSafeEntry(pluginConfig.installer.template, `plugins.${pluginId}.installer.template`);
  assertSafeEntry(pluginConfig.installer.output, `plugins.${pluginId}.installer.output`);
  assert(!installerIds.has(pluginConfig.installer.id), `${pluginId}.installer.id 与其他插件重复`);
  assert(!installerOutputs.has(pluginConfig.installer.output), `${pluginId}.installer.output 与其他插件重复`);
  installerIds.add(pluginConfig.installer.id);
  installerOutputs.add(pluginConfig.installer.output);
  assert(
    typeof pluginConfig.installer.releaseAsset === 'string' &&
      releaseAssetPattern.test(pluginConfig.installer.releaseAsset),
    `${pluginId}.installer.releaseAsset 必须是安全的 ASCII JSON 文件名`,
  );

  const tag = `${pluginConfig.tagPrefix}${pluginConfig.version}`;
  const generated = generateTaggedScript(tag, { repositoryRoot });
  assert(generated.matched && generated.pluginId === pluginId, `${tag} 未能匹配插件 ${pluginId}`);
  const installer = readJson(pluginConfig.installer.output);
  assert(isDeepStrictEqual(installer, generated.script), `${pluginConfig.installer.output} 与模板及当前版本配置不一致`);
  assert(installer.content.includes(generated.updaterUrl), `${pluginConfig.installer.output} 没有引用锚定通用更新器`);
  assert(installer.content.includes(generated.fallbackUrl), `${pluginConfig.installer.output} 没有声明正式主脚本 fallback`);
  assert(
    !installer.content.includes('现代化界面引导器'),
    `${pluginConfig.installer.output} 不应再引用插件专用引导器`,
  );
}

console.info('[update-manifest] Manifest、版本配置和发布产物校验通过');
