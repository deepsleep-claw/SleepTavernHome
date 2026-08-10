<template>
  <details class="dca-step dca-step-reasoning dca-step-card dca-reasoning-card">
    <summary>
      <i class="fa-solid fa-brain" aria-hidden="true"></i>
      <span class="dca-reasoning-label">{{ reasoningLabel(item) }}</span>
      <span v-if="item.status === 'running'" class="dca-reasoning-preview">{{ reasoningPreview(item.content) }}</span>
      <i class="fa-solid fa-chevron-down dca-details-chevron" aria-hidden="true"></i>
    </summary>
    <pre>{{ item.content }}</pre>
  </details>
</template>

<script setup lang="ts">
import type { SessionUiItem } from '../../../../core/session/types';
import { reasoningLabel, reasoningPreview } from '../../../composables/timeline';

defineProps<{ item: SessionUiItem }>();
</script>

<style lang="scss">
.dca-reasoning-card > summary {
  grid-template-columns: auto auto minmax(0, 1fr) auto;
}

.dca-reasoning-card > summary > i:first-child {
  color: var(--dca-accent);
  font-size: 0.82rem;
}

.dca-reasoning-label {
  color: var(--dca-text);
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
}

.dca-reasoning-preview {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.dca-reasoning-card pre {
  margin: 0;
  border-top: 1px solid var(--dca-border);
  padding: 0.5rem 0.6rem;
  color: var(--dca-text-muted);
  font:
    12px/1.55 var(--dca-font-mono);
}
</style>
