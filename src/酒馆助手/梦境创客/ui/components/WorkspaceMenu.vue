<template>
  <span ref="anchor" hidden></span>
  <Teleport :to="target || 'body'" :disabled="(!mobile && !teleport && !modal) || !target">
    <div
      v-if="open"
      :class="mobile ? 'dca-sheet-layer' : modal ? backdropClass : undefined"
      :style="mobile ? viewportStyle : undefined"
      @pointerdown.self="emit('close')"
    >
      <div
        v-if="mobile || !modal"
        :class="mobile ? 'dca-sheet-scrim' : backdropClass"
        role="presentation"
        @pointerdown.stop="emit('close')"
      ></div>
      <section
        ref="panel"
        :class="mobile ? ['dca-mobile-sheet', panelClass] : panelClass"
        :style="mobile ? undefined : panelStyle"
        role="dialog"
        :aria-modal="mobile || modal"
        :aria-label="title"
        tabindex="-1"
        @keydown="keydown"
        @pointerdown.stop
        @click.stop
      >
        <header v-if="mobile" class="dca-sheet-header">
          <button v-if="canBack" type="button" aria-label="返回上一级" @click="emit('back')">‹</button>
          <strong>{{ title }}</strong>
          <button type="button" :aria-label="`关闭${title}`" @click="emit('close')">×</button>
        </header>
        <div v-if="mobile" class="dca-sheet-body"><slot /></div>
        <slot v-else />
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue';
import { useBackLayer, useWorkspaceNavigation } from '../composables/workspace-navigation';
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    canBack?: boolean;
    teleport?: boolean;
    panelClass?: string;
    backdropClass?: string;
    panelStyle?: CSSProperties;
  }>(),
  { panelClass: '', backdropClass: 'dca-menu-scrim', panelStyle: undefined },
);
const emit = defineEmits<{ close: []; back: [] }>();
const navigation = useWorkspaceNavigation();
const mobile = computed(() => navigation?.isMobile.value ?? false);
const modal = computed(() => props.backdropClass === 'dca-modal-backdrop');
const panel = ref<HTMLElement>();
const anchor = ref<HTMLElement>();
const target = ref<HTMLElement>();
const viewportStyle = ref<CSSProperties>({});
let restoreFocus: HTMLElement | undefined;
let restoreInert: (() => void) | undefined;
let observer: ResizeObserver | undefined;
let generation = 0;
const back = () => (props.canBack ? emit('back') : emit('close'));
useBackLayer(
  computed(() => props.open),
  back,
);
function measure() {
  if (!target.value || !mobile.value) return;
  const bounds = target.value.getBoundingClientRect();
  const viewport = window.visualViewport;
  const top = Math.max(bounds.top, viewport?.offsetTop ?? 0);
  const bottom = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
  viewportStyle.value = { top: `${top - bounds.top}px`, height: `${Math.max(0, bottom - top)}px`, bottom: 'auto' };
}
function release() {
  restoreInert?.();
  restoreInert = undefined;
  if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
  restoreFocus = undefined;
}
watch(
  [() => props.open, mobile],
  async ([open]) => {
    const revision = ++generation;
    release();
    if (!open) return;
    const focused = document.activeElement;
    restoreFocus = focused instanceof HTMLElement ? focused : undefined;
    await nextTick();
    if (revision !== generation || !panel.value) return;
    measure();
    if ((mobile.value || modal.value) && target.value) {
      const siblings = [...target.value.children].filter(
        item => item instanceof HTMLElement && !item.contains(panel.value!),
      ) as HTMLElement[];
      const previous = siblings.map(item => item.inert);
      siblings.forEach(item => {
        item.inert = true;
      });
      restoreInert = () =>
        siblings.forEach((item, index) => {
          item.inert = previous[index];
        });
      panel.value.focus({ preventScroll: true });
    }
  },
  { flush: 'post', immediate: true },
);
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    back();
  }
  if (event.key !== 'Tab' || (!mobile.value && !modal.value)) return;
  const buttons = [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
    ) ?? []),
  ].filter(item => item.getClientRects().length);
  const first = buttons[0];
  const last = buttons.at(-1);
  if (!first) {
    event.preventDefault();
    panel.value?.focus();
  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(() => {
  target.value = anchor.value?.closest<HTMLElement>('.dca-app') ?? undefined;
  observer = new ResizeObserver(measure);
  if (target.value) observer.observe(target.value);
  window.visualViewport?.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('scroll', measure);
});
onBeforeUnmount(() => {
  generation++;
  release();
  observer?.disconnect();
  window.visualViewport?.removeEventListener('resize', measure);
  window.visualViewport?.removeEventListener('scroll', measure);
});
</script>
<style lang="scss">
.dca-menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 10000;
}
.dca-sheet-layer {
  position: absolute;
  inset: 0;
  z-index: 11000;
  display: flex;
  align-items: flex-end;
  min-height: 0;
}
.dca-sheet-scrim {
  position: absolute;
  inset: 0;
  background: var(--dca-scrim);
}
.dca-app .dca-mobile-sheet {
  position: relative;
  inset: auto;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: calc(100% - 0.5rem);
  min-height: 0;
  margin: 0;
  border: 1px solid var(--dca-border-strong);
  border-bottom: 0;
  border-radius: 1rem 1rem 0 0;
  padding: 0 0 env(safe-area-inset-bottom);
  background: var(--dca-surface);
  box-shadow: var(--dca-shadow-3);
  outline: none;
  overflow: hidden;
  transform: none;
  transition: none;
}
.dca-sheet-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.4rem;
  border-bottom: 1px solid var(--dca-border);
  padding: 0.15rem 0.5rem;
}
.dca-sheet-header strong {
  min-width: 0;
  flex: 1;
  font-size: 0.9rem;
}
.dca-app .dca-sheet-header button {
  flex: 0 0 2.75rem;
  min-height: 2.75rem;
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 1.35rem;
}
.dca-sheet-body {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  padding: 0.5rem;
}
.dca-app .dca-sheet-body button {
  min-height: 2.75rem;
}
</style>
