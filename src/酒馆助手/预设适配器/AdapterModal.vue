<template>
  <Teleport :to="target ?? 'body'" :disabled="!target">
    <div ref="root" class="pa-modal-backdrop" @pointerdown.self="close" @keydown="onKeydown">
      <section
        class="pa-modal-panel"
        :class="{ 'pa-modal-wide': wide }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="pa-modal-header">
          <h3>{{ title }}</h3>
          <button type="button" aria-label="关闭" :disabled="busy" @click="close">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </header>
        <div class="pa-modal-body"><slot /></div>
        <footer v-if="$slots.footer" class="pa-modal-footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps<{ title: string; busy?: boolean; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLElement>();
const target = ref<HTMLElement>();
let previous_focus: HTMLElement | null = null;
function close() {
  if (!props.busy) emit('close');
}
function focusable(): HTMLElement[] {
  return [
    ...(root.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]',
    ) ?? []),
  ];
}
function onKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
  if (event.key !== 'Tab') return;
  const elements = focusable();
  const active = root.value?.ownerDocument.activeElement;
  const first = elements[0];
  const last = elements.at(-1);
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last?.focus();
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first?.focus();
  }
}
onMounted(async () => {
  previous_focus = root.value?.ownerDocument.activeElement as HTMLElement | null;
  target.value = root.value?.closest<HTMLElement>('.preset-adapter-floating-window') ?? undefined;
  await nextTick();
  (root.value?.querySelector<HTMLElement>('[autofocus]') ?? focusable()[0])?.focus();
});
onBeforeUnmount(() => {
  if (previous_focus?.isConnected) previous_focus.focus();
});
</script>

<style>
.pa-modal-backdrop {
  position: absolute;
  inset: 0;
  z-index: 4300;
  display: grid;
  place-items: center;
  padding: 0.7rem;
  background: rgb(0 0 0 / 48%);
}
.pa-modal-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(100%, 30rem);
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--pa-border-strong);
  border-radius: var(--pa-card-radius, 12px);
  background: var(--pa-ink);
  color: var(--pa-text);
  box-shadow: 0 1rem 3rem var(--pa-shadow);
}
.pa-modal-panel.pa-modal-wide {
  width: min(100%, 48rem);
}
.pa-modal-panel .pa-modal-header,
.pa-modal-panel .pa-modal-footer {
  display: flex;
  flex-wrap: wrap;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--pa-surface-soft);
}
.pa-modal-panel .pa-modal-header {
  justify-content: space-between;
  border-bottom: 1px solid var(--pa-border);
}
.pa-modal-panel .pa-modal-header h3 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 1rem;
  overflow-wrap: anywhere;
}
.pa-modal-panel .pa-modal-footer {
  justify-content: flex-end;
  border-top: 1px solid var(--pa-border);
}
.pa-modal-panel .pa-modal-body {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0.8rem;
}
.pa-modal-panel p {
  margin: 0 0 0.6rem;
  overflow-wrap: anywhere;
}
.pa-modal-panel ul {
  margin: 0.5rem 0;
  padding-left: 1.3rem;
  overflow-wrap: anywhere;
}
.pa-modal-panel button,
.pa-modal-panel input:not([type='checkbox']),
.pa-modal-panel select {
  box-sizing: border-box;
  min-height: 2.2rem;
  border: 1px solid var(--pa-border);
  border-radius: var(--pa-control-radius, 8px);
  padding: 0.4rem 0.65rem;
  background: var(--pa-surface-soft);
  color: var(--pa-text);
  font: inherit;
}
.pa-modal-panel button {
  cursor: pointer;
}
.pa-modal-panel button:hover {
  border-color: var(--pa-gold);
  background: var(--pa-surface-raised);
}
.pa-modal-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.pa-modal-panel :is(button, input, select, summary):focus-visible {
  outline: 2px solid var(--pa-gold);
  outline-offset: 2px;
}
.pa-modal-panel .pa-modal-primary {
  border-color: var(--pa-gold);
  background: var(--pa-highlight-soft);
  color: var(--pa-highlight-text);
}
.pa-modal-panel .pa-modal-input {
  width: 100%;
  margin-top: 0.4rem;
}
.pa-modal-panel .pa-modal-error {
  margin-top: 0.5rem;
  color: var(--pa-accent-text);
}
.pa-modal-panel input[type='checkbox'] {
  width: 1.1rem;
  height: 1.1rem;
  margin: 0;
  accent-color: var(--pa-gold);
  flex: 0 0 auto;
}
</style>
