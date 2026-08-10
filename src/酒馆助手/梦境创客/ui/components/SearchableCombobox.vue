<template>
  <div ref="root" class="dca-combobox" :class="{ open }">
    <div class="dca-combobox-control">
      <input
        :value="query"
        type="text"
        :placeholder="placeholder"
        role="combobox"
        :aria-expanded="open"
        :aria-controls="listboxId"
        @focus="openMenu"
        @input="updateQuery"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="chooseHighlighted"
        @keydown.esc.prevent="closeMenu"
      />
      <button type="button" tabindex="-1" :aria-label="open ? '收起选项' : '展开选项'" @click="toggleMenu">
        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
      </button>
    </div>
    <div v-if="open" :id="listboxId" class="dca-combobox-menu" role="listbox">
      <button
        v-for="(option, index) in filteredOptions"
        :key="option.value"
        type="button"
        role="option"
        :aria-selected="option.value === modelValue"
        :class="{ active: index === highlighted, selected: option.value === modelValue }"
        @mousedown.prevent="choose(option)"
        @mousemove="highlighted = index"
      >
        <strong>{{ option.label }}</strong>
        <small v-if="option.description">{{ option.description }}</small>
      </button>
      <div v-if="filteredOptions.length === 0" class="dca-combobox-empty">没有匹配选项</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

export type ComboboxOption = { description?: string; label: string; value: string };

const props = withDefaults(
  defineProps<{
    freeInput?: boolean;
    modelValue: string;
    options: ComboboxOption[];
    placeholder?: string;
  }>(),
  { freeInput: false, placeholder: '' },
);
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const root = ref<HTMLElement>();
const open = ref(false);
const highlighted = ref(0);
const query = ref('');
const listboxId = `dca-combobox-${crypto.randomUUID()}`;

const selected = computed(() => props.options.find(option => option.value === props.modelValue));
const filteredOptions = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (!needle || (selected.value && query.value === selected.value.label)) return props.options.slice(0, 100);
  return props.options
    .filter(option => `${option.label}\n${option.value}\n${option.description ?? ''}`.toLocaleLowerCase().includes(needle))
    .slice(0, 100);
});

watch(
  [() => props.modelValue, () => props.options],
  () => {
    if (!open.value || !props.freeInput) query.value = selected.value?.label ?? props.modelValue;
  },
  { immediate: true },
);

function updateQuery(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  highlighted.value = 0;
  open.value = true;
  if (props.freeInput) emit('update:modelValue', query.value);
}

function choose(option: ComboboxOption) {
  emit('update:modelValue', option.value);
  query.value = props.freeInput ? option.value : option.label;
  closeMenu();
}

function move(delta: number) {
  open.value = true;
  const count = filteredOptions.value.length;
  if (count > 0) highlighted.value = (highlighted.value + delta + count) % count;
}

function chooseHighlighted() {
  const option = filteredOptions.value[highlighted.value];
  if (option) choose(option);
  else if (props.freeInput) closeMenu();
}

function openMenu() {
  open.value = true;
  highlighted.value = Math.max(0, filteredOptions.value.findIndex(option => option.value === props.modelValue));
}

function closeMenu() {
  open.value = false;
  if (!props.freeInput) query.value = selected.value?.label ?? '';
}

function toggleMenu() {
  if (open.value) closeMenu();
  else void nextTick(openMenu);
}

function closeFromOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) closeMenu();
}

document.addEventListener('pointerdown', closeFromOutside);
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeFromOutside));
</script>

<style lang="scss">
.dca-combobox {
  position: relative;
  min-width: 0;
}

.dca-combobox-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2rem;
}

.dca-app .dca-combobox-control input {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.dca-app .dca-combobox-control button {
  min-height: 0;
  border-left: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  padding: 0;
}

.dca-combobox.open .dca-combobox-control > button i {
  transform: rotate(180deg);
}

.dca-combobox-menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 0.25rem);
  right: 0;
  left: 0;
  display: flex;
  max-height: 17rem;
  flex-direction: column;
  overflow: auto;
  border: 1px solid var(--dca-border-strong);
  border-radius: var(--dca-radius-md);
  padding: 0.25rem;
  background: var(--dca-raised);
  box-shadow: var(--dca-shadow-lg);
}

.dca-app .dca-combobox-menu > button {
  display: flex;
  min-height: 2.2rem;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.08rem;
  border-color: transparent;
  padding: 0.38rem 0.5rem;
  background: transparent;
  text-align: left;
}

.dca-app .dca-combobox-menu > button:is(.active, :hover) {
  background: var(--dca-accent-soft);
}

.dca-combobox-menu small {
  color: var(--dca-text-muted);
  font-size: 0.72rem;
}

.dca-combobox-empty {
  padding: 0.7rem;
  color: var(--dca-text-muted);
  text-align: center;
}
</style>
