<template>
  <div class="dca-timeline-shell">
    <div
      ref="timelineScroller"
      class="dca-timeline"
      tabindex="0"
      aria-label="会话消息"
      @scroll.passive="scroll.onScroll"
      @wheel.passive="scroll.onWheel"
      @touchstart.passive="scroll.onTouchStart"
      @touchmove.passive="scroll.onTouchMove"
      @touchend.passive="scroll.onTouchEnd"
      @touchcancel.passive="scroll.onTouchEnd"
      @pointerdown="scroll.onPointerDown"
      @keydown.capture="scroll.onKeydown"
    >
      <div ref="timelineColumn" class="dca-timeline-column">
        <button v-if="hiddenTimelineCount > 0" class="dca-load-more" type="button" @click="loadEarlier">
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
    <button v-if="!followTimelineTail" class="dca-jump-latest" type="button" @click="jumpToLatest">
      回到最新 <i class="fa-solid fa-arrow-down"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ToolConfirmation } from '../../../core/runner/tools';
import { useDreamCardAgent } from '../../composables/runtime';
import type { OperationDiffFocus } from '../../composables/operation-diff';
import { buildTimelineBlocks, defaultRunCollapsed, type RunTimelineBlock } from '../../composables/timeline';
import { useTimelineScroll } from '../../composables/timeline-scroll';
import FailureCard from './timeline/FailureCard.vue';
import OperationDiffCard from './timeline/OperationDiffCard.vue';
import RunBlock from './timeline/RunBlock.vue';
import TimelineMessage from './timeline/TimelineMessage.vue';

const emit = defineEmits<{ 'open-diff': [focus: OperationDiffFocus] }>();

const { runtime, state } = useDreamCardAgent();

const timelineLimit = ref(200);
const runCollapseOverrides = ref<Record<string, boolean>>({});
const timelineNow = ref(Date.now());
const timelineScroller = ref<HTMLElement>();
const timelineColumn = ref<HTMLElement>();
let timelineClock: ReturnType<typeof setInterval> | undefined;
const scroll = useTimelineScroll({
  owner: runtime,
  key: () => (state.value.active ? JSON.stringify([state.value.active.bindingId, state.value.active.sessionId]) : ''),
  itemCount: () => state.value.active?.ui.length ?? 0,
  scroller: timelineScroller,
  column: timelineColumn,
  limit: timelineLimit,
  collapsedRuns: runCollapseOverrides,
});
const { following: followTimelineTail, jumpToLatest, loadEarlier } = scroll;

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

onBeforeUnmount(() => {
  if (timelineClock) clearInterval(timelineClock);
});

function isRunCollapsed(block: RunTimelineBlock): boolean {
  const activeToolCallId = activeToolConfirmation.value?.toolCallId;
  if (activeToolCallId && block.items.some(item => item.toolCallId === activeToolCallId)) return false;
  return runCollapseOverrides.value[block.id] ?? defaultRunCollapsed(block);
}

function resolveConfirmation(approved: boolean) {
  runtime.resolveToolConfirmation(approved, activeToolConfirmation.value?.sessionId);
}

function toggleRunBlock(block: RunTimelineBlock) {
  runCollapseOverrides.value[block.id] = !isRunCollapsed(block);
}
</script>

<style lang="scss">
.dca-timeline-shell {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.dca-jump-latest {
  position: absolute;
  bottom: 0.6rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3;
}
.dca-timeline {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  padding: 0.6rem 0.65rem 0.3rem;
  scrollbar-gutter: stable;
}

.dca-timeline-column {
  display: flex;
  width: min(52rem, 100%);
  min-height: 100%;
  flex-direction: column;
  gap: 0.45rem;
  margin: 0 auto;
}

.dca-timeline-column > .dca-empty {
  margin: auto;
}

.dca-load-more {
  align-self: center;
}

@media (max-width: 720px) {
  .dca-timeline {
    padding: 0.45rem 0.5rem 0.25rem;
  }
}
</style>
