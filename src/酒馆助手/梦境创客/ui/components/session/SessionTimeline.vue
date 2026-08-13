<template>
  <div ref="timelineScroller" class="dca-timeline" @scroll.passive="handleTimelineScroll">
    <div ref="timelineColumn" class="dca-timeline-column">
      <button v-if="hiddenTimelineCount > 0" class="dca-load-more" type="button" @click="timelineLimit += 200">
        再显示较早的 {{ Math.min(200, hiddenTimelineCount) }} 条
      </button>
      <template v-for="block in timelineBlocks" :key="block.id">
        <RunBlock
          v-if="block.type === 'run'"
          :block="block"
          :confirmation="activeToolConfirmation"
          :collapsed="isRunCollapsed(block)"
          @resolve-confirmation="resolveConfirmation"
          @toggle="toggleRunBlock(block)"
        />
        <TimelineMessage v-else :item="block.item" />
      </template>
      <div v-if="visibleTimelineCount === 0" class="dca-empty">告诉 Agent 你想怎样完善这张角色卡吧。</div>
      <FailureCard />
      <OperationDiffCard @open-diff="emit('open-diff', $event)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { ToolConfirmation } from '../../../core/runner/tools';
import { useDreamCardAgent } from '../../composables/runtime';
import type { OperationDiffFocus } from '../../composables/operation-diff';
import { buildTimelineBlocks, defaultRunCollapsed, type RunTimelineBlock } from '../../composables/timeline';
import FailureCard from './timeline/FailureCard.vue';
import OperationDiffCard from './timeline/OperationDiffCard.vue';
import RunBlock from './timeline/RunBlock.vue';
import TimelineMessage from './timeline/TimelineMessage.vue';

const emit = defineEmits<{ 'open-diff': [focus: OperationDiffFocus] }>();

const { runtime, state } = useDreamCardAgent();

const timelineLimit = ref(200);
const runCollapseOverrides = reactive<Record<string, boolean>>({});
const timelineNow = ref(Date.now());
const timelineScroller = ref<HTMLElement>();
const timelineColumn = ref<HTMLElement>();
let timelineClock: ReturnType<typeof setInterval> | undefined;
let timelineResizeObserver: ResizeObserver | undefined;
let timelineFrame: number | undefined;
let previousTimelineHeight = 0;
let followTimelineTail = true;

const TIMELINE_TAIL_THRESHOLD = 32;

const runIsActive = computed(() => ['running', 'waiting-approval'].includes(state.value.active?.status ?? ''));
const activeToolConfirmation = computed<ToolConfirmation | undefined>(() => {
  const confirmation = state.value.toolConfirmation;
  return confirmation?.sessionId === state.value.active?.sessionId ? confirmation : undefined;
});

const timelineBlocks = computed(() =>
  buildTimelineBlocks(state.value.active?.ui ?? [], state.value.active?.status, timelineLimit.value, timelineNow.value),
);
const visibleTimelineCount = computed(() => Math.min(state.value.active?.ui.length ?? 0, timelineLimit.value));
const hiddenTimelineCount = computed(() => Math.max(0, (state.value.active?.ui.length ?? 0) - timelineLimit.value));

watch(
  runIsActive,
  active => {
    timelineNow.value = Date.now();
    if (timelineClock) {
      clearInterval(timelineClock);
      timelineClock = undefined;
    }
    if (active) timelineClock = setInterval(() => (timelineNow.value = Date.now()), 1_000);
  },
  { immediate: true },
);

watch(
  () => state.value.active?.sessionId,
  async () => {
    followTimelineTail = true;
    previousTimelineHeight = 0;
    await nextTick();
    scheduleTimelineTail();
  },
);

onMounted(() => {
  const column = timelineColumn.value;
  if (column && typeof ResizeObserver !== 'undefined') {
    timelineResizeObserver = new ResizeObserver(entries => {
      const nextHeight = entries.at(-1)?.contentRect.height ?? column.getBoundingClientRect().height;
      // 回退会先移除旧分支。若浏览器已把滚动位置夹回新的底部，需要重新恢复贴底状态，
      // 这样随后重发产生的新内容才能继续更新真实可滚动边界。
      if (nextHeight < previousTimelineHeight && isTimelineNearTail()) followTimelineTail = true;
      previousTimelineHeight = nextHeight;
      if (followTimelineTail) scheduleTimelineTail();
    });
    timelineResizeObserver.observe(column);
  }
  scheduleTimelineTail();
});

onBeforeUnmount(() => {
  if (timelineClock) clearInterval(timelineClock);
  timelineResizeObserver?.disconnect();
  if (timelineFrame !== undefined) cancelAnimationFrame(timelineFrame);
});

function isTimelineNearTail(): boolean {
  const scroller = timelineScroller.value;
  if (!scroller) return true;
  return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= TIMELINE_TAIL_THRESHOLD;
}

function handleTimelineScroll() {
  followTimelineTail = isTimelineNearTail();
}

function scheduleTimelineTail() {
  if (!followTimelineTail || !timelineScroller.value) return;
  if (timelineFrame !== undefined) cancelAnimationFrame(timelineFrame);
  timelineFrame = requestAnimationFrame(() => {
    timelineFrame = undefined;
    if (!followTimelineTail || !timelineScroller.value) return;
    timelineScroller.value.scrollTop = timelineScroller.value.scrollHeight;
    // <details> 展开与流式 Vue patch 可能跨越相邻两次布局；第二帧用于读取最终边界。
    timelineFrame = requestAnimationFrame(() => {
      timelineFrame = undefined;
      if (followTimelineTail && timelineScroller.value) {
        timelineScroller.value.scrollTop = timelineScroller.value.scrollHeight;
      }
    });
  });
}

function isRunCollapsed(block: RunTimelineBlock): boolean {
  const activeToolCallId = activeToolConfirmation.value?.toolCallId;
  if (activeToolCallId && block.items.some(item => item.toolCallId === activeToolCallId)) return false;
  return runCollapseOverrides[block.id] ?? defaultRunCollapsed(block);
}

function resolveConfirmation(approved: boolean) {
  runtime.resolveToolConfirmation(approved, activeToolConfirmation.value?.sessionId);
}

function toggleRunBlock(block: RunTimelineBlock) {
  runCollapseOverrides[block.id] = !isRunCollapsed(block);
}
</script>

<style lang="scss">
.dca-timeline {
  flex: 1 1 auto;
  min-height: 10rem;
  overflow: auto;
  overflow-anchor: none;
  padding: 0.75rem 0.75rem 0.35rem;
  scrollbar-gutter: stable;
}

.dca-timeline-column {
  display: flex;
  width: min(52rem, 100%);
  min-height: 100%;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0 auto;
}

.dca-timeline-column > .dca-empty {
  margin: auto;
}

.dca-load-more {
  align-self: center;
}
</style>
