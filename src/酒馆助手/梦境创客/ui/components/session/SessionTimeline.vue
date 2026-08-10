<template>
  <div class="dca-timeline">
    <div class="dca-timeline-column">
      <button v-if="hiddenTimelineCount > 0" class="dca-load-more" type="button" @click="timelineLimit += 200">
        再显示较早的 {{ Math.min(200, hiddenTimelineCount) }} 条
      </button>
      <template v-for="block in timelineBlocks" :key="block.id">
        <RunBlock
          v-if="block.type === 'run'"
          :block="block"
          :collapsed="isRunCollapsed(block)"
          @toggle="toggleRunBlock(block)"
        />
        <TimelineMessage v-else :item="block.item" />
      </template>
      <div v-if="visibleTimelineCount === 0" class="dca-empty">告诉 Agent 你想怎样完善这张角色卡吧。</div>
      <FailureCard />
      <ToolConfirmationCard />
      <ApprovalCard @open-diff="emit('open-diff')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';
import { buildTimelineBlocks, defaultRunCollapsed, type RunTimelineBlock } from '../../composables/timeline';
import ApprovalCard from './timeline/ApprovalCard.vue';
import FailureCard from './timeline/FailureCard.vue';
import RunBlock from './timeline/RunBlock.vue';
import TimelineMessage from './timeline/TimelineMessage.vue';
import ToolConfirmationCard from './timeline/ToolConfirmationCard.vue';

const emit = defineEmits<{ 'open-diff': [] }>();

const { state } = useDreamCardAgent();

const timelineLimit = ref(200);
const runCollapseOverrides = reactive<Record<string, boolean>>({});

const timelineBlocks = computed(() =>
  buildTimelineBlocks(state.value.active?.ui ?? [], state.value.active?.status, timelineLimit.value),
);
const visibleTimelineCount = computed(() => Math.min(state.value.active?.ui.length ?? 0, timelineLimit.value));
const hiddenTimelineCount = computed(() => Math.max(0, (state.value.active?.ui.length ?? 0) - timelineLimit.value));

function isRunCollapsed(block: RunTimelineBlock): boolean {
  return runCollapseOverrides[block.id] ?? defaultRunCollapsed(block);
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
  padding: 0.75rem 0.75rem 0.35rem;
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
