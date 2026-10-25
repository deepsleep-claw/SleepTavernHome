<template>
  <div ref="layer" class="dca-notification-layer" :style="layout">
    <section
      v-if="open"
      id="dca-notification-center"
      ref="panel"
      class="dca-notification-panel"
      role="dialog"
      aria-label="通知中心"
      tabindex="-1"
      @keydown.esc.stop.prevent="closePanel(true)"
    >
      <header class="dca-notification-panel-header">
        <strong>通知</strong><small v-if="requiredCount">{{ requiredCount }} 待处理</small><span></span
        ><button
          type="button"
          :disabled="!entries.some(item => !item.required && !item.busy)"
          title="清除可关闭消息"
          @click="notifications.clear()"
        >
          清除</button
        ><button type="button" aria-label="收起通知中心" @click="closePanel(true)">⌄</button>
      </header>
      <div class="dca-notification-list">
        <NotificationCard
          v-for="notice in ordered"
          :key="notice.id"
          :notice="notice"
          @dismiss="notifications.dismiss(notice.id)"
          @action="notifications.run(notice.id, $event)"
        />
        <p v-if="!entries.length" class="dca-notification-empty">暂无通知</p>
      </div>
    </section>
    <div v-else class="dca-notification-toasts" role="log" aria-live="polite" aria-label="新通知">
      <NotificationCard
        v-for="notice in floating"
        :key="notice.id"
        :notice="notice"
        floating
        @hide="notifications.hide(notice.id)"
        @action="notifications.run(notice.id, $event)"
        @pause="notifications.pause(notice.id)"
        @resume="notifications.resume(notice.id)"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';
import NotificationCard from './NotificationCard.vue';
const { notifications, isMobile, workspaceView, state } = useDreamCardAgent();
const { entries, open, requiredCount } = notifications;
const layer = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const layout = ref<Record<string, string>>({});
const ordered = computed(() =>
  [...entries.value].sort(
    (a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)) || b.createdAt - a.createdAt,
  ),
);
const floating = computed(() => ordered.value.filter(item => item.floating).slice(0, isMobile.value ? 2 : 3));
let observer: ResizeObserver | undefined;
function measure() {
  const surface = layer.value?.parentElement;
  if (!surface || surface.clientHeight <= 0) return;
  const bounds = surface.getBoundingClientRect();
  const tabs = surface.querySelector('.dca-tabs')?.getBoundingClientRect();
  const composer = surface.querySelector('.dca-composer')?.getBoundingClientRect();
  const top = (tabs ? tabs.bottom - bounds.top : 40) + 6;
  const bottom = composer ? bounds.bottom - composer.top + 8 : isMobile.value ? 8 : 38;
  const available = Math.max(70, bounds.height - top - bottom);
  layout.value = {
    '--dca-notification-top': `${top}px`,
    '--dca-notification-bottom': `${bottom}px`,
    '--dca-notification-height': `${available}px`,
  };
}
async function observeLayout() {
  await nextTick();
  observer?.disconnect();
  const surface = layer.value?.parentElement;
  if (surface) {
    observer?.observe(surface);
    for (const element of surface.querySelectorAll('.dca-tabs,.dca-composer')) observer?.observe(element);
  }
  measure();
}
function closePanel(focus = false) {
  notifications.close();
  if (focus) layer.value?.parentElement?.querySelector<HTMLButtonElement>('[data-notification-trigger]')?.focus();
}
function outside(event: PointerEvent) {
  if (
    !open.value ||
    !(event.target instanceof Element) ||
    event.target.closest('[data-notification-trigger]') ||
    panel.value?.contains(event.target)
  )
    return;
  closePanel();
}
watch(open, async value => {
  if (value) {
    await nextTick();
    panel.value?.focus();
  }
});
watch(
  [isMobile, workspaceView, () => state.value.active?.sessionId, () => state.value.activeSessionAccess],
  observeLayout,
);
onMounted(() => {
  observer = new ResizeObserver(measure);
  void observeLayout();
  document.addEventListener('pointerdown', outside);
  window.visualViewport?.addEventListener('resize', measure);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('pointerdown', outside);
  window.visualViewport?.removeEventListener('resize', measure);
});
</script>
<style lang="scss">
.dca-notification-layer {
  position: absolute;
  z-index: 10010;
  inset: 0;
  min-width: 0;
  min-height: 0;
  pointer-events: none;
}
.dca-notification-toasts,
.dca-notification-panel {
  position: absolute;
  right: 0.75rem;
  bottom: var(--dca-notification-bottom, 2.4rem);
  width: min(25rem, calc(100% - 1.5rem));
  max-height: var(--dca-notification-height, calc(100% - 5rem));
  pointer-events: auto;
}
.dca-notification-toasts {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  overflow: hidden auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  scrollbar-width: thin;
}
.dca-notification-toasts:empty {
  display: none;
}
.dca-notification-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--dca-border-strong);
  border-radius: 0.75rem;
  background: var(--dca-surface);
  box-shadow: var(--dca-shadow-3);
  overflow: hidden;
  outline: none;
}
.dca-notification-panel-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.65rem;
  border-bottom: 1px solid var(--dca-border);
}
.dca-notification-panel-header > strong {
  font-size: 0.88rem;
}
.dca-notification-panel-header > span {
  flex: 1;
}
.dca-notification-panel-header > small {
  font-size: 0.7rem;
  color: var(--dca-warning);
}
.dca-app .dca-notification-panel-header button {
  min-height: 2rem;
  border: 0;
  padding: 0.25rem 0.4rem;
  background: transparent;
  color: var(--dca-text-secondary);
  font-size: 0.75rem;
}
.dca-notification-list {
  min-height: 0;
  max-height: 29rem;
  padding: 0.4rem;
  overflow: hidden auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
}
.dca-notification-list .dca-notification-card {
  border-radius: 0.45rem;
  box-shadow: none;
  margin-bottom: 0.35rem;
}
.dca-notification-list .dca-notification-card:last-child {
  margin-bottom: 0;
}
.dca-notification-empty {
  margin: 0;
  padding: 1.3rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--dca-text-muted);
}
.dca-app.mobile .dca-notification-toasts,
.dca-app.mobile .dca-notification-panel {
  top: var(--dca-notification-top, 2.9rem);
  bottom: auto;
  right: 0.5rem;
  width: calc(100% - 1rem);
}
.dca-app.mobile .dca-notification-panel-header button {
  min-height: 2.75rem;
  min-width: 2.5rem;
}
</style>
