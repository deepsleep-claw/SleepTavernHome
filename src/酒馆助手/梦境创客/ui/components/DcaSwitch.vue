<template>
  <button
    class="dca-switch"
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    :class="{ active: modelValue }"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span aria-hidden="true"></span>
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    disabled?: boolean;
    label: string;
    modelValue: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<style lang="scss">
.dca-app button.dca-switch {
  display: inline-flex;
  width: 2.7rem;
  min-width: 2.7rem;
  height: 1.5rem;
  min-height: 1.5rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-start;
  border-color: var(--dca-border-strong);
  border-radius: 999px;
  padding: 2px;
  background: var(--dca-overlay);
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--dca-shadow-color) 28%, transparent);
  transition:
    border-color var(--dca-motion-fast) ease,
    background var(--dca-motion-fast) ease,
    box-shadow var(--dca-motion-fast) ease;
}

.dca-app button.dca-switch:hover:not(:disabled) {
  border-color: var(--dca-text-disabled);
  background: var(--dca-overlay);
}

.dca-app button.dca-switch.active {
  border-color: var(--dca-accent);
  background: var(--dca-accent);
  box-shadow: 0 0 0 1px var(--dca-focus-ring);
}

.dca-app button.dca-switch > span {
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: var(--dca-text-muted);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--dca-shadow-color) 45%, transparent);
  transition:
    transform var(--dca-motion-normal) cubic-bezier(0.2, 0.8, 0.2, 1),
    background var(--dca-motion-fast) ease;
}

.dca-app button.dca-switch.active > span {
  background: var(--dca-switch-thumb);
  transform: translateX(1.2rem);
}

.dca-app button.dca-switch:disabled {
  opacity: 0.5;
}
</style>
