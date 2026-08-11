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
        ref="previewRef"
        class="dca-reasoning-preview"
        aria-label="最新思考内容"
      >
        <span>{{ item.content }}</span>
      </span>
    </summary>
    <pre>{{ item.content }}</pre>
  </details>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SessionUiItem } from '../../../../core/session/types';
import { reasoningLabel } from '../../../composables/timeline';

const props = defineProps<{ item: SessionUiItem }>();

const detailsRef = ref<HTMLDetailsElement>();
const expanded = ref(false);
const previewRef = ref<HTMLElement>();
let resizeObserver: ResizeObserver | undefined;

function scrollPreviewToLatest(): void {
  const preview = previewRef.value;
  if (preview) preview.scrollTop = preview.scrollHeight;
}

function handleToggle(): void {
  expanded.value = detailsRef.value?.open ?? false;
  if (!expanded.value) void nextTick(scrollPreviewToLatest);
}

watch(
  () => props.item.content,
  () => void nextTick(scrollPreviewToLatest),
  { flush: 'post' },
);

watch(previewRef, (current, previous) => {
  if (previous) resizeObserver?.unobserve(previous);
  if (current) {
    resizeObserver?.observe(current);
    void nextTick(scrollPreviewToLatest);
  }
});

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scrollPreviewToLatest);
    if (previewRef.value) resizeObserver.observe(previewRef.value);
  }
  scrollPreviewToLatest();
});

onBeforeUnmount(() => resizeObserver?.disconnect());
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
  display: block;
  height: 4.2rem;
  grid-column: 1 / -1;
  justify-self: stretch;
  margin: 0.05rem 0 0;
  padding: 0.15rem 0.15rem 0.05rem 1.32rem;
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.78rem;
  line-height: 1.45;
  mask-image: linear-gradient(to bottom, transparent 0, rgb(0 0 0 / 18%) 20%, #000 58%, #000 100%);
  scrollbar-width: none;
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, rgb(0 0 0 / 18%) 20%, #000 58%, #000 100%);
}

.dca-reasoning-card.running > summary > .dca-reasoning-preview {
  scroll-behavior: smooth;
}

.dca-reasoning-card > summary > .dca-reasoning-preview::-webkit-scrollbar {
  display: none;
}

.dca-reasoning-card > summary > .dca-reasoning-preview::before {
  position: sticky;
  z-index: 1;
  top: 0;
  display: block;
  height: 0.85rem;
  margin-bottom: -0.85rem;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--dca-canvas) 62%, transparent), transparent);
  box-shadow: inset 0 0.45rem 0.55rem -0.55rem rgb(0 0 0 / 75%);
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
