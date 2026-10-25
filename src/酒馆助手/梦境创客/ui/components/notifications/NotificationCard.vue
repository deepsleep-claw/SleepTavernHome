<template>
  <article
    class="dca-notification-card"
    :class="[notice.level, { required: notice.required, floating }]"
    :data-notification-id="notice.id"
    @click="collapse"
    @mouseenter="emit('pause')"
    @mouseleave="emit('resume')"
    @focusin="emit('pause')"
    @focusout="leaveFocus"
  >
    <span class="dca-notification-symbol" aria-hidden="true">{{
      notice.level === 'success' ? '✓' : notice.level === 'info' ? 'i' : '!'
    }}</span>
    <div class="dca-notification-copy">
      <header>
        <strong>{{ notice.title }}</strong
        ><span v-if="notice.required" class="dca-notification-required">待处理</span
        ><small v-else-if="notice.resolved && notice.level === 'success'">已完成</small>
      </header>
      <p v-if="notice.message">{{ notice.message }}</p>
      <div v-if="notice.actions?.length" class="dca-notification-actions">
        <button
          v-for="action in notice.actions"
          :key="action.id"
          type="button"
          :disabled="Boolean(notice.busy) || action.disabled"
          @click.stop="emit('action', action.id)"
        >
          {{ notice.busy === action.id ? '处理中…' : action.label }}
        </button>
      </div>
    </div>
    <button
      v-if="floating || !notice.required"
      class="dca-notification-close"
      type="button"
      :disabled="!floating && Boolean(notice.busy)"
      :aria-label="floating ? '收起通知' : '清除此通知'"
      :title="floating ? '收起通知' : '清除此通知'"
      @click.stop="floating ? emit('hide') : emit('dismiss')"
    >
      {{ notice.required ? '⌄' : '×' }}
    </button>
  </article>
</template>
<script setup lang="ts">
import type { WorkspaceNotification } from '../../composables/notifications';
const props = defineProps<{ notice: WorkspaceNotification; floating?: boolean }>();
const emit = defineEmits<{ hide: []; dismiss: []; action: [id: string]; pause: []; resume: [] }>();
function collapse(event: MouseEvent) {
  if (props.floating && !(event.target instanceof Element && event.target.closest('button'))) emit('hide');
}
function leaveFocus(event: FocusEvent) {
  if (
    event.currentTarget instanceof Node &&
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget)
  )
    return;
  emit('resume');
}
</script>
<style lang="scss">
.dca-notification-card {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  gap: 0.6rem;
  min-width: 0;
  border: 1px solid var(--dca-border-strong);
  border-radius: 0.65rem;
  padding: 0.75rem;
  background: var(--dca-surface);
  box-shadow: var(--dca-shadow-2);
}
.dca-notification-card.required {
  border-color: color-mix(in srgb, var(--dca-warning) 48%, var(--dca-border));
}
.dca-notification-symbol {
  display: grid;
  flex: 0 0 1.25rem;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.05rem;
  place-items: center;
  border-radius: 50%;
  background: var(--dca-info-soft);
  color: var(--dca-info);
  font-size: 0.8rem;
  font-weight: 700;
}
.dca-notification-card.warning .dca-notification-symbol {
  background: var(--dca-warning-soft);
  color: var(--dca-warning);
}
.dca-notification-card.error .dca-notification-symbol {
  background: var(--dca-danger-soft);
  color: var(--dca-danger);
}
.dca-notification-card.success .dca-notification-symbol {
  background: var(--dca-success-soft);
  color: var(--dca-success);
}
.dca-notification-copy {
  flex: 1 1 auto;
  min-width: 0;
}
.dca-notification-copy header {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.dca-notification-copy strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.83rem;
  font-weight: 600;
}
.dca-notification-copy p {
  margin: 0.3rem 0 0;
  color: var(--dca-text-secondary);
  font-size: 0.76rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.dca-notification-card.floating p {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dca-notification-copy small {
  color: var(--dca-text-muted);
  font-size: 0.65rem;
}
.dca-notification-required {
  flex: 0 0 auto;
  border-radius: 0.25rem;
  padding: 0.05rem 0.3rem;
  background: var(--dca-warning-soft);
  color: var(--dca-warning);
  font-size: 0.65rem;
}
.dca-notification-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.55rem;
}
.dca-app .dca-notification-actions button {
  min-height: 2rem;
  padding: 0.25rem 0.55rem;
  font-size: 0.74rem;
}
.dca-app .dca-notification-actions button:first-child {
  border-color: var(--dca-border-strong);
  background: var(--dca-raised);
  color: var(--dca-text);
}
.dca-app .dca-notification-close {
  display: grid;
  flex: 0 0 1.7rem;
  width: 1.7rem;
  min-height: 1.7rem;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dca-text-muted);
  font-size: 1.1rem;
}
.dca-app.mobile .dca-notification-card {
  gap: 0.45rem;
  padding: 0.65rem;
}
.dca-app.mobile .dca-notification-actions button {
  min-height: 2.75rem;
}
.dca-app.mobile .dca-notification-close {
  min-height: 2.5rem;
  flex-basis: 2rem;
}
</style>
