<template>
  <button
    data-notification-trigger
    class="dca-notification-trigger"
    type="button"
    :class="{ pending: requiredCount > 0 }"
    :aria-label="label"
    :aria-expanded="open"
    aria-controls="dca-notification-center"
    title="通知中心"
    @click="toggle"
  >
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
      <path d="M10 21h4" />
    </svg>
    <span v-if="!isMobile">通知</span><small v-if="count">{{ count > 99 ? '99+' : count }}</small>
  </button>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useDreamCardAgent } from '../../composables/runtime';
const { notifications, isMobile, mobileSurface } = useDreamCardAgent();
const { open, requiredCount, unreadCount } = notifications;
const count = computed(() => requiredCount.value || unreadCount.value);
const label = computed(
  () =>
    `通知中心${requiredCount.value ? `，${requiredCount.value} 条待处理` : unreadCount.value ? `，${unreadCount.value} 条未读` : ''}`,
);
function toggle() {
  if (open.value) notifications.close();
  else {
    if (isMobile.value) mobileSurface.value = 'workspace';
    notifications.show();
  }
}
</script>
<style lang="scss">
.dca-app .dca-notification-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 0;
  padding: 0.2rem 0.5rem;
  background: transparent;
  color: var(--dca-text-muted);
  font-size: 0.74rem;
}
.dca-app .dca-notification-trigger:hover,
.dca-app .dca-notification-trigger[aria-expanded='true'] {
  background: var(--dca-accent-soft);
  color: var(--dca-text);
}
.dca-notification-trigger small {
  min-width: 1.1rem;
  padding: 0 0.25rem;
  border-radius: 1rem;
  background: var(--dca-raised);
  color: var(--dca-text);
  text-align: center;
  line-height: 1.1rem;
}
.dca-notification-trigger.pending small {
  background: var(--dca-warning);
  color: var(--dca-canvas);
}
.dca-app.mobile .dca-notification-trigger {
  min-width: 2.75rem;
  min-height: 2.5rem;
  position: relative;
}
.dca-app.mobile .dca-notification-trigger small {
  position: absolute;
  top: 0.05rem;
  right: 0.05rem;
  font-size: 0.65rem;
}
</style>
