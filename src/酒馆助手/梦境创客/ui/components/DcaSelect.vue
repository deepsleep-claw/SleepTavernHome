<template>
  <div ref="root" class="dca-select" :class="{ open }">
    <button
      ref="trigger"
      class="dca-select-trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      :aria-activedescendant="open && activeOption ? optionId(activeOption.value) : undefined"
      :disabled="disabled"
      @click="toggleMenu"
      @keydown="handleKeydown"
    >
      <span :class="{ placeholder: !selectedOption }">{{ selectedOption?.label ?? placeholder }}</span>
      <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
    </button>

    <Teleport to=".dca-app">
      <div
        v-if="open"
        :id="listboxId"
        ref="menu"
        class="dca-select-menu"
        role="listbox"
        :aria-label="ariaLabel"
        :style="menuStyle"
      >
        <button
          v-for="(option, index) in options"
          :id="optionId(option.value)"
          :key="option.value"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="option.value === modelValue"
          :disabled="option.disabled"
          :class="{ active: index === activeIndex, selected: option.value === modelValue }"
          @click="choose(option)"
          @pointerenter="activeIndex = index"
        >
          <span>
            <strong>{{ option.label }}</strong>
            <small v-if="option.description">{{ option.description }}</small>
          </span>
          <i v-if="option.value === modelValue" class="fa-solid fa-check" aria-hidden="true"></i>
        </button>
        <div v-if="options.length === 0" class="dca-select-empty">暂无可用选项</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue';

export type SelectOption = {
  description?: string;
  disabled?: boolean;
  label: string;
  value: string;
};

const props = withDefaults(
  defineProps<{
    ariaLabel?: string;
    disabled?: boolean;
    modelValue: string;
    options: SelectOption[];
    placeholder?: string;
  }>(),
  { ariaLabel: '选择选项', disabled: false, placeholder: '请选择' },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const open = ref(false);
const activeIndex = ref(0);
const menuStyle = ref<CSSProperties>({});
const listboxId = `dca-select-${crypto.randomUUID()}`;

const selectedOption = computed(() => props.options.find(option => option.value === props.modelValue));
const activeOption = computed(() => props.options[activeIndex.value]);

watch(
  () => [props.modelValue, props.options] as const,
  () => {
    const selectedIndex = props.options.findIndex(option => option.value === props.modelValue);
    activeIndex.value = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex();
    if (open.value) void nextTick(syncMenuPosition);
  },
  { immediate: true },
);

function optionId(value: string) {
  return `${listboxId}-${value.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;
}

function firstEnabledIndex() {
  const index = props.options.findIndex(option => !option.disabled);
  return Math.max(0, index);
}

function openMenu() {
  if (props.disabled || open.value) return;
  open.value = true;
  const selectedIndex = props.options.findIndex(option => option.value === props.modelValue && !option.disabled);
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex();
  void nextTick(syncMenuPosition);
}

function closeMenu() {
  open.value = false;
}

function toggleMenu() {
  if (open.value) closeMenu();
  else openMenu();
}

function choose(option: SelectOption) {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  root.value?.dispatchEvent(new Event('change', { bubbles: true }));
  closeMenu();
  trigger.value?.focus();
}

function move(delta: number) {
  if (!open.value) openMenu();
  if (props.options.length === 0) return;
  let index = activeIndex.value;
  for (let step = 0; step < props.options.length; step += 1) {
    index = (index + delta + props.options.length) % props.options.length;
    if (!props.options[index]?.disabled) {
      activeIndex.value = index;
      break;
    }
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    move(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!open.value) openMenu();
    else if (activeOption.value) choose(activeOption.value);
    return;
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    closeMenu();
  }
}

function syncMenuPosition() {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  const viewportPadding = 8;
  const gap = 5;
  const availableBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
  const availableAbove = rect.top - viewportPadding - gap;
  const opensAbove = availableBelow < 150 && availableAbove > availableBelow;
  const maxHeight = Math.max(96, Math.min(240, opensAbove ? availableAbove : availableBelow));
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - viewportPadding * 2);
  const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);
  menuStyle.value = {
    bottom: opensAbove ? `${window.innerHeight - rect.top + gap}px` : 'auto',
    left: `${left}px`,
    maxHeight: `${maxHeight}px`,
    top: opensAbove ? 'auto' : `${rect.bottom + gap}px`,
    width: `${width}px`,
  };
}

function closeFromOutside(event: PointerEvent) {
  const target = event.target as Node;
  if (!root.value?.contains(target) && !menu.value?.contains(target)) closeMenu();
}

document.addEventListener('pointerdown', closeFromOutside);
window.addEventListener('resize', syncMenuPosition);
window.addEventListener('scroll', syncMenuPosition, true);

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeFromOutside);
  window.removeEventListener('resize', syncMenuPosition);
  window.removeEventListener('scroll', syncMenuPosition, true);
});
</script>

<style lang="scss">
.dca-select {
  position: relative;
  min-width: 0;
}

.dca-app button.dca-select-trigger {
  display: flex;
  width: 100%;
  min-height: var(--dca-control-h);
  align-items: center;
  justify-content: space-between;
  border-color: var(--dca-border);
  padding: 0.38rem 0.58rem 0.38rem 0.68rem;
  background: var(--dca-canvas);
  text-align: left;
}

.dca-app button.dca-select-trigger:hover:not(:disabled),
.dca-select.open > .dca-select-trigger {
  border-color: var(--dca-border-strong);
  background: var(--dca-raised);
}

.dca-select.open > .dca-select-trigger {
  border-color: var(--dca-accent);
  box-shadow: 0 0 0 3px var(--dca-accent-soft);
}

.dca-select-trigger > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-select-trigger > span.placeholder {
  color: var(--dca-text-muted);
}

.dca-select-trigger > i {
  flex: 0 0 auto;
  color: var(--dca-text-muted);
  font-size: 0.72rem;
  transition: transform var(--dca-motion-fast) ease;
}

.dca-select.open > .dca-select-trigger > i {
  transform: rotate(180deg);
}

.dca-select-menu {
  position: fixed;
  z-index: 10020;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-md);
  padding: 0.28rem;
  background: var(--dca-raised);
  box-shadow: var(--dca-shadow-2);
}

.dca-app .dca-select-menu > button {
  display: flex;
  width: 100%;
  min-height: 2.2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  border-color: transparent;
  padding: 0.4rem 0.5rem;
  background: transparent;
  text-align: left;
}

.dca-app .dca-select-menu > button:is(.active, :hover):not(:disabled) {
  border-color: transparent;
  background: var(--dca-accent-soft);
}

.dca-app .dca-select-menu > button.selected {
  color: var(--dca-text);
}

.dca-select-menu > button > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dca-select-menu strong {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-select-menu small {
  overflow: hidden;
  color: var(--dca-text-muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dca-select-menu > button > i {
  margin-left: 0.6rem;
  flex: 0 0 auto;
  color: var(--dca-accent);
  font-size: 0.72rem;
}

.dca-select-empty {
  padding: 0.65rem;
  color: var(--dca-text-muted);
  text-align: center;
}
</style>
