<template>
  <details
    class="dca-step dca-step-tools dca-step-card dca-tool-group"
    :class="{ 'has-failure': toolGroupHasFailure(items), running: hasRunning }"
    :open="toolGroupHasFailure(items)"
  >
    <summary>
      <i class="fa-solid fa-terminal" aria-hidden="true"></i>
      <span>{{ toolGroupLabel(items) }}</span>
      <small>{{ toolGroupSummary(items) }}</small>
      <i class="fa-solid fa-chevron-down dca-details-chevron" aria-hidden="true"></i>
    </summary>
    <div class="dca-tool-list">
      <details v-for="tool in items" :key="tool.id" class="dca-tool-row" :open="tool.status === 'failed'">
        <summary>
          <i class="dca-tool-dot" :class="`dca-tool-dot-${tool.status ?? 'completed'}`" aria-hidden="true"></i>
          <span>{{ tool.toolName }}</span>
          <small :class="`dca-tool-${tool.status}`">{{ toolStatusLabel(tool.status) }}</small>
          <i class="fa-solid fa-chevron-down dca-details-chevron" aria-hidden="true"></i>
        </summary>
        <pre>{{ tool.content }}</pre>
      </details>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { SessionUiItem } from '../../../../core/session/types';
import { toolGroupHasFailure, toolGroupLabel, toolGroupSummary, toolStatusLabel } from '../../../composables/timeline';

const props = defineProps<{ items: SessionUiItem[] }>();

const hasRunning = computed(() => props.items.some(item => item.status === 'running'));
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
  color: #f2a3b3;
}

.dca-tool-group > summary > small {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-tool-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  border-top: 1px solid var(--dca-border);
  padding: 0.4rem 0.5rem 0.5rem;
}

.dca-tool-row {
  border: 1px solid var(--dca-border);
  border-radius: 0;
  background: var(--dca-surface);
}

.dca-tool-row > summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.5rem;
}

.dca-tool-row > summary:hover {
  background: var(--dca-raised);
}

.dca-tool-dot {
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: var(--dca-success);
}

.dca-tool-dot-failed {
  background: var(--dca-danger);
}

.dca-tool-dot-running {
  animation: dca-pulse 1.2s ease-in-out infinite;
  background: var(--dca-info);
}

.dca-tool-row > summary span {
  overflow: hidden;
  color: var(--dca-text);
  font-family: var(--dca-font-mono);
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-tool-row > summary small {
  font-size: 0.74rem;
}

.dca-tool-row pre {
  margin: 0;
  border-top: 1px solid var(--dca-border);
  padding: 0.5rem;
  color: var(--dca-text-secondary);
  font-size: 0.8rem;
}

.dca-tool-failed {
  color: #f2a3b3;
}

.dca-tool-running {
  color: var(--dca-info);
}
</style>
