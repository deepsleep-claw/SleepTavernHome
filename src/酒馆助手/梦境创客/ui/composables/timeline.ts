// 会话时间线的分组与展示纯逻辑。
// 从原 WorkspaceWindow.vue 平移，语义保持不变：
// - 一轮运行按 checkpointId 关联，用户消息与最终助手回复外置，过程内容进运行块；
// - 连续工具调用合并为一个工具组；
// - 完成且含多个片段/工具的运行块默认折叠，失败/停止/异常默认展开；
// - 只有最终回复时不创建空的运行块。
import type { SessionUiItem } from '../../core/session/types';
import { formatRunDuration } from './format';

export type RunDisplayStatus = 'abnormal' | 'completed' | 'context-exhausted' | 'failed' | 'running' | 'stopped';

export type RunTimelineBlock = {
  durationMs: number;
  id: string;
  items: SessionUiItem[];
  status: RunDisplayStatus;
  type: 'run';
};

export type TimelineBlock = { id: string; item: SessionUiItem; type: 'item' } | RunTimelineBlock;

export type RunContentBlock =
  { id: string; item: SessionUiItem; type: 'item' } | { id: string; items: SessionUiItem[]; type: 'tools' };

function runDisplayStatus(
  user: SessionUiItem | undefined,
  active: boolean,
  activeStatus: string | undefined,
): RunDisplayStatus {
  if (user?.runStatus) return user.runStatus;
  if (!active) return 'completed';
  if (activeStatus === 'running' || activeStatus === 'waiting-approval') return 'running';
  if (
    activeStatus === 'abnormal' ||
    activeStatus === 'context-exhausted' ||
    activeStatus === 'failed' ||
    activeStatus === 'stopped'
  ) {
    return activeStatus;
  }
  return 'completed';
}

function runDuration(
  user: SessionUiItem | undefined,
  items: SessionUiItem[],
  activeStillRunning: boolean,
  now: number,
): number {
  if (user?.durationMs !== undefined) return user.durationMs;
  const startedAt = user?.at ?? items[0]?.at ?? now;
  if (activeStillRunning) return Math.max(0, now - startedAt);

  // 旧版本没有持久化整轮 durationMs。已完成轮次绝不能以“现在”作为结束点，
  // 否则每次打开历史都会继续变长；用该轮最后一个可见事件（含片段自身耗时）兼容估算。
  const endedAt = Math.max(
    startedAt,
    ...items.map(item => item.at + Math.max(0, item.durationMs ?? 0)),
  );
  return Math.max(0, endedAt - startedAt);
}

export function buildTimelineBlocks(
  ui: SessionUiItem[],
  activeStatus: string | undefined,
  limit: number,
  now = Date.now(),
): TimelineBlock[] {
  const byCheckpoint = new Map<string, SessionUiItem[]>();
  for (const item of ui) {
    if (!item.checkpointId) continue;
    const items = byCheckpoint.get(item.checkpointId) ?? [];
    items.push(item);
    byCheckpoint.set(item.checkpointId, items);
  }
  const lastCheckpointId = [...ui].reverse().find(item => item.kind === 'user')?.checkpointId;
  const runByItemId = new Map<string, RunTimelineBlock>();
  for (const [checkpointId, items] of byCheckpoint) {
    const user = items.find(item => item.kind === 'user');
    const assistants = items.filter(item => item.kind === 'assistant');
    const activeStillRunning =
      checkpointId === lastCheckpointId && ['running', 'waiting-approval'].includes(activeStatus ?? '');
    const finalAssistant = !activeStillRunning && assistants.length > 0 ? assistants.at(-1) : undefined;
    if (!user) continue;

    const processItems = items.filter(item => item.kind !== 'user' && item.id !== finalAssistant?.id);
    const hasGuidance = processItems.some(item => item.kind === 'guidance');
    const segments: Array<{ endedAt?: number; items: SessionUiItem[]; startedAt: number }> = [
      { items: [], startedAt: user.at },
    ];
    for (const item of processItems) {
      if (item.kind === 'guidance') {
        segments.at(-1)!.endedAt = item.at;
        segments.push({ items: [], startedAt: item.at });
      } else {
        segments.at(-1)!.items.push(item);
      }
    }
    const nonEmptySegments = segments
      .map((segment, index) => ({ ...segment, index }))
      .filter(segment => segment.items.length > 0);
    const lastSegmentIndex = nonEmptySegments.at(-1)?.index;
    for (const segment of nonEmptySegments) {
      const isLastSegment = segment.index === lastSegmentIndex;
      const endFromItems = Math.max(
        segment.startedAt,
        ...segment.items.map(item => item.at + Math.max(0, item.durationMs ?? 0)),
      );
      const endedAt =
        segment.endedAt ??
        (isLastSegment && activeStillRunning
          ? now
          : Math.max(endFromItems, finalAssistant?.at ?? segment.startedAt));
      const block: RunTimelineBlock = {
        durationMs: hasGuidance
          ? Math.max(0, endedAt - segment.startedAt)
          : runDuration(user, items, activeStillRunning, now),
        id: hasGuidance ? `run:${checkpointId}:${segment.index}` : `run:${checkpointId}`,
        items: segment.items,
        status: isLastSegment
          ? runDisplayStatus(user, checkpointId === lastCheckpointId, activeStatus)
          : 'completed',
        type: 'run',
      };
      segment.items.forEach(item => runByItemId.set(item.id, block));
    }
  }
  const blocks: TimelineBlock[] = [];
  const insertedRuns = new Set<string>();
  for (const item of ui.slice(-limit)) {
    const run = runByItemId.get(item.id);
    if (run) {
      if (insertedRuns.has(run.id)) continue;
      insertedRuns.add(run.id);
      blocks.push(run);
      continue;
    }
    blocks.push({ id: item.id, item, type: 'item' });
  }
  return blocks;
}

export function runContentBlocks(items: SessionUiItem[]): RunContentBlock[] {
  const blocks: RunContentBlock[] = [];
  for (const item of items) {
    const previous = blocks.at(-1);
    if (item.kind === 'tool' && previous?.type === 'tools') previous.items.push(item);
    else if (item.kind === 'tool') blocks.push({ id: `tools:${item.id}`, items: [item], type: 'tools' });
    else blocks.push({ id: item.id, item, type: 'item' });
  }
  return blocks;
}

export function defaultRunCollapsed(block: RunTimelineBlock): boolean {
  if (block.status !== 'completed') return false;
  return block.items.some(item => item.kind === 'tool') || block.items.length > 1;
}

export function runStatusLabel(block: RunTimelineBlock): string {
  const duration = formatRunDuration(block.durationMs);
  return {
    abnormal: `异常中断 · ${duration}`,
    completed: `已运行 ${duration}`,
    'context-exhausted': `上下文已满 · ${duration}`,
    failed: `运行失败 · ${duration}`,
    running: `正在运行 ${duration}`,
    stopped: `已停止 · ${duration}`,
  }[block.status];
}

export function runStatusIcon(status: RunDisplayStatus): string {
  return {
    abnormal: 'fa-solid fa-triangle-exclamation',
    completed: 'fa-solid fa-circle-check',
    'context-exhausted': 'fa-solid fa-gauge-high',
    failed: 'fa-solid fa-circle-xmark',
    running: 'fa-solid fa-spinner fa-spin',
    stopped: 'fa-solid fa-circle-stop',
  }[status];
}

export function runContentSummary(items: SessionUiItem[]): string {
  const tools = items.filter(item => item.kind === 'tool').length;
  if (tools > 0) return `${tools} 次工具调用`;
  return items.length === 1 ? '1 个过程片段' : `${items.length} 个过程片段`;
}

export function toolGroupHasFailure(items: SessionUiItem[]): boolean {
  return items.some(item => item.status === 'failed');
}

export function toolGroupLabel(items: SessionUiItem[]): string {
  if (items.some(item => item.status === 'running')) return `正在调用工具 · ${items.length}`;
  if (toolGroupHasFailure(items)) return `工具调用出现失败 · ${items.length}`;
  return `已调用 ${items.length} 个工具`;
}

export function toolGroupSummary(items: SessionUiItem[]): string {
  const counts = new Map<string, number>();
  items.forEach(item => counts.set(item.toolName ?? '工具', (counts.get(item.toolName ?? '工具') ?? 0) + 1));
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(' · ');
}

export function toolStatusLabel(status: SessionUiItem['status']): string {
  return { completed: '完成', failed: '失败', running: '运行中' }[status ?? 'completed'];
}

export function reasoningLabel(item: SessionUiItem): string {
  if (item.status === 'running') return '思考中';
  const seconds = (item.durationMs ?? 0) / 1_000;
  return seconds < 1 ? '已思考不到 1 秒' : `已思考 ${Math.round(seconds)} 秒`;
}

export function itemKindLabel(kind: SessionUiItem['kind']): string {
  return {
    assistant: '梦境创客',
    guidance: '你 · 中途引导',
    manual: '玩家修改工作区',
    reasoning: '思考过程',
    status: '运行状态',
    tool: '工具调用',
    user: '你',
  }[kind];
}

export function cleanGuidance(value: string): string {
  return value
    .replace(/<\/?mid_turn_guidance>/gu, '')
    .replace('这是对当前未完成目标的中途补充，不是替换旧目标的新任务。', '')
    .trim();
}

export function isMarkdownMessage(item: SessionUiItem): boolean {
  return item.kind === 'assistant' || item.kind === 'guidance' || item.kind === 'user';
}
