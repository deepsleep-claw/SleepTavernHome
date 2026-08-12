<template>
  <details
    class="dca-step dca-step-tools dca-step-card dca-tool-group"
    :class="{ 'awaiting-confirmation': hasPendingConfirmation, 'has-failure': toolGroupHasFailure(items), running: hasRunning }"
    :open="hasRunning || hasPendingConfirmation || toolGroupHasFailure(items)"
  >
    <summary>
      <i class="fa-solid fa-terminal" aria-hidden="true"></i>
      <span>{{ toolGroupLabel(items) }}</span>
      <small>{{ toolGroupSummary(items) }}</small>
      <i class="fa-solid fa-chevron-down dca-details-chevron" aria-hidden="true"></i>
    </summary>
    <div class="dca-tool-expanded">
      <div class="dca-tool-track" aria-label="工具执行轨迹">
        <template v-for="(tool, index) in items" :key="`track:${tool.id}`">
          <i v-if="index > 0" class="fa-solid fa-chevron-right dca-tool-track-arrow" aria-hidden="true"></i>
          <span class="dca-tool-track-item" :class="`dca-tool-track-${tool.status ?? 'completed'}`">
            <i :class="toolTrackIcon(tool)" aria-hidden="true"></i>
            <span>{{ toolDisplayTitle(tool) }}</span>
            <small>{{ toolStatusLabel(tool.status, tool.toolPhase) }}</small>
          </span>
        </template>
      </div>
      <div class="dca-tool-list">
        <ToolResultCard
          v-for="tool in items"
          :key="tool.id"
          :confirmation="confirmationFor(tool)"
          :tool="tool"
          @resolve-confirmation="emit('resolve-confirmation', $event)"
        />
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ToolConfirmation } from '../../../../core/runner/tools';
import type { SessionUiItem } from '../../../../core/session/types';
import { toolDisplayTitle } from '../../../composables/tool-presentation';
import { toolGroupHasFailure, toolGroupLabel, toolGroupSummary, toolStatusLabel } from '../../../composables/timeline';
import ToolResultCard from './ToolResultCard.vue';

const props = defineProps<{ confirmation?: ToolConfirmation; items: SessionUiItem[] }>();
const emit = defineEmits<{ 'resolve-confirmation': [approved: boolean] }>();

const hasRunning = computed(() => props.items.some(item => item.status === 'running'));
const hasPendingConfirmation = computed(() =>
  props.items.some(item => item.toolCallId === props.confirmation?.toolCallId),
);

function confirmationFor(tool: SessionUiItem): ToolConfirmation | undefined {
  return tool.toolCallId === props.confirmation?.toolCallId ? props.confirmation : undefined;
}

function toolTrackIcon(tool: SessionUiItem): string {
  if (tool.status === 'running') return 'fa-solid fa-spinner fa-spin';
  if (tool.status === 'failed') return 'fa-solid fa-circle-xmark';
  return 'fa-solid fa-circle-check';
}
</script>

<style lang="scss">
.dca-tool-group > summary > i:first-child {
  color: var(--dca-text-muted);
  font-size: 0.82rem;
}

.dca-tool-group > summary > span {
  color: var(--dca-text);
  font-size: 0.86rem;
  font-weight: 600;
}

.dca-step-tools.has-failure > summary > span {
  color: var(--dca-danger);
}

.dca-step-tools.awaiting-confirmation > summary > span {
  color: var(--dca-warning);
}

.dca-tool-group > summary > small {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-tool-expanded {
  border-top: 1px solid var(--dca-border);
  padding: 0.45rem 0.5rem 0.5rem;
}

.dca-tool-track {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.3rem;
  margin-bottom: 0.45rem;
  padding-bottom: 0.12rem;
  overflow-x: auto;
  scrollbar-width: thin;
}

.dca-tool-track-item {
  display: inline-flex;
  min-height: 1.65rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--dca-border);
  border-radius: 999px;
  padding: 0.15rem 0.45rem;
  background: var(--dca-canvas);
  color: var(--dca-text-secondary);
  font-size: 0.7rem;
  white-space: nowrap;
}

.dca-tool-track-item > i {
  color: var(--dca-success);
  font-size: 0.65rem;
}

.dca-tool-track-item small {
  color: var(--dca-text-muted);
  font-size: 0.62rem;
}

.dca-tool-track-arrow {
  flex: 0 0 auto;
  color: var(--dca-text-muted);
  font-size: 0.55rem;
}

.dca-tool-track-failed > i {
  color: var(--dca-danger);
}

.dca-tool-track-running > i {
  color: var(--dca-info);
}

.dca-tool-list {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 31rem), 1fr));
  align-items: start;
  gap: 0.45rem;
}
</style>
