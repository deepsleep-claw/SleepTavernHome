import { klona } from 'klona';
import { normalizeWorkspacePath, parentWorkspacePath, workspaceBasename } from '../workspace/path';
import { WorkspaceError, type WorkspaceFile } from '../workspace/types';
import { encodeWorkspaceSegment, parseYamlObject, serializeYaml, slugifyFileName } from './serde';
import type {
  CardWorkspaceState,
  RegexMacroSubstitution,
  ScopedRegexData,
  ScopedScriptData,
  TavernRegexData,
  TavernResourceScope,
  TavernResourceState,
  TavernScriptData,
  TavernScriptTreeReference,
} from './types';

export const TAVERN_RESOURCE_SCOPES: TavernResourceScope[] = ['character', 'global', 'preset-current'];

export type TavernResourceProjectionOptions = {
  allowNonCharacterWrites?: boolean;
};

function file(
  path: string,
  content: string,
  resourceId: string,
  readonly = false,
  mediaType: WorkspaceFile['mediaType'] = 'text/yaml',
): WorkspaceFile {
  return { content, mediaType, path: normalizeWorkspacePath(path), readonly, resourceId };
}

function isWritable(scope: TavernResourceScope, options: TavernResourceProjectionOptions): boolean {
  return scope === 'character' || options.allowNonCharacterWrites === true;
}

function scopeMetadata(
  scope: TavernResourceScope,
  data: { available: boolean; reason?: string; targetId: string },
  writable: boolean,
): string {
  return serializeYaml({
    available: data.available,
    reason: data.reason ?? null,
    scope,
    target_id: data.targetId,
    writable: data.available && writable,
  });
}

function regexFileName(regex: TavernRegexData): string {
  return `${encodeWorkspaceSegment(regex.id)}-${slugifyFileName(regex.name, 'regex')}.yaml`;
}

function projectRegexScope(
  scope: TavernResourceScope,
  data: ScopedRegexData,
  options: TavernResourceProjectionOptions,
): WorkspaceFile[] {
  const root = `/regexes/${scope}`;
  const writable = isWritable(scope, options);
  const files = [file(`${root}/_scope.yaml`, scopeMetadata(scope, data, writable), `regex-scope:${scope}`, true)];
  if (!data.available) {
    files.push(
      file(
        `${root}/_unavailable.md`,
        `# 当前作用域不可用\n\n${data.reason ?? '酒馆没有提供该正则作用域。'}\n`,
        `regex-unavailable:${scope}`,
        true,
        'text/markdown',
      ),
    );
    return files;
  }
  for (const regex of data.regexes) {
    files.push(
      file(
        `${root}/${regexFileName(regex)}`,
        serializeYaml({
          destination: regex.destination,
          enabled: regex.enabled,
          find_regex: regex.findRegex,
          id: regex.id,
          macro_substitution: regex.substituteRegex,
          max_depth: regex.maxDepth,
          min_depth: regex.minDepth,
          name: regex.name,
          order: regex.order,
          replace_string: regex.replaceString,
          run_on_edit: regex.runOnEdit,
          source: {
            ai_output: regex.source.aiOutput,
            reasoning: regex.source.reasoning,
            slash_command: regex.source.slashCommand,
            user_input: regex.source.userInput,
            world_info: regex.source.worldInfo,
          },
          trim_strings: regex.trimStrings,
        }),
        regex.resourceId,
        !writable,
      ),
    );
  }
  return files;
}

function scriptDirectory(root: string, script: TavernScriptData): string {
  return `${root}/scripts/${encodeWorkspaceSegment(script.id)}-${slugifyFileName(script.name, 'script')}`;
}

function projectScriptScope(
  scope: TavernResourceScope,
  data: ScopedScriptData,
  options: TavernResourceProjectionOptions,
): WorkspaceFile[] {
  const root = `/tavern-helper-scripts/${scope}`;
  const writable = isWritable(scope, options);
  const files = [file(`${root}/_scope.yaml`, scopeMetadata(scope, data, writable), `script-scope:${scope}`, true)];
  if (!data.available) {
    files.push(
      file(
        `${root}/_unavailable.md`,
        `# 当前作用域不可用\n\n${data.reason ?? '酒馆助手没有提供该脚本作用域。'}\n`,
        `script-unavailable:${scope}`,
        true,
        'text/markdown',
      ),
    );
    return files;
  }
  files.push(
    file(
      `${root}/tree.yaml`,
      serializeYaml({
        trees: data.trees.map(tree =>
          tree.type === 'script'
            ? { id: tree.scriptId, type: 'script' }
            : {
                color: tree.color,
                enabled: tree.enabled,
                icon: tree.icon,
                id: tree.id,
                name: tree.name,
                scripts: tree.scriptIds,
                type: 'folder',
              },
        ),
      }),
      `script-tree:${scope}`,
      !writable,
    ),
  );
  for (const script of data.scripts) {
    const directory = scriptDirectory(root, script);
    files.push(
      file(
        `${directory}/info.yaml`,
        serializeYaml({
          button: script.button,
          enabled: script.enabled,
          export_with: script.exportWith,
          id: script.id,
          name: script.name,
        }),
        script.resourceId,
        !writable,
      ),
      file(`${directory}/info.md`, script.info, script.resourceId, !writable, 'text/markdown'),
      file(`${directory}/script.js`, script.content, script.resourceId, !writable, 'text/plain'),
      file(`${directory}/data.yaml`, serializeYaml(script.data), script.resourceId, !writable),
    );
  }
  return files;
}

export function projectTavernResources(
  resources: TavernResourceState,
  options: TavernResourceProjectionOptions = {},
): WorkspaceFile[] {
  return TAVERN_RESOURCE_SCOPES.flatMap(scope => [
    ...projectRegexScope(scope, resources.regexes[scope], options),
    ...projectScriptScope(scope, resources.scripts[scope], options),
  ]).sort((left, right) => left.path.localeCompare(right.path));
}

function requiredString(value: unknown, label: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是非空字符串：${path}`, path);
  }
  return value;
}

function requiredBoolean(value: unknown, label: string, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是布尔值：${path}`, path);
  }
  return value;
}

function requiredNumber(value: unknown, label: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是有限数字：${path}`, path);
  }
  return value;
}

function nullableNumber(value: unknown, label: string, path: string): number | null {
  return value === null || value === undefined ? null : requiredNumber(value, label, path);
}

function record(value: unknown, label: string, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是对象：${path}`, path);
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown, label: string, path: string): string[] {
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new WorkspaceError('INVALID_PATCH', `${label}必须是字符串数组：${path}`, path);
  }
  return value;
}

function boolField(source: Record<string, unknown>, key: string, path: string, fallback = false): boolean {
  return source[key] === undefined ? fallback : requiredBoolean(source[key], key, path);
}

function macroSubstitution(value: unknown, path: string): RegexMacroSubstitution {
  if (value === 'none' || value === 'raw' || value === 'escaped') return value;
  throw new WorkspaceError('INVALID_PATCH', 'macro_substitution必须是none、raw或escaped。', path);
}

function regexFiles(files: Map<string, WorkspaceFile>, scope: TavernResourceScope): WorkspaceFile[] {
  const root = `/regexes/${scope}`;
  return [...files.values()].filter(
    item =>
      parentWorkspacePath(item.path) === root &&
      item.path.endsWith('.yaml') &&
      !workspaceBasename(item.path).startsWith('_'),
  );
}

function materializeRegexScope(
  base: ScopedRegexData,
  files: Map<string, WorkspaceFile>,
  scope: TavernResourceScope,
): ScopedRegexData {
  if (!base.available) return klona(base);
  const parsed = regexFiles(files, scope).map(input => {
    const metadata = parseYamlObject(input.content, input.path);
    const source = record(metadata.source ?? {}, 'source', input.path);
    const destination = record(metadata.destination ?? {}, 'destination', input.path);
    const byResource = base.regexes.find(regex => regex.resourceId === input.resourceId);
    const rawId = metadata.id;
    const id = rawId === undefined ? byResource?.id ?? input.resourceId : requiredString(rawId, 'id', input.path);
    const byId = base.regexes.find(regex => regex.id === id);
    const previous = byResource ?? byId;
    if (previous && id !== previous.id) {
      throw new WorkspaceError('INVALID_PATCH', `已有正则的id不能修改：${input.path}`, input.path);
    }
    return {
      destination: {
        display: boolField(destination, 'display', input.path),
        prompt: boolField(destination, 'prompt', input.path),
      },
      enabled: requiredBoolean(metadata.enabled, 'enabled', input.path),
      findRegex: typeof metadata.find_regex === 'string' ? metadata.find_regex : '',
      id,
      maxDepth: nullableNumber(metadata.max_depth, 'max_depth', input.path),
      minDepth: nullableNumber(metadata.min_depth, 'min_depth', input.path),
      name: requiredString(metadata.name, 'name', input.path),
      order: requiredNumber(metadata.order ?? previous?.order ?? 0, 'order', input.path),
      replaceString: typeof metadata.replace_string === 'string' ? metadata.replace_string : '',
      resourceId: previous?.resourceId ?? input.resourceId,
      runOnEdit: requiredBoolean(metadata.run_on_edit ?? false, 'run_on_edit', input.path),
      source: {
        aiOutput: boolField(source, 'ai_output', input.path),
        reasoning: boolField(source, 'reasoning', input.path),
        slashCommand: boolField(source, 'slash_command', input.path),
        userInput: boolField(source, 'user_input', input.path),
        worldInfo: boolField(source, 'world_info', input.path),
      },
      substituteRegex: macroSubstitution(metadata.macro_substitution ?? 'none', input.path),
      trimStrings: stringArray(metadata.trim_strings ?? [], 'trim_strings', input.path),
      unknownFields: klona(previous?.unknownFields ?? {}),
      unknownPlacements: klona(previous?.unknownPlacements ?? []),
    } satisfies TavernRegexData;
  });
  const ids = new Set<string>();
  for (const regex of parsed) {
    if (ids.has(regex.id)) {
      throw new WorkspaceError('INVALID_PATCH', `正则id重复：${regex.id}`, `/regexes/${scope}`);
    }
    ids.add(regex.id);
  }
  parsed.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  parsed.forEach((regex, index) => {
    regex.order = (index + 1) * 100;
  });
  return { ...klona(base), regexes: parsed };
}

function scriptGroups(files: Map<string, WorkspaceFile>, scope: TavernResourceScope): Map<string, WorkspaceFile[]> {
  const root = `/tavern-helper-scripts/${scope}/scripts`;
  const groups = new Map<string, WorkspaceFile[]>();
  for (const input of files.values()) {
    if (!input.path.startsWith(`${root}/`)) continue;
    const relative = input.path.slice(root.length + 1).split('/');
    if (relative.length !== 2) continue;
    const directory = `${root}/${relative[0]}`;
    const group = groups.get(directory) ?? [];
    group.push(input);
    groups.set(directory, group);
  }
  return groups;
}

function scriptButtons(value: unknown, path: string): TavernScriptData['button'] {
  const button = record(value ?? {}, 'button', path);
  const rawButtons = button.buttons ?? [];
  if (!Array.isArray(rawButtons)) {
    throw new WorkspaceError('INVALID_PATCH', `button.buttons必须是数组：${path}`, path);
  }
  return {
    buttons: rawButtons.map(raw => {
      const item = record(raw, 'button item', path);
      return {
        name: requiredString(item.name, 'button.name', path),
        visible: requiredBoolean(item.visible, 'button.visible', path),
      };
    }),
    enabled: requiredBoolean(button.enabled ?? false, 'button.enabled', path),
  };
}

function scriptExport(value: unknown, path: string): TavernScriptData['exportWith'] {
  const exportWith = record(value ?? {}, 'export_with', path);
  return {
    button: requiredBoolean(exportWith.button ?? false, 'export_with.button', path),
    data: requiredBoolean(exportWith.data ?? false, 'export_with.data', path),
  };
}

function materializeScripts(
  base: ScopedScriptData,
  files: Map<string, WorkspaceFile>,
  scope: TavernResourceScope,
): TavernScriptData[] {
  const result: TavernScriptData[] = [];
  const ids = new Set<string>();
  for (const [directory, group] of scriptGroups(files, scope)) {
    const byName = new Map(group.map(input => [workspaceBasename(input.path), input]));
    const info = byName.get('info.yaml');
    if (!info) {
      throw new WorkspaceError(
        'INVALID_PATCH',
        `脚本目录存在内容但缺少info.yaml；若要删除脚本，请删除整个目录：${directory}`,
        directory,
      );
    }
    const metadata = parseYamlObject(info.content, info.path);
    const byResource = base.scripts.find(script => script.resourceId === info.resourceId);
    const rawId = metadata.id;
    const id = rawId === undefined ? byResource?.id ?? info.resourceId : requiredString(rawId, 'id', info.path);
    const byId = base.scripts.find(script => script.id === id);
    const previous = byResource ?? byId;
    if (previous && id !== previous.id) {
      throw new WorkspaceError('INVALID_PATCH', `已有脚本的id不能修改：${info.path}`, info.path);
    }
    if (ids.has(id)) {
      throw new WorkspaceError('INVALID_PATCH', `脚本id重复：${id}`, info.path);
    }
    ids.add(id);
    const dataFile = byName.get('data.yaml');
    result.push({
      button: scriptButtons(metadata.button, info.path),
      content: byName.get('script.js')?.content ?? '',
      data: dataFile ? parseYamlObject(dataFile.content, dataFile.path) : {},
      enabled: requiredBoolean(metadata.enabled ?? false, 'enabled', info.path),
      exportWith: scriptExport(metadata.export_with, info.path),
      id,
      info: byName.get('info.md')?.content ?? '',
      name: requiredString(metadata.name, 'name', info.path),
      resourceId: previous?.resourceId ?? info.resourceId,
      unknownFields: klona(previous?.unknownFields ?? {}),
    });
  }
  return result;
}

function folderId(raw: Record<string, unknown>, index: number, path: string): string {
  if (raw.id !== undefined) return requiredString(raw.id, 'folder.id', path);
  const name = requiredString(raw.name, 'folder.name', path);
  return `folder:${index + 1}:${slugifyFileName(name, 'folder')}`;
}

function materializeScriptTrees(
  base: ScopedScriptData,
  scripts: TavernScriptData[],
  files: Map<string, WorkspaceFile>,
  scope: TavernResourceScope,
): TavernScriptTreeReference[] {
  const path = `/tavern-helper-scripts/${scope}/tree.yaml`;
  const input = files.get(path);
  if (!input) {
    throw new WorkspaceError('NOT_FOUND', `tree.yaml不能删除：${path}`, path);
  }
  const rawTrees = parseYamlObject(input.content, path).trees;
  if (!Array.isArray(rawTrees)) {
    throw new WorkspaceError('INVALID_PATCH', `trees必须是数组：${path}`, path);
  }
  const scriptIds = new Set(scripts.map(script => script.id));
  const referenced = new Set<string>();
  const folderIds = new Set<string>();
  const result: TavernScriptTreeReference[] = [];
  for (const [index, rawTree] of rawTrees.entries()) {
    const tree = record(rawTree, 'tree item', path);
    if (tree.type === 'script') {
      const id = requiredString(tree.id, 'script.id', path);
      if (!scriptIds.has(id)) throw new WorkspaceError('INVALID_PATCH', `tree.yaml引用了不存在的脚本：${id}`, path);
      if (referenced.has(id)) throw new WorkspaceError('INVALID_PATCH', `tree.yaml重复引用脚本：${id}`, path);
      referenced.add(id);
      result.push({ scriptId: id, type: 'script' });
      continue;
    }
    if (tree.type !== 'folder') {
      throw new WorkspaceError('INVALID_PATCH', `tree.type必须是script或folder：${path}`, path);
    }
    const id = folderId(tree, index, path);
    if (folderIds.has(id)) throw new WorkspaceError('INVALID_PATCH', `文件夹id重复：${id}`, path);
    folderIds.add(id);
    const ids = stringArray(tree.scripts ?? [], 'folder.scripts', path);
    for (const scriptId of ids) {
      if (!scriptIds.has(scriptId)) {
        throw new WorkspaceError('INVALID_PATCH', `文件夹引用了不存在的脚本：${scriptId}`, path);
      }
      if (referenced.has(scriptId)) {
        throw new WorkspaceError('INVALID_PATCH', `tree.yaml重复引用脚本：${scriptId}`, path);
      }
      referenced.add(scriptId);
    }
    const previous = base.trees.find(tree => tree.type === 'folder' && tree.id === id);
    result.push({
      color: typeof tree.color === 'string' ? tree.color : '',
      enabled: requiredBoolean(tree.enabled ?? true, 'folder.enabled', path),
      icon: typeof tree.icon === 'string' ? tree.icon : '',
      id,
      name: requiredString(tree.name, 'folder.name', path),
      scriptIds: ids,
      type: 'folder',
      unknownFields: klona(previous?.type === 'folder' ? previous.unknownFields : {}),
    });
  }
  for (const script of scripts) {
    if (!referenced.has(script.id)) result.push({ scriptId: script.id, type: 'script' });
  }
  return result;
}

function materializeScriptScope(
  base: ScopedScriptData,
  files: Map<string, WorkspaceFile>,
  scope: TavernResourceScope,
): ScopedScriptData {
  if (!base.available) return klona(base);
  const scripts = materializeScripts(base, files, scope);
  return {
    ...klona(base),
    scripts,
    trees: materializeScriptTrees(base, scripts, files, scope),
  };
}

export function materializeTavernResources(
  base: CardWorkspaceState,
  inputs: Iterable<WorkspaceFile>,
): TavernResourceState {
  const files = new Map([...inputs].map(input => [normalizeWorkspacePath(input.path), input]));
  return {
    regexes: Object.fromEntries(
      TAVERN_RESOURCE_SCOPES.map(scope => [scope, materializeRegexScope(base.resources.regexes[scope], files, scope)]),
    ) as TavernResourceState['regexes'],
    scripts: Object.fromEntries(
      TAVERN_RESOURCE_SCOPES.map(scope => [scope, materializeScriptScope(base.resources.scripts[scope], files, scope)]),
    ) as TavernResourceState['scripts'],
  };
}

