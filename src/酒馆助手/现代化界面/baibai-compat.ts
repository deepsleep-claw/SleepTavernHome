import { getHostDocument, getHostWindow } from './host-context';

export type BaiBaiPromptGroups = {
  groups: Array<{ id: string; name?: string; enabled?: boolean }>;
  prompts: Record<string, { groupId?: string }>;
};

type BaiBaiRuntime = {
  installed?: boolean;
  presetPromptGroupRuntimePresetName?: string;
  presetPromptGroupRuntimeState?: BaiBaiPromptGroups;
  __baiBaiToolkitPresetGroupGenerationGatePatch?: unknown;
  __baiBaiToolkitPresetVueListManager?: { enabled?: boolean };
};

export function getBaiBaiRuntime(): BaiBaiRuntime | undefined {
  return (getHostWindow() as unknown as { __baiBaiToolkitExtensionInstalled?: BaiBaiRuntime })
    .__baiBaiToolkitExtensionInstalled;
}

export function isBaiBaiInstalled(): boolean {
  return Boolean(getBaiBaiRuntime()?.installed || getHostDocument().querySelector('.bai_bai_toolkit_settings'));
}

/** 设置面板可能晚于脚本加载，安装检测随其挂载与控件变化更新。 */
export function observeBaiBaiSettings(onChange: () => void): () => void {
  const document = getHostDocument();
  const window = getHostWindow();
  const observer = new window.MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement;
      if (target?.closest('#chat, #completion_prompt_manager, .th-modern-pm')) return false;
      return [...record.addedNodes, ...record.removedNodes].some(node => {
        if (node.nodeType !== 1) return false;
        const element = node as Element;
        const selector =
          '.bai_bai_toolkit_settings, #bai_bai_toolkit_preset_grouping_enabled, #bai_bai_toolkit_preset_interface_collapse_wrapper';
        return element.matches(selector) || Boolean(element.querySelector(selector));
      });
    });
    if (!relevant) return;
    onChange();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const handleInput = (event: Event) => {
    if ((event.target as Element | null)?.id?.startsWith('bai_bai_toolkit_')) onChange();
  };
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleInput);
  return () => {
    observer.disconnect();
    document.removeEventListener('input', handleInput);
    document.removeEventListener('change', handleInput);
  };
}

export function readBaiBaiPromptGroups(
  settings: { extensions?: Record<string, unknown> },
  presetName?: string,
): BaiBaiPromptGroups | undefined {
  const runtime = getBaiBaiRuntime();
  const extension = settings.extensions?.baibaiToolkit as { presetPromptGroups?: BaiBaiPromptGroups } | undefined;
  const live = runtime?.presetPromptGroupRuntimeState;
  const groups =
    live && presetName && runtime.presetPromptGroupRuntimePresetName === presetName
      ? live
      : extension?.presetPromptGroups;
  return Array.isArray(groups?.groups) && groups.prompts && typeof groups.prompts === 'object' ? groups : undefined;
}

export function getBaiBaiDisabledPrompts(
  settings: { extensions?: Record<string, unknown> },
  presetName?: string,
): Map<string, string> {
  const result = new Map<string, string>();
  if (!isBaiBaiInstalled()) return result;
  const checkbox = getHostDocument().querySelector<HTMLInputElement>('#bai_bai_toolkit_preset_grouping_enabled');
  const runtime = getBaiBaiRuntime();
  const enabled =
    checkbox?.checked ??
    Boolean(
      runtime?.__baiBaiToolkitPresetGroupGenerationGatePatch || runtime?.__baiBaiToolkitPresetVueListManager?.enabled,
    );
  const state = enabled ? readBaiBaiPromptGroups(settings, presetName) : undefined;
  const disabled = new Map(
    state?.groups
      .filter(group => group && group.enabled === false)
      .map(group => [group.id, group.name || '未命名分组']),
  );
  for (const [id, meta] of Object.entries(state?.prompts ?? {})) {
    const name = meta?.groupId ? disabled.get(meta.groupId) : undefined;
    if (name) result.set(id, name);
  }
  return result;
}
