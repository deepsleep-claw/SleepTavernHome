<template>
  <details
    ref="detailsRef"
    class="dca-step dca-step-reasoning dca-step-card dca-reasoning-card"
    :class="{ running: item.status === 'running' }"
    @toggle="handleToggle"
  >
    <summary>
      <i class="fa-solid fa-brain" aria-hidden="true"></i>
      <span class="dca-reasoning-label">{{ reasoningLabel(item) }}</span>
      <i class="fa-solid fa-chevron-down dca-details-chevron" aria-hidden="true"></i>
      <span
        v-if="!expanded && item.status === 'running' && item.content"
        class="dca-reasoning-preview"
        aria-label="最新思考内容"
      >
        <span class="dca-reasoning-preview-content">{{ item.content }}</span>
      </span>
    </summary>
    <pre>{{ item.content }}</pre>
  </details>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { SessionUiItem } from '../../../../core/session/types';
import { reasoningLabel } from '../../../composables/timeline';

defineProps<{ item: SessionUiItem }>();

const detailsRef = ref<HTMLDetailsElement>();
const expanded = ref(false);

function handleToggle(): void {
  expanded.value = detailsRef.value?.open ?? false;
}
</script>

<style lang="scss">
.dca-reasoning-card > summary {
  grid-template-columns: auto minmax(0, 1fr) auto;
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

.dca-reasoning-card > summary > .dca-details-chevron {
  justify-self: end;
}

.dca-step-card.dca-reasoning-card > summary > .dca-reasoning-preview {
  position: relative;
  display: flex;
  height: 4.2rem;
  flex-direction: column;
  justify-content: flex-end;
  grid-column: 1 / -1;
  justify-self: stretch;
  margin: 0.05rem 0 0;
  padding: 0.15rem 0.15rem 0.05rem 1.32rem;
  // 预览只展示末尾，由外层时间线接收触摸滚动。
  overflow: clip;
  color: var(--dca-text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    var(--dca-mask-soft) 20%,
    var(--dca-mask-opaque) 58%,
    var(--dca-mask-opaque) 100%
  );
  scrollbar-width: none;
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    var(--dca-mask-soft) 20%,
    var(--dca-mask-opaque) 58%,
    var(--dca-mask-opaque) 100%
  );
}

.dca-reasoning-preview-content {
  display: flex;
  flex: 0 0 auto;
  min-height: 100%;
  flex-direction: column;
  justify-content: flex-end;
}

.dca-reasoning-card > summary > .dca-reasoning-preview::-webkit-scrollbar {
  display: none;
}

.dca-reasoning-card > summary > .dca-reasoning-preview::before {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 0;
  left: 0;
  display: block;
  height: 0.85rem;
  margin-bottom: -0.85rem;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--dca-canvas) 62%, transparent), transparent);
  box-shadow: inset 0 0.45rem 0.55rem -0.55rem color-mix(in srgb, var(--dca-shadow-color) 75%, transparent);
  content: '';
  pointer-events: none;
}

.dca-reasoning-card pre {
  margin: 0;
  border-top: 1px solid var(--dca-border);
  padding: 0.5rem 0.6rem;
  color: var(--dca-text-muted);
  font: 12px/1.55 var(--dca-font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
