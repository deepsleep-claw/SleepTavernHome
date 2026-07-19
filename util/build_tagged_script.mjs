/* eslint-disable import-x/no-nodejs-modules */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function fail(message) {
  throw new Error(`[tagged-script] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function resolveRepositoryPath(repositoryRoot, relativePath, label) {
  assert(typeof relativePath === 'string' && relativePath.length > 0, `${label} 不能为空`);
  assert(!path.isAbsolute(relativePath) && !relativePath.includes('\\'), `${label} 必须是正斜杠仓库相对路径`);
  assert(
    relativePath.split('/').every(segment => Boolean(segment) && segment !== '.' && segment !== '..'),
    `${label} 不能包含空路径、. 或 ..`,
  );
  const absolutePath = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, absolutePath);
  assert(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..', `${label} 必须位于仓库内`);
  return absolutePath;
}

function readJson(repositoryRoot, relativePath, label = relativePath) {
  const absolutePath = resolveRepositoryPath(repositoryRoot, relativePath, label);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    fail(`无法读取 ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function encodeEntry(entry) {
  return entry.split('/').map(encodeURIComponent).join('/');
}

function createBootstrapUrl(repository, tag, entry) {
  assert(/^[\w.-]+\/[\w.-]+$/u.test(repository), 'Manifest repository 无效');
  return `https://cdn.jsdelivr.net/gh/${repository}@${encodeURIComponent(tag)}/${encodeEntry(entry)}`;
}

function getMatchingPlugin(tag, versions) {
  const matches = Object.entries(versions.plugins ?? {}).filter(
    ([, plugin]) => typeof plugin?.tagPrefix === 'string' && tag.startsWith(plugin.tagPrefix),
  );
  assert(matches.length <= 1, `Tag ${tag} 同时匹配了多个插件前缀`);
  if (matches.length === 0) {
    return undefined;
  }
  const [pluginId, plugin] = matches[0];
  return { pluginId, plugin };
}

export function generateTaggedScript(tag, { repositoryRoot = defaultRepositoryRoot, expectedRepository } = {}) {
  assert(typeof tag === 'string' && tag.length > 0, '必须提供 Tag');

  const versions = readJson(repositoryRoot, 'release/versions.json');
  const manifest = readJson(repositoryRoot, 'manifest.json');
  assert(versions.schemaVersion === 1, 'release/versions.json schemaVersion 必须为 1');
  assert(manifest.schemaVersion === 1, 'manifest.json schemaVersion 必须为 1');

  const match = getMatchingPlugin(tag, versions);
  if (!match) {
    return { matched: false, tag };
  }
  if (expectedRepository !== undefined) {
    assert(manifest.repository === expectedRepository, `当前仓库 ${expectedRepository} 与 Manifest 不一致`);
  }

  const { pluginId, plugin } = match;
  const version = tag.slice(plugin.tagPrefix.length);
  assert(stableVersionPattern.test(version), `Tag ${tag} 的版本必须使用稳定的 x.y.z 格式`);
  assert(plugin.version === version, `Tag ${tag} 与 ${pluginId} 当前版本 ${plugin.version} 不一致`);
  assert(tag === `${plugin.tagPrefix}${plugin.version}`, `Tag ${tag} 与 ${pluginId} 的前缀或版本不一致`);
  assert(typeof plugin.name === 'string' && plugin.name.length > 0, `${pluginId}.name 无效`);
  assert(plugin.installer && typeof plugin.installer === 'object', `${pluginId}.installer 配置缺失`);

  const bootstrapPath = resolveRepositoryPath(repositoryRoot, plugin.bootstrapEntry, `${pluginId}.bootstrapEntry`);
  assert(fs.existsSync(bootstrapPath), `${pluginId} 的引导器产物不存在: ${plugin.bootstrapEntry}`);
  const pluginEntryPath = resolveRepositoryPath(repositoryRoot, plugin.entry, `${pluginId}.entry`);
  assert(fs.existsSync(pluginEntryPath), `${pluginId} 的主脚本产物不存在: ${plugin.entry}`);

  const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');
  const pluginSource = fs.readFileSync(pluginEntryPath, 'utf8');
  assert(
    bootstrapSource.includes(plugin.version) &&
      bootstrapSource.includes(plugin.tagPrefix) &&
      bootstrapSource.includes(plugin.entry),
    `${pluginId} 的引导器产物没有包含当前 fallback 配置，请先完成构建`,
  );
  assert(
    pluginSource.includes(pluginId) && pluginSource.includes(plugin.version),
    `${pluginId} 的主脚本产物与当前版本不一致，请先完成构建`,
  );

  const template = readJson(repositoryRoot, plugin.installer.template, `${pluginId}.installer.template`);
  const outputPath = resolveRepositoryPath(repositoryRoot, plugin.installer.output, `${pluginId}.installer.output`);
  assert(typeof plugin.installer.id === 'string' && plugin.installer.id.length > 0, `${pluginId}.installer.id 无效`);
  assert(typeof plugin.installer.enabled === 'boolean', `${pluginId}.installer.enabled 必须是布尔值`);
  assert(typeof plugin.installer.info === 'string', `${pluginId}.installer.info 必须是字符串`);

  const bootstrapUrl = createBootstrapUrl(manifest.repository, tag, plugin.bootstrapEntry);
  const script = {
    ...template,
    type: 'script',
    enabled: plugin.installer.enabled,
    name: plugin.name,
    id: plugin.installer.id,
    content: `import '${bootstrapUrl}';`,
    info: plugin.installer.info,
    button: {
      enabled: true,
      buttons: [],
    },
    data: {},
    export_with: {
      data: true,
      button: true,
    },
  };

  return {
    matched: true,
    tag,
    version,
    pluginId,
    pluginName: plugin.name,
    output: plugin.installer.output,
    outputPath,
    bootstrapUrl,
    script,
  };
}

export function writeTaggedScript(result) {
  if (!result.matched) {
    return;
  }
  fs.mkdirSync(path.dirname(result.outputPath), { recursive: true });
  fs.writeFileSync(result.outputPath, `${JSON.stringify(result.script, null, 2)}\n`, 'utf8');
}

function appendGitHubOutputs(file, result) {
  const outputs = result.matched
    ? {
        matched: 'true',
        tag: result.tag,
        version: result.version,
        plugin_id: result.pluginId,
        plugin_name: result.pluginName,
        output: result.output,
      }
    : {
        matched: 'false',
        tag: result.tag,
      };
  const content = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.appendFileSync(file, `${content}\n`, 'utf8');
}

function readArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--tag' || name === '--repository' || name === '--github-output') {
      assert(value !== undefined, `${name} 缺少参数`);
      options[name.slice(2)] = value;
      index += 1;
      continue;
    }
    fail(`未知参数: ${name}`);
  }
  return options;
}

async function main() {
  const options = readArguments(process.argv.slice(2));
  const result = generateTaggedScript(options.tag ?? process.env.GITHUB_REF_NAME, {
    expectedRepository: options.repository,
  });
  if (result.matched) {
    writeTaggedScript(result);
    console.info(`[tagged-script] 已生成 ${result.pluginName} v${result.version}: ${result.output}`);
  } else {
    console.info(`[tagged-script] Tag ${result.tag} 没有匹配任何插件前缀，跳过生成`);
  }
  const githubOutput = options['github-output'] ?? process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendGitHubOutputs(githubOutput, result);
  }
}

const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
